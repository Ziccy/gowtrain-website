import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

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

const MAX_BODY_BYTES = 16_384;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUEST_STATUSES = new Set([
  "requested",
  "in_progress",
  "needs_review",
  "completed",
]);

class InvalidBodyError extends Error {}

/* HELPERS */

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

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  /*
   * Native requests hebben doorgaans geen Origin.
   * Een ontbrekende Origin omzeilt de Bearer- en
   * wachtwoordcontrole niet.
   */
  return origin === null || ALLOWED_ORIGINS.has(origin);
}

function addHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  response.headers.set("Cache-Control", "no-store");

  const existingVary = response.headers.get("Vary");
  const varyValues = existingVary
    ? existingVary.split(",").map((value) => value.trim())
    : [];

  if (
    !varyValues.some(
      (value) =>
        value === "*" ||
        value.toLowerCase() === "origin"
    )
  ) {
    varyValues.push("Origin");
    response.headers.set("Vary", varyValues.join(", "));
  }

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

/*
 * Begrens de daadwerkelijk gelezen body.
 * Niet uitsluitend vertrouwen op Content-Length.
 */
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

  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > MAX_BODY_BYTES) {
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

/* CORS-PREFLIGHT */

export function OPTIONS(
  request: NextRequest
): NextResponse {
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
    "Authorization, Content-Type"
  );
  response.headers.set("Access-Control-Max-Age", "600");

  return addHeaders(request, response);
}

