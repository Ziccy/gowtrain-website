import { NextRequest, NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { retrieveVerifiedTrainerConnectV2Account } from "@/lib/stripe-connect-v2";
import {
  buildConnectV2AccountPayload,
  type ConnectV2AccountCreateParams,
} from "@/lib/stripe-connect-v2-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`${name} ontbreekt.`);

  return value;
}

const stripeKey = requiredEnv("STRIPE_SECRET_KEY");
const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const appBaseUrl = new URL(requiredEnv("NEXT_PUBLIC_APP_URL"));

if (
  !["http:", "https:"].includes(appBaseUrl.protocol) ||
  appBaseUrl.username ||
  appBaseUrl.password ||
  appBaseUrl.search ||
  appBaseUrl.hash ||
  appBaseUrl.pathname !== "/"
) {
  throw new Error("NEXT_PUBLIC_APP_URL moet een geldige basis-URL zijn.");
}

const stripe = new Stripe(stripeKey, {
  timeout: 10_000,
  maxNetworkRetries: 0,
});

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type Reservation = {
  result: "already_linked" | "reserved" | "existing_attempt";
  account_id?: string;
  attempt_id?: string;
  status?: string;
};

type PreparedAttempt = {
  attempt_id: string;
  trainer_id: string;
  account_api: string;
  stripe_livemode: boolean;
  stripe_payload: unknown;
  idempotency_key: string;
};

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/*
 * Controleer de volledige opgeslagen payload tegen onze
 * ondersteunde configuratie. Verstuur daarna het opgeslagen object,
 * niet een opnieuw opgebouwde aanvraag.
 */
function validateStoredPayload(
  value: unknown,
  trainerId: string,
  attemptId: string,
): {
  payload: ConnectV2AccountCreateParams;
  country: "NL" | "BE";
} {
  if (!isObject(value) || !isObject(value.identity)) {
    throw new Error("CONNECT_V2_PAYLOAD_INVALID");
  }

  const country = value.identity.country;
  const contactEmail = value.contact_email;
  const displayName = value.display_name;

  if (
    (country !== "NL" && country !== "BE") ||
    typeof contactEmail !== "string" ||
    typeof displayName !== "string"
  ) {
    throw new Error("CONNECT_V2_PAYLOAD_INVALID");
  }

  const expected = buildConnectV2AccountPayload({
    trainerId,
    attemptId,
    country,
    contactEmail,
    displayName,
  });

  if (!isDeepStrictEqual(value, expected)) {
    throw new Error("CONNECT_V2_PAYLOAD_MISMATCH");
  }

  return {
    payload: value as ConnectV2AccountCreateParams,
    country,
  };
}

async function verifyAndStoreAccount(
  trainerId: string,
  userId: string,
  attemptId: string,
  accountId: string,
  country: "NL" | "BE",
): Promise<void> {
  const verified = await retrieveVerifiedTrainerConnectV2Account(
    stripe,
    {
      accountId,
      trainerId,
      attemptId,
      country,
    },
  );

  const { data, error } = await supabaseAdmin.rpc(
    "link_verified_trainer_connect_v2_account",
    {
      p_attempt_id: attemptId,
      p_user_id: userId,
      p_account_id: verified.accountId,
      p_transfers_status: verified.transfersStatus,
      p_payouts_status: verified.payoutsStatus,
      p_checked_at: verified.checkedAt,
    },
  );

  if (error || data !== true) {
    console.error("V2-accountkoppeling opslaan niet bevestigd:", {
      attemptId,
      code: error?.code,
    });

    throw new Error("CONNECT_V2_LINK_NOT_CONFIRMED");
  }
}

async function verifyExistingLink(
  trainerId: string,
  userId: string,
  accountId: string,
): Promise<void> {
  const { data: attempt, error } = await supabaseAdmin
    .from("trainer_connect_attempts")
    .select(
      "id, trainer_user_id, status, account_api, stripe_livemode, stripe_account_id, stripe_request_payload",
    )
    .eq("trainer_id", trainerId)
    .eq("stripe_account_id", accountId)
    .eq("account_api", "accounts_v2")
    .eq("status", "linked")
    .maybeSingle();

  if (error) throw new Error("CONNECT_V2_ATTEMPT_LOOKUP_FAILED");

  if (
    !attempt ||
    attempt.trainer_user_id !== userId ||
    attempt.stripe_livemode !== false
  ) {
    throw new Error("CONNECT_V2_LINKED_ATTEMPT_MISSING");
  }

  const { country } = validateStoredPayload(
    attempt.stripe_request_payload,
    trainerId,
    attempt.id,
  );

  await verifyAndStoreAccount(
    trainerId,
    userId,
    attempt.id,
    accountId,
    country,
  );
}

