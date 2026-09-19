import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { executeSandboxTrainerTransfer } from "@/lib/execute-sandbox-trainer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`${name} ontbreekt.`);

  return value;
}

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const database = createClient(
  supabaseUrl,
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  try {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!token) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError || !user) {
      return json({ error: "Je sessie is ongeldig of verlopen." }, 401);
    }

    const { data: profile, error: profileError } = await database
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return json({ error: "De adminrechten konden niet worden gecontroleerd." }, 503);
    }

    if (profile?.role !== "admin") {
      return json({ error: "Alleen admins hebben toegang." }, 403);
    }

    /*
     * Deze route mag uitsluitend de uitgeschakelde tak testen.
     * Ook na een latere configuratiewijziging geen uitvoering
     * via deze testroute mogelijk maken.
     */
    if (
      process.env.SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED === "true"
    ) {
      return json(
        {
          error:
            "Blokkadetest geweigerd: de uitvoeringsvariabele staat aan.",
          testPassed: false,
        },
        409,
      );
    }

    /*
     * Geen bestaande opdracht vereist.
     * De uitvoerder moet vóór database- en Stripe-toegang
     * terugkeren met disabled.
     */
    const result = await executeSandboxTrainerTransfer(
      "00000000-0000-0000-0000-000000000001",
    );

    if (result.result !== "disabled") {
      console.error("Onverwachte uitkomst van transferblokkadetest:", {
        result: result.result,
      });

      return json(
        {
          error: "De verwachte blokkade is niet bevestigd.",
          testPassed: false,
        },
        500,
      );
    }

    return json({
      testPassed: true,
      executionResult: "disabled",
      transferExecuted: false,
      message:
        "De uitvoerder stopt bij de uitschakelcontrole. Geen transferopdracht geclaimd en geen Stripe-aanroep gedaan.",
    });
  } catch {
    return json(
      {
        error: "De blokkadetest kon niet worden bevestigd.",
        testPassed: false,
      },
      503,
    );
  }
}