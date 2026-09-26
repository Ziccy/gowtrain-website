import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
  "https://gowtrain.com",
  "http://localhost:8081",
]);

if (process.env.NODE_ENV === "development") {
  ALLOWED_ORIGINS.add("http://localhost:3000");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECEIPT_PATTERN = /^[0-9a-f]{64}$/;

const QUEUE_STATUSES = new Set([
  "queued",
  "claimed",
  "needs_review",
  "completed",
]);

class InvalidBodyError extends Error {}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("Serverconfiguratie ontbreekt.");
  }

  return value;
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  // Native heeft doorgaans geen Origin.
  // Sessie en statusbewijs blijven verplicht.
  return origin === null || ALLOWED_ORIGINS.has(origin);
}

function addHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Origin");

  const origin = request.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  return response;
}

function respond(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return addHeaders(
    request,
    NextResponse.json(body, { status })
  );
}

async function readBody(request: NextRequest): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json" || !request.body) {
    throw new InvalidBodyError();
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();

  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bytes += value.byteLength;

      if (bytes > 2048) {
        await reader.cancel();
        throw new InvalidBodyError();
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidBodyError();
  }
}

export function OPTIONS(request: NextRequest): NextResponse {
  if (!originAllowed(request)) {
    return respond(
      request,
      { error: "Deze oorsprong is niet toegestaan." },
      403
    );
  }

  const response = new NextResponse(null, { status: 204 });

  response.headers.set(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Account-Deletion-Receipt"
  );
  response.headers.set("Access-Control-Max-Age", "600");

  return addHeaders(request, response);
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  if (
    process.env.ACCOUNT_DELETION_SUBMISSION_ENABLED !== "true"
  ) {
    return respond(
      request,
      {
        code: "DELETION_SUBMISSION_DISABLED",
        error:
          "Accountverwijdering is momenteel nog niet beschikbaar via deze ingang.",
      },
      503
    );
  }

  if (!originAllowed(request)) {
    return respond(
      request,
      { error: "Deze oorsprong is niet toegestaan." },
      403
    );
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

  const receipt = request.headers.get(
    "x-account-deletion-receipt"
  );

  if (!token || !receipt || !RECEIPT_PATTERN.test(receipt)) {
    return respond(
      request,
      {
        error:
          "Een geldige sessie en een geldig statusbewijs zijn vereist.",
      },
      401
    );
  }

  try {
    const body = await readBody(request);

    if (
      !isObject(body) ||
      typeof body.requestId !== "string" ||
      !UUID_PATTERN.test(body.requestId) ||
      body.confirmation !== "START_CONFIRMED_ACCOUNT_DELETION" ||
      Object.keys(body).some(
        (key) => key !== "requestId" && key !== "confirmation"
      )
    ) {
      return respond(
        request,
        { error: "Ongeldige startbevestiging." },
        400
      );
    }

    const requestId = body.requestId.toLowerCase();
    const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");

    const authOptions = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    };

    const authClient = createClient(
      supabaseUrl,
      requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      authOptions
    );

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return respond(
        request,
        {
          error:
            "Je sessie kon niet worden bevestigd. Gebruik het statusbewijs om te controleren of een eerdere start al is verwerkt.",
        },
        401
      );
    }

    // Geen MFA stilzwijgend omzeilen.
    if (
      user.factors?.some(
        (factor) => factor.status === "verified"
      )
    ) {
      return respond(
        request,
        {
          code: "MFA_CONFIRMATION_REQUIRED",
          error:
            "Voor dit account is bevestiging met je extra beveiligingsfactor nodig. Deze startflow ondersteunt dat nog niet.",
        },
        409
      );
    }

    const tokenHash = createHash("sha256")
      .update(receipt, "utf8")
      .digest("hex");

    const admin = createClient(
      supabaseUrl,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      authOptions
    );

    /*
     * De database controleert:
     * - actuele profielrol;
     * - eigenaar van het verzoek;
     * - geldig bewijs voor hetzelfde verzoek;
     * - recente bevestiging bij de eerste start;
     * - behoud van een bestaande wachtrijopdracht.
     */
    const { data, error } = await admin.rpc(
      "start_confirmed_account_deletion",
      {
        p_user_id: user.id,
        p_request_id: requestId,
        p_token_hash: tokenHash,
      }
    );

    if (error) {
      if (error.code === "42501") {
        return respond(
          request,
          {
            error:
              "Account, verzoek en statusbewijs konden niet gezamenlijk worden bevestigd.",
          },
          403
        );
      }

      if (error.code === "22023") {
        return respond(
          request,
          {
            error:
              "De startbevestiging is ongeldig of niet meer recent genoeg. Controleer eerst de verzoekstatus en bevestig zo nodig opnieuw je wachtwoord.",
          },
          409
        );
      }

      if (error.code === "55000") {
        return respond(
          request,
          {
            error:
              "Dit verzoek kan niet als nieuwe uitvoering worden gestart. Controleer de bestaande voortgang.",
          },
          409
        );
      }

      throw new Error("START_NOT_CONFIRMED");
    }

    if (
      !isObject(data) ||
      data.request_id !== requestId ||
      data.processing_accepted !== true ||
      typeof data.already_enqueued !== "boolean" ||
      typeof data.queue_status !== "string" ||
      !QUEUE_STATUSES.has(data.queue_status) ||
      typeof data.queued_at !== "string" ||
      !Number.isFinite(Date.parse(data.queued_at))
    ) {
      throw new Error("INVALID_START_RESPONSE");
    }

    return respond(
      request,
      {
        requestId,
        processingAccepted: true,
        alreadyEnqueued: data.already_enqueued,
        processingStatus: data.queue_status,
        queuedAt: data.queued_at,
        message:
          "De verwerkingsopdracht is geregistreerd of was al aanwezig. Controleer met je statusbewijs wanneer de verwijdering is afgerond.",
      },
      202
    );
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return respond(
        request,
        { error: "De startaanvraag heeft een ongeldig formaat." },
        400
      );
    }

    // Geen tokens, statusbewijzen of ruwe fouten loggen.
    return respond(
      request,
      {
        code: "START_NOT_CONFIRMED",
        error:
          "Het starten kon niet worden bevestigd. De opdracht kan al geregistreerd zijn. Controleer eerst de status met je bewaarde statusbewijs.",
      },
      503
    );
  }
}