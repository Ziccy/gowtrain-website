import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/*
 * Het statusbewijs wordt straks op de server gegenereerd:
 * randomBytes(32).toString("hex").
 *
 * Dit is een afzonderlijk bewijs, niet het Auth-token
 * en niet de geheime workersleutel.
 */
const RECEIPT_PATTERN = /^[0-9a-f]{64}$/;

const SUPPORTED_STATES = new Set([
  "requested",
  "queued",
  "processing",
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
  // Het geheime statusbewijs blijft altijd verplicht.
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

  let size = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > 1024) {
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
    "Content-Type, X-Account-Deletion-Receipt"
  );
  response.headers.set("Access-Control-Max-Age", "600");

  return addHeaders(request, response);
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return respond(
      request,
      { error: "Deze oorsprong is niet toegestaan." },
      403
    );
  }

  /*
   * Bewust geen Auth-sessie vereisen:
   * het account kan inmiddels verwijderd zijn.
   *
   * Het bewijs gaat in een header, niet in de URL.
   */
  const receipt = request.headers.get(
    "x-account-deletion-receipt"
  );

  if (!receipt || !RECEIPT_PATTERN.test(receipt)) {
    return respond(
      request,
      {
        code: "INVALID_STATUS_RECEIPT",
        error: "Een geldig statusbewijs is vereist.",
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
      Object.keys(body).some((key) => key !== "requestId")
    ) {
      return respond(
        request,
        { error: "Ongeldige statusaanvraag." },
        400
      );
    }

    const requestId = body.requestId.toLowerCase();

    const tokenHash = createHash("sha256")
      .update(receipt, "utf8")
      .digest("hex");

    const admin = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );

    const { data, error } = await admin.rpc(
      "get_account_deletion_receipt_status",
      {
        p_request_id: requestId,
        p_token_hash: tokenHash,
      }
    );

    if (error) {
      throw new Error("STATUS_NOT_CONFIRMED");
    }

    /*
     * Geen onderscheid bekendmaken tussen:
     * - onbekend verzoek;
     * - verkeerd bewijs;
     * - verlopen bewijs.
     */
    if (data === null) {
      return respond(
        request,
        {
          code: "STATUS_RECEIPT_NOT_VALID",
          error:
            "De status is met dit bewijs niet beschikbaar. Het bewijs kan ongeldig of verlopen zijn. Dit bevestigt niet dat het account verwijderd is.",
        },
        401
      );
    }

if (
  !isObject(data) ||
  typeof data.state !== "string" ||
  !SUPPORTED_STATES.has(data.state) ||
  typeof data.account_deleted !== "boolean" ||
  typeof data.external_followup_pending !== "boolean"
) {
  throw new Error("INVALID_STATUS_RESPONSE");
}

const requestCompleted = data.state === "completed";

if (requestCompleted) {
  if (
    typeof data.completed_at !== "string" ||
    !Number.isFinite(Date.parse(data.completed_at)) ||
    data.account_deleted !== true ||
    data.external_followup_pending !== false
  ) {
    throw new Error("COMPLETION_NOT_CONFIRMED");
  }
} else if (data.completed_at !== null) {
  throw new Error("INCONSISTENT_STATUS_RESPONSE");
}

if (
  data.account_deleted &&
  !requestCompleted &&
  data.state !== "processing" &&
  data.state !== "needs_review"
) {
  throw new Error("INCONSISTENT_ACCOUNT_DELETION_STATE");
}

if (
  data.account_deleted &&
  data.external_followup_pending &&
  data.state !== "needs_review"
) {
  throw new Error("INCONSISTENT_EXTERNAL_FOLLOWUP_STATE");
}

/*
 * Alleen beperkte voortgang teruggeven.
 * Geen account-ID, claimtoken of providerreferenties.
 *
 * accountDeleted en requestCompleted hebben bewust
 * een verschillende betekenis.
 */
/*
 * Het bewijs is hierboven al door de status-RPC gecontroleerd.
 * Lees nu de actuele serververvaldatum van exact hetzelfde bewijs.
 *
 * Alleen expires_at ophalen; geen hash of andere interne
 * gegevens naar de app teruggeven.
 */
const { data: storedReceipt, error: receiptLookupError } =
  await admin
    .from("account_deletion_status_receipts")
    .select("expires_at")
    .eq("request_id", requestId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

if (
  receiptLookupError ||
  !storedReceipt ||
  typeof storedReceipt.expires_at !== "string" ||
  !Number.isFinite(Date.parse(storedReceipt.expires_at))
) {
  throw new Error("RECEIPT_EXPIRY_NOT_CONFIRMED");
}

return respond(request, {
  state: data.state,
  completedAt: data.completed_at,
  requestCompleted,
  accountDeleted: data.account_deleted,
  externalFollowupPending: data.external_followup_pending,
  statusReceiptExpiresAt: storedReceipt.expires_at,
});
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return respond(
        request,
        { error: "De statusaanvraag heeft een ongeldig formaat." },
        400
      );
    }

    // Geen bewijs, hash of ruwe databasefout loggen.
    return respond(
      request,
      {
        code: "STATUS_UNAVAILABLE",
        error:
          "De verwijderstatus kon niet worden bevestigd. Probeer de status later opnieuw op te halen.",
      },
      503
    );
  }
}