import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
  "https://gowtrain.com",
]);

if (process.env.NODE_ENV === "development") {
  ALLOWED_ORIGINS.add("http://localhost:3000");
}

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Authorization, Origin",
    },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error("Serverconfiguratie ontbreekt.");

  return value;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  const origin = request.headers.get("origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Deze oorsprong is niet toegestaan." }, 403);
  }

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!token) {
    return json({ error: "Log in met je beheeraccount." }, 401);
  }

  try {
    const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");

    const options = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };

    const authClient = createClient(
      url,
      requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      options
    );

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return json({ error: "Je sessie kon niet worden bevestigd." }, 401);
    }

    const admin = createClient(
      url,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      options
    );

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw new Error("ADMIN_CHECK_FAILED");

    if (profile?.role !== "admin") {
      return json({ error: "Je hebt geen beheerrechten." }, 403);
    }

    const requestId = request.nextUrl.searchParams.get("requestId");

    if (!requestId || !UUID_PATTERN.test(requestId)) {
      return json({ error: "Ongeldig verzoek-ID." }, 400);
    }

    const { data: deletionRequest, error: requestError } = await admin
      .from("account_deletion_requests")
      .select("id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) throw new Error("REQUEST_LOOKUP_FAILED");

    if (!deletionRequest) {
      return json({ error: "Verwijderverzoek niet gevonden." }, 404);
    }

    const { data: followup, error: followupError } = await admin
      .from("account_deletion_followups")
      .select(
        "assigned_admin_id, next_action, review_after, version, updated_at"
      )
      .eq("request_id", requestId)
      .maybeSingle();

    if (followupError) throw new Error("FOLLOWUP_LOOKUP_FAILED");

    return json({
      requestId: deletionRequest.id,
      requestStatus: deletionRequest.status,
      followup: followup
        ? {
            assigned: followup.assigned_admin_id !== null,
            assignedToCurrentAdmin:
              followup.assigned_admin_id === user.id,
            nextAction: followup.next_action,
            reviewAfter: followup.review_after,
            version: followup.version,
            updatedAt: followup.updated_at,
          }
        : null,
    });
  } catch {
    return json(
      { error: "De opvolging kon niet worden geladen." },
      503
    );
  }
}