async function markAttemptForReview(
  attemptId: string,
  stage: string,
  message: string,
  accountId: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("trainer_connect_attempts")
    .update({
      status: "review_required",
      last_error: `${stage}: ${message}`.slice(0, 2000),
      ...(accountId ? { stripe_account_id: accountId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("account_api", "accounts_v2")
    .eq("status", "creating")
    .is("stripe_account_id", null);

  if (error) {
    console.error("V2-accountaanmaak markeren voor controle mislukt:", {
      attemptId,
      accountId,
      code: error.code,
    });
  }
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  const knownCodes = new Set([
    "CONNECT_V2_PAYLOAD_INPUT_INVALID",
    "CONNECT_V2_PAYLOAD_INVALID",
    "CONNECT_V2_PAYLOAD_MISMATCH",
    "CONNECT_V2_EXPECTED_CONTEXT_INVALID",
    "CONNECT_V2_ACCOUNT_ID_MISMATCH",
    "CONNECT_V2_LIVE_ACCOUNT_NOT_ALLOWED",
    "CONNECT_V2_ACCOUNT_CLOSED",
    "CONNECT_V2_DASHBOARD_MISMATCH",
    "CONNECT_V2_TRAINER_METADATA_MISMATCH",
    "CONNECT_V2_ATTEMPT_METADATA_MISMATCH",
    "CONNECT_V2_COUNTRY_MISMATCH",
    "CONNECT_V2_RECIPIENT_NOT_APPLIED",
    "CONNECT_V2_LINK_NOT_CONFIRMED",
    "CONNECT_V2_ATTEMPT_LOOKUP_FAILED",
    "CONNECT_V2_LINKED_ATTEMPT_MISSING",
    "CONNECT_V2_PREPARATION_NOT_CONFIRMED",
    "CONNECT_V2_PREPARATION_INVALID",
    "CONNECT_V2_RESERVATION_INVALID",
    "CONNECT_V2_ACCOUNT_LINK_INVALID",
  ]);

  if (knownCodes.has(message)) return message;

  if (error instanceof Stripe.errors.StripeError) {
    if (error.code === "resource_missing") {
      return "STRIPE_RESOURCE_MISSING";
    }

    if (error.type === "StripeAuthenticationError") {
      return "STRIPE_AUTHENTICATION_ERROR";
    }

    if (error.type === "StripePermissionError") {
      return "STRIPE_PERMISSION_ERROR";
    }

    if (error.type === "StripeConnectionError") {
      return "STRIPE_CONNECTION_ERROR";
    }

    return "STRIPE_REQUEST_ERROR";
  }

  return "CONNECT_OPERATION_NOT_CONFIRMED";
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  let stage = "authentication";
  let attemptId: string | null = null;
  let creationReleased = false;
  let linked = false;
  let createdAccountId: string | null = null;

  try {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!token) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(token);

    if (userError || !user) {
      return json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        401,
      );
    }

    if (
      !stripeKey.startsWith("sk_test_") &&
      !stripeKey.startsWith("rk_test_")
    ) {
      return json(
        { error: "Deze onboarding is voorlopig uitsluitend voor testaccounts." },
        403,
      );
    }

    stage = "trainer_lookup";

    const { data: trainer, error: trainerError } = await supabaseAdmin
      .from("trainers")
      .select(
        "id, stripe_account_id, stripe_account_api, stripe_account_livemode",
      )
      .eq("user_id", user.id)
      .eq("approval_status", "approved")
      .eq("is_active", true)
      .maybeSingle();

    if (trainerError) {
      return json(
        { error: "Je trainerprofiel kon niet worden geladen." },
        503,
      );
    }

    if (!trainer) {
      return json(
        { error: "Geen actief en goedgekeurd trainerprofiel gevonden." },
        403,
      );
    }

    let accountId: string;

    if (trainer.stripe_account_id) {
      if (
        trainer.stripe_account_api !== "accounts_v2" ||
        trainer.stripe_account_livemode !== false
      ) {
        return json(
          {
            code: "CONNECT_EXISTING_LINK_REQUIRES_REVIEW",
            error:
              "Deze bestaande testkoppeling is niet via de nieuwe v2-flow geregistreerd. Er wordt geen ander account aangemaakt of gekoppeld.",
          },
          409,
        );
      }

      stage = "verify_existing_v2_account";

      await verifyExistingLink(
        trainer.id,
        user.id,
        trainer.stripe_account_id,
      );

      accountId = trainer.stripe_account_id;
    } else {
      stage = "reserve_v2_attempt";

      const { data, error } = await supabaseAdmin.rpc(
        "reserve_trainer_connect_v2_attempt",
        {
          p_trainer_id: trainer.id,
          p_user_id: user.id,
        },
      );

      if (error) {
        return json(
          {
            code: "CONNECT_V2_RESERVATION_NOT_CONFIRMED",
            stage,
            error:
              error.code === "P0001" || error.code === "42501"
                ? error.message
                : "De accountaanmaak kon niet worden gereserveerd.",
          },
          error.code === "42501"
            ? 403
            : error.code === "P0001"
              ? 409
              : 503,
        );
      }

      const reservation = data as Reservation | null;

      if (!reservation) {
        throw new Error("CONNECT_V2_RESERVATION_INVALID");
      }

      if (reservation.result === "already_linked") {
        if (!reservation.account_id) {
          throw new Error("CONNECT_V2_RESERVATION_INVALID");
        }

        stage = "verify_existing_v2_account";

        await verifyExistingLink(
          trainer.id,
          user.id,
          reservation.account_id,
        );

        accountId = reservation.account_id;
      } else {
        if (
          !["reserved", "existing_attempt"].includes(reservation.result) ||
          !reservation.attempt_id
        ) {
          throw new Error("CONNECT_V2_RESERVATION_INVALID");
        }

        attemptId = reservation.attempt_id;

        if (reservation.status !== "reserved") {
          return json(
            {
              code: "CONNECT_ATTEMPT_REQUIRES_CHECK",
              attemptId,
              error:
                "Er is al een accountaanmaak gestart of deze vereist controle. Er wordt geen nieuw account aangemaakt.",
            },
            409,
          );
        }

        stage = "prepare_v2_attempt";

        const { data: preparedData, error: prepareError } =
          await supabaseAdmin.rpc("prepare_trainer_connect_v2_attempt", {
            p_attempt_id: attemptId,
            p_user_id: user.id,
          });

        if (prepareError) {
          throw new Error("CONNECT_V2_PREPARATION_NOT_CONFIRMED");
        }

        if (!preparedData) {
          return json(
            {
              code: "CONNECT_ATTEMPT_ALREADY_STARTED",
              attemptId,
              error:
                "De accountaanmaak is al gestart of de trainer is inmiddels gekoppeld. Vernieuw het dashboard.",
            },
            409,
          );
        }

        creationReleased = true;

        const prepared = preparedData as PreparedAttempt;

        if (
          prepared.attempt_id !== attemptId ||
          prepared.trainer_id !== trainer.id ||
          prepared.account_api !== "accounts_v2" ||
          prepared.stripe_livemode !== false ||
          prepared.idempotency_key !== `gowtrain-connect-v2/${attemptId}`
        ) {
          throw new Error("CONNECT_V2_PREPARATION_INVALID");
        }

        const { payload, country } = validateStoredPayload(
          prepared.stripe_payload,
          trainer.id,
          attemptId,
        );

        stage = "create_v2_account";

        const created = await stripe.v2.core.accounts.create(payload, {
          idempotencyKey: prepared.idempotency_key,
        });

        createdAccountId = created.id;
        stage = "verify_and_link_v2_account";

        await verifyAndStoreAccount(
          trainer.id,
          user.id,
          attemptId,
          created.id,
          country,
        );

        linked = true;
        accountId = created.id;
      }
    }

    stage = "check_link_access";

    const { data: currentTrainer, error: accessError } = await supabaseAdmin
      .from("trainers")
      .select("id")
      .eq("id", trainer.id)
      .eq("user_id", user.id)
      .eq("approval_status", "approved")
      .eq("is_active", true)
      .eq("stripe_account_id", accountId)
      .eq("stripe_account_api", "accounts_v2")
      .eq("stripe_account_livemode", false)
      .eq("stripe_account_closed", false)
      .maybeSingle();

    if (accessError || !currentTrainer) {
      return json(
        {
          error:
            "De toegang tot de actuele v2-accountkoppeling kon niet worden bevestigd.",
        },
        accessError ? 503 : 403,
      );
    }

    stage = "create_v2_onboarding_link";

    const accountLink = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          refresh_url: new URL(
            "/trainer-dashboard?stripe=refresh",
            appBaseUrl,
          ).toString(),
          return_url: new URL(
            "/trainer-dashboard?stripe=return",
            appBaseUrl,
          ).toString(),
        },
      },
    });

    if (
      accountLink.account !== accountId ||
      accountLink.livemode !== false ||
      !accountLink.url
    ) {
      throw new Error("CONNECT_V2_ACCOUNT_LINK_INVALID");
    }

    return json({ onboardingUrl: accountLink.url });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Onbekende Connect-fout.";

    console.error("Connect v2-onboarding niet bevestigd:", {
      stage,
      attemptId,
      accountId: createdAccountId,
      message,
    });

    if (attemptId && creationReleased && !linked) {
      try {
        await markAttemptForReview(
          attemptId,
          stage,
          message,
          createdAccountId,
        );
      } catch {
        console.error("V2-herstelregistratie niet bevestigd:", {
          attemptId,
          accountId: createdAccountId,
        });
      }
    }

    return json(
      {
        code: "CONNECT_ONBOARDING_NOT_CONFIRMED",
        stage,
        diagnosticCode: diagnosticCode(error),
        ...(attemptId ? { attemptId } : {}),
        error:
          stage === "create_v2_onboarding_link"
            ? "De accountkoppeling is bevestigd, maar de onboardinglink niet. Je kunt de onboarding opnieuw openen zonder een nieuw account aan te maken."
            : "De onboarding kon niet volledig worden bevestigd. Controle van de bestaande koppeling of aanmaakpoging is nodig.",
      },
      503,
    );
  }
}