import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { executeDeletionAfterDatabase } from "@/lib/account-deletion-after-database";
import {
  AccountDeletionExecutionBusyError,
  AccountDeletionExecutionConnectionError,
  withAccountDeletionExecutionLock,
} from "@/lib/account-deletion-execution-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class InvalidBodyError extends Error {}

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

  if (!value) throw new Error("CONFIGURATION_MISSING");

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

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ACCOUNT_DELETION_RECOVERY_ENABLED !== "true" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      request.nextUrl.hostname
    )
  ) {
    return json({ error: "Niet beschikbaar." }, 404);
  }

  const origin = request.headers.get("origin");

  // Deze eerste herstelinterface gebruikt de lokale website.
  if (origin && origin !== "http://localhost:3000") {
    return json({ error: "Deze oorsprong is niet toegestaan." }, 403);
  }

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!token) {
    return json({ error: "Log in met je beheeraccount." }, 401);
  }

  let stage = "authentication";
  let takeoverMayHaveStarted = false;

  try {
    if (
      process.env.ACCOUNT_DELETION_LOCAL_EXECUTOR_ENABLED === "true"
    ) {
      throw new Error("LEGACY_EXECUTOR_ENABLED");
    }

    requiredEnv("ACCOUNT_DELETION_DATABASE_URL");
    requiredEnv("ACCOUNT_DELETION_DATABASE_CA_FILE");

    const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

    const options = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    };

    const authClient = createClient(
      supabaseUrl,
      anonKey,
      options
    );

    const { data: userData, error: userError } =
      await authClient.auth.getUser(token);

    if (userError || !userData.user) {
      return json({ error: "Je sessie kon niet worden bevestigd." }, 401);
    }

    const adminId = userData.user.id;

    const admin = createClient(
      supabaseUrl,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      options
    );

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", adminId)
      .maybeSingle();

    if (profileError) throw new Error("ADMIN_LOOKUP_FAILED");

    if (profile?.role !== "admin") {
      return json({ error: "Je hebt geen beheerrechten." }, 403);
    }

    /*
     * Deze eerste herstelroute ondersteunt geen extra MFA-flow.
     * Geen geconfigureerde extra factor stilzwijgend overslaan.
     */
    if (
      userData.user.factors?.some(
        (factor) => factor.status === "verified"
      )
    ) {
      return json(
        {
          error:
            "Deze herstelroute ondersteunt de extra beveiligingsfactor van dit account nog niet.",
        },
        409
      );
    }

    const body = await readBody(request);

    if (
      !isObject(body) ||
      typeof body.requestId !== "string" ||
      !UUID_PATTERN.test(body.requestId) ||
      !isTimestamp(body.expectedClaimedAt) ||
      body.confirmation !== "RESUME_DELETION_BEFORE_AUTH" ||
      Object.keys(body).some(
        (key) =>
          ![
            "requestId",
            "expectedClaimedAt",
            "confirmation",
          ].includes(key)
      )
    ) {
      throw new InvalidBodyError();
    }

    const requestId = body.requestId.toLowerCase();

    stage = "check_supported_recovery";

    const { data: deletionRequest, error: requestError } =
      await admin
        .from("account_deletion_requests")
        .select("user_id, requester_role, status")
        .eq("id", requestId)
        .maybeSingle();

    const { data: execution, error: executionError } =
      await admin
        .from("account_deletion_executions")
        .select(`
          target_user_id,
          target_trainer_id,
          database_cleaned_at,
          auth_delete_started_at,
          auth_deleted_at,
          local_completed_at,
          target_reference_erased_at
        `)
        .eq("request_id", requestId)
        .maybeSingle();

    if (requestError || executionError) {
      throw new Error("RECOVERY_LOOKUP_FAILED");
    }

    if (
      !deletionRequest ||
      !execution ||
      deletionRequest.status !== "in_progress" ||
      !["player", "trainer"].includes(deletionRequest.requester_role) ||
      typeof execution.target_user_id !== "string" ||
      !UUID_PATTERN.test(execution.target_user_id) ||
      deletionRequest.user_id !== execution.target_user_id ||
      !isTimestamp(execution.database_cleaned_at) ||
      execution.auth_delete_started_at !== null ||
      execution.auth_deleted_at !== null ||
      execution.local_completed_at !== null ||
      execution.target_reference_erased_at !== null
    ) {
      return json(
        {
          error:
            "Deze uitvoering past niet bij herstel na database-opruiming en vóór Auth-vrijgave. Er is geen claimovername gedaan.",
        },
        409
      );
    }

    const role = deletionRequest.requester_role as
      | "player"
      | "trainer";

    if (
      role === "trainer" &&
      process.env.ACCOUNT_DELETION_TRAINER_LOCAL_ENABLED !== "true"
    ) {
      return json(
        { error: "Het beperkte trainerpad is niet ingeschakeld." },
        409
      );
    }

    const expectedTrainerId = execution.target_trainer_id;

    if (
      (role === "player" && expectedTrainerId !== null) ||
      (
        role === "trainer" &&
        (
          typeof expectedTrainerId !== "string" ||
          !UUID_PATTERN.test(expectedTrainerId)
        )
      )
    ) {
      return json(
        { error: "De oorspronkelijke trainercontext is niet geschikt." },
        409
      );
    }

    const expectedUserId = execution.target_user_id;

    /*
     * Overname verkrijgt zelf een transactielock op het verzoek.
     * Niet eerst op onze andere pg-verbinding een sessielock nemen:
     * daarmee zouden we onze eigen RPC blokkeren.
     */
    stage = "take_over_claim";
    takeoverMayHaveStarted = true;

    const { data: takeover, error: takeoverError } = await admin.rpc(
      "take_over_account_deletion_before_auth",
      {
        p_request_id: requestId,
        p_admin_id: adminId,
        p_expected_claimed_at: body.expectedClaimedAt,
      }
    );

    if (
      takeoverError ||
      !isObject(takeover) ||
      takeover.request_id !== requestId ||
      takeover.claim_replaced !== true ||
      takeover.database_cleaned !== true ||
      typeof takeover.claim_token !== "string" ||
      !UUID_PATTERN.test(takeover.claim_token)
    ) {
      throw new Error("TAKEOVER_NOT_CONFIRMED");
    }

    const claimToken = takeover.claim_token;

    stage = "acquire_execution_lock";

    return await withAccountDeletionExecutionLock(
      requestId,
      async ({ assertConnection }) => {
        /*
         * De gedeelde uitvoerder controleert onder de sessielock
         * opnieuw de vervangende claim en de uitvoerfase.
         * Een tweede overname in de tussenperiode wordt zo herkend.
         */
        const result = await executeDeletionAfterDatabase({
          admin,
          requestId,
          claimToken,
          expectedUserId,
          expectedTrainerId,
          role,
          assertConnection,
          onStage: (nextStage) => {
            stage = nextStage;
          },
        });

        return json({
          ...result,
          resumed: true,
        });
      }
    );
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return json({ error: "Ongeldige herstelbevestiging." }, 400);
    }

    const code =
      error instanceof AccountDeletionExecutionBusyError
        ? "EXECUTION_LOCK_BUSY"
        : error instanceof AccountDeletionExecutionConnectionError
          ? "EXECUTION_CONNECTION_NOT_CONFIRMED"
          : "RECOVERY_NOT_CONFIRMED";

    return json(
      {
        code,
        stage,
        takeoverMayHaveStarted,
        error:
          "Het herstel kon niet worden bevestigd. Een claimovername of uitvoerfase kan al zijn vastgelegd. Vernieuw de voortgang; er wordt niet automatisch opnieuw uitgevoerd.",
      },
      503
    );
  }
}