/* BEVESTIGD VERWIJDERVERZOEK REGISTREREN */

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  /*
   * Pas inschakelen wanneer de worker en de definitieve
   * aanvraag-/statusinterface zijn aangesloten.
   *
   * Deze serverinstelling krijgt geen NEXT_PUBLIC_-prefix.
   */
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

  if (!token) {
    return respond(
      request,
      { error: "Je moet ingelogd zijn." },
      401
    );
  }

  try {
    const body = await readBody(request);

    /*
     * Nieuwe expliciete bevestigingswaarde.
     * Het oude lokale testformulier mag hiermee niet
     * ongemerkt een verwerkingsopdracht indienen.
     */
    if (
      !isObject(body) ||
      body.confirmation !==
        "REQUEST_AND_PROCESS_ACCOUNT_DELETION" ||
      typeof body.password !== "string" ||
      body.password.length === 0
    ) {
      return respond(
        request,
        {
          error:
            "Bevestig je verwijderverzoek en vul je huidige wachtwoord in.",
        },
        400
      );
    }

    /*
     * De gebruiker mag geen doelaccount, e-mailadres of
     * verzoek-ID kiezen via deze aanvraag.
     */
    if (
      Object.keys(body).some(
        (key) =>
          key !== "password" &&
          key !== "confirmation"
      )
    ) {
      return respond(
        request,
        { error: "De aanvraag bevat onverwachte velden." },
        400
      );
    }

    const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authOptions = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    };

    const authClient = createClient(
      supabaseUrl,
      anonKey,
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
            "Je sessie kon niet worden bevestigd. Log opnieuw in.",
        },
        401
      );
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      authOptions
    );

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error("PROFILE_LOOKUP_FAILED");
    }

    if (
      !profile ||
      !["player", "trainer"].includes(profile.role)
    ) {
      return respond(
        request,
        {
          error:
            "Deze accountfunctie is alleen beschikbaar voor spelers en trainers.",
        },
        403
      );
    }

    if (!user.email) {
      return respond(
        request,
        {
          code: "CONFIRMATION_METHOD_UNSUPPORTED",
          error:
            "Dit account kan niet met deze wachtwoordbevestiging worden gecontroleerd.",
        },
        409
      );
    }

    /*
     * Extra beveiligingsfactoren niet stilzwijgend overslaan.
     * Deze eerste bevestigingsflow ondersteunt alleen
     * wachtwoordbevestiging zonder ingestelde verified MFA-factor.
     */
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
            "Voor dit account is bevestiging met je extra beveiligingsfactor nodig. Deze verwijderbevestiging ondersteunt dat nog niet.",
        },
        409
      );
    }

    /*
     * Server-side poginglimiet.
     * De RPC bepaalt atomair of een nieuwe poging is toegestaan.
     */
    const { data: allowed, error: limitError } = await admin.rpc(
      "consume_account_deletion_confirmation_attempt",
      { p_user_id: user.id }
    );

    if (limitError || typeof allowed !== "boolean") {
      throw new Error("CONFIRMATION_LIMIT_NOT_CONFIRMED");
    }

    if (!allowed) {
      const response = respond(
        request,
        {
          error:
            "Te veel bevestigingspogingen. Wacht vijftien minuten voordat je opnieuw probeert.",
        },
        429
      );

      response.headers.set("Retry-After", "900");
      return response;
    }

    /*
     * Afzonderlijke tijdelijke Auth-client.
     * De bevestigingslogin vervangt de app-sessie niet.
     *
     * Het wachtwoord niet trimmen, loggen of opslaan.
     */
    const confirmationClient = createClient(
      supabaseUrl,
      anonKey,
      authOptions
    );

    let temporarySessionCreated = false;

    try {
      const {
        data: confirmed,
        error: confirmationError,
      } = await confirmationClient.auth.signInWithPassword({
        email: user.email,
        password: body.password,
      });

      temporarySessionCreated = Boolean(confirmed.session);

      if (confirmationError) {
        if (confirmationError.status === 429) {
          return respond(
            request,
            {
              error:
                "De wachtwoordcontrole is tijdelijk begrensd. Probeer later opnieuw.",
            },
            429
          );
        }

        if (confirmationError.code === "invalid_credentials") {
          return respond(
            request,
            {
              error:
                "Je huidige wachtwoord kon niet worden bevestigd.",
            },
            403
          );
        }

        return respond(
          request,
          {
            error:
              "De identiteitsbevestiging kon niet worden afgerond. Deze aanvraag heeft geen nieuwe verwerkingsopdracht geregistreerd.",
          },
          503
        );
      }

      if (
        !confirmed.session ||
        !confirmed.user ||
        confirmed.user.id !== user.id
      ) {
        return respond(
          request,
          {
            error:
              "De bevestigde identiteit komt niet overeen met je huidige account.",
          },
          403
        );
      }

      /*
       * Controleer de oorspronkelijke sessie opnieuw
       * voordat we een duurzame opdracht registreren.
       */
      const {
        data: { user: currentUser },
        error: currentUserError,
      } = await authClient.auth.getUser(token);

      if (
        currentUserError ||
        !currentUser ||
        currentUser.id !== user.id
      ) {
        return respond(
          request,
          {
            error:
              "Je oorspronkelijke sessie kon niet opnieuw worden bevestigd. Log opnieuw in.",
          },
          401
        );
      }

      if (
        currentUser.factors?.some(
          (factor) => factor.status === "verified"
        )
      ) {
        return respond(
          request,
          {
            code: "MFA_CONFIRMATION_REQUIRED",
            error:
              "De beveiliging van je account is gewijzigd. Bevestiging met je extra beveiligingsfactor is nodig.",
          },
          409
        );
      }

/*
       * Maak een onvoorspelbaar statusbewijs.
       * Alleen de hash wordt in de database opgeslagen.
       *
       * Deze aanvraag registreert het verzoek en het bewijs,
       * maar plaatst niets in de uitvoerwachtrij.
       */
      const receipt = randomBytes(32).toString("hex");

      const tokenHash = createHash("sha256")
        .update(receipt, "utf8")
        .digest("hex");

      const { data: prepared, error: preparationError } =
        await admin.rpc("prepare_account_deletion_confirmation", {
          p_user_id: user.id,
          p_token_hash: tokenHash,
        });

      if (
        preparationError ||
        !isObject(prepared) ||
        typeof prepared.request_id !== "string" ||
        !UUID_PATTERN.test(prepared.request_id) ||
        typeof prepared.request_status !== "string" ||
        !REQUEST_STATUSES.has(prepared.request_status) ||
        !isTimestamp(prepared.requested_at) ||
        !isTimestamp(prepared.receipt_expires_at) ||
        (
          prepared.completed_at !== null &&
          !isTimestamp(prepared.completed_at)
        )
      ) {
        throw new Error("DELETION_CONFIRMATION_NOT_CONFIRMED");
      }

      return respond(
        request,
        {
          requestRegistered: true,
          processingEnqueuedByThisCall: false,

          request: {
            id: prepared.request_id,
            status: prepared.request_status,
            requestedAt: prepared.requested_at,
            completedAt: prepared.completed_at,
          },

          statusReceipt: receipt,
          statusReceiptExpiresAt: prepared.receipt_expires_at,

          message:
            "Je identiteit en verwijderverzoek zijn bevestigd. Deze aanvraag start geen nieuwe verwerking. Bewaar het statusbewijs voordat je de verwerking afzonderlijk bevestigt.",
        },
        200
      );
    } finally {
      /*
       * Alleen de tijdelijke bevestigingssessie intrekken.
       * Geen globale signOut uitvoeren.
       *
       * Tokens worden niet opgeslagen, gelogd of teruggestuurd.
       */
      if (temporarySessionCreated) {
        try {
          await confirmationClient.auth.signOut({
            scope: "local",
          });
        } catch {
          /*
           * Een opruimfout mag niet leiden tot automatisch
           * opnieuw registreren van het verwijderverzoek.
           * Geen geheimen loggen.
           */
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return respond(
        request,
        {
          error:
            "De bevestigingsaanvraag heeft een ongeldig formaat.",
        },
        400
      );
    }

    /*
     * De registratie kan al gecommit zijn terwijl het antwoord
     * verloren ging. Daarom geen automatische herhaling.
     */
    return respond(
      request,
      {
        error:
          "De bevestiging kon niet worden afgerond. Het verzoek en een statusbewijs kunnen al geregistreerd zijn, maar deze aanvraag plaatst niets in de uitvoerwachtrij. Controleer eerst de verzoekstatus.",
      },
      503
    );
  }
}