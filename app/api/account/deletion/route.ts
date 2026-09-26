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

const REQUEST_STATUSES = new Set([
  "requested",
  "in_progress",
  "needs_review",
  "completed",
]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("Serverconfiguratie ontbreekt.");
  }

  return value;
}

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  /*
   * Native requests hebben doorgaans geen Origin.
   * Dat geeft geen toegang: de Bearer-controle blijft verplicht.
   */
  return origin === null || ALLOWED_ORIGINS.has(origin);
}

function respond(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  const response = NextResponse.json(body, { status });

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Origin");

  const origin = request.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  return response;
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

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Origin");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  response.headers.set("Access-Control-Max-Age", "600");

  const origin = request.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  return response;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return respond(
      request,
      { error: "Deze oorsprong is niet toegestaan." },
      403
    );
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1];

  if (!token) {
    return respond(
      request,
      { error: "Je moet ingelogd zijn." },
      401
    );
  }

  try {
    const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return respond(
        request,
        { error: "Je sessie kon niet worden bevestigd. Log opnieuw in." },
        401
      );
    }

    /*
     * Alleen server-side gebruiken.
     * Nooit de service-role-key naar de client teruggeven.
     */
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

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

    /*
     * Geen user-ID uit queryparameters of een requestbody gebruiken.
     * Alleen de door Supabase geverifieerde gebruiker.
     */
    const { data: deletionRequest, error: requestError } = await admin
      .from("account_deletion_requests")
      .select("id, status, requested_at, completed_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (requestError) {
      throw new Error("DELETION_REQUEST_LOOKUP_FAILED");
    }

    if (
      deletionRequest &&
      (
        !REQUEST_STATUSES.has(deletionRequest.status) ||
        !Number.isFinite(Date.parse(deletionRequest.requested_at))
      )
    ) {
      throw new Error("DELETION_REQUEST_INVALID");
    }

    /*
 * Alleen het eigen, nog aangevraagde verzoek beoordelen.
 * Een lopende of afgeronde uitvoering heeft later een eigen
 * statusafhandeling; die niet opnieuw als nieuw verzoek beoordelen.
 */
let assessment: {
  outcome: "simple_path_candidate" | "requires_review";
  reasons: string[];
  executionReady: false;
} | null = null;

let assessmentUnavailable = false;

if (deletionRequest?.status === "requested") {
  const {
    data: assessmentData,
    error: assessmentError,
  } = await admin.rpc("assess_account_deletion_request", {
    p_request_id: deletionRequest.id,
  });

  const value: unknown = assessmentData;

  if (
    !assessmentError &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const result = value as Record<string, unknown>;

    const validOutcome =
      result.assessment === "simple_path_candidate" ||
      result.assessment === "requires_review";

    const validReasons =
      Array.isArray(result.reasons) &&
      result.reasons.every(
        (reason: unknown) => typeof reason === "string"
      );

    if (
      result.request_id === deletionRequest.id &&
      result.request_status === "requested" &&
      result.execution_ready === false &&
      validOutcome &&
      validReasons
    ) {
      const reasons = result.reasons as string[];

      /*
       * Geen positieve beoordeling accepteren wanneer
       * het antwoord tegelijkertijd blokkades vermeldt.
       */
      const consistent =
        result.assessment === "simple_path_candidate"
          ? reasons.length === 0
          : reasons.length > 0;

      if (consistent) {
        assessment = {
          outcome: result.assessment as
            | "simple_path_candidate"
            | "requires_review",
          reasons,
          executionReady: false,
        };
      }
    }
  }

  assessmentUnavailable = assessment === null;
}

return respond(request, {
  request: deletionRequest
    ? {
        id: deletionRequest.id,
        status: deletionRequest.status,
        requestedAt: deletionRequest.requested_at,
        completedAt: deletionRequest.completed_at,
      }
    : null,

  assessment,
  assessmentUnavailable,

  /*
   * De registratie is alleen via de lokale testinterface getest.
   * De publieke aanvraaginterface en verwijderuitvoering
   * zijn nog niet ingeschakeld.
   */
  submissionEnabled: false,
  executionEnabled: false,
});
  } catch {
    // Geen tokens, persoonsgegevens of interne foutdetails loggen.
    return respond(
      request,
      {
        error:
          "De status van je verwijderverzoek kon niet worden geladen. Probeer later opnieuw.",
      },
      503
    );
  }
}