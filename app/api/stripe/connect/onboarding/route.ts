import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripeKey = requiredEnv("STRIPE_SECRET_KEY");
const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
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
  stripe_payload: Stripe.AccountCreateParams;
  idempotency_key: string;
};

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isSandboxKey(): boolean {
  return (
    stripeKey.startsWith("sk_test_") ||
    stripeKey.startsWith("rk_test_")
  );
}

async function retrieveTrainerAccount(
  accountId: string,
  trainerId: string,
): Promise<Stripe.Account> {
  const account = await stripe.accounts.retrieve(accountId);

  if (account.id !== accountId) {
    throw new Error("CONNECT_ACCOUNT_ID_MISMATCH");
  }

  if (account.type !== "express") {
    throw new Error("CONNECT_ACCOUNT_NOT_EXPRESS");
  }

  const metadataTrainerId =
    account.metadata?.gowtrain_trainer_id?.trim();

  if (!metadataTrainerId) {
    throw new Error("CONNECT_TRAINER_METADATA_MISSING");
  }

  if (metadataTrainerId !== trainerId) {
    throw new Error("CONNECT_TRAINER_METADATA_MISMATCH");
  }

  return account;
}

/*
 * Bestaande koppeling behouden.
 * Alleen statusvelden bijwerken, nooit het account-ID vervangen.
 */
async function syncLinkedAccount(
  trainerId: string,
  userId: string,
  account: Stripe.Account,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("trainers")
    .update({
      stripe_details_submitted: account.details_submitted === true,
      stripe_charges_enabled: account.charges_enabled === true,
      stripe_payouts_enabled: account.payouts_enabled === true,
      stripe_onboarding_completed_at:
        account.details_submitted && account.payouts_enabled
          ? new Date().toISOString()
          : null,
    })
    .eq("id", trainerId)
    .eq("user_id", userId)
    .eq("approval_status", "approved")
    .eq("is_active", true)
    .eq("stripe_account_id", account.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      "De status van de bestaande accountkoppeling kon niet worden bevestigd.",
    );
  }
}

/*
 * Geen reset naar reserved.
 * Een creating-opdracht kan al een Stripe-account hebben.
 */
async function markAttemptForReview(
  attemptId: string,
  message: string,
  accountId: string | null,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("trainer_connect_attempts")
    .update({
      status: "review_required",
      last_error: message.slice(0, 2000),
      ...(accountId ? { stripe_account_id: accountId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("status", "creating")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Connect-aanmaak markeren voor controle mislukt:", {
      attemptId,
      accountId,
      code: error.code,
    });
  } else if (!data) {
    console.warn("Connect-poging niet op review gezet; status al gewijzigd:", {
      attemptId,
      accountId,
    });
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  let attemptId: string | null = null;
  let creationReleased = false;
  let linked = false;
  let createdAccountId: string | null = null;
  let stage = "authentication";

  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (!token) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
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

    /*
     * Tijdelijke omgevingsgrens.
     * Ook bestaande accounts worden via deze route voorlopig
     * uitsluitend met een sandboxkey benaderd.
     */
    if (!isSandboxKey()) {
      return json(
        {
          error:
            "Deze Connect-onboarding is tijdens de bouw uitsluitend beschikbaar in de sandbox.",
        },
        403,
      );
    }

    stage = "trainer_lookup";

    const { data: trainer, error: trainerError } = await supabaseAdmin
      .from("trainers")
      .select("id, stripe_account_id")
      .eq("user_id", user.id)
      .eq("approval_status", "approved")
      .eq("is_active", true)
      .maybeSingle();

    if (trainerError) {
      return json(
        { error: "Je trainerprofiel kon tijdelijk niet worden geladen." },
        503,
      );
    }

    if (!trainer) {
      return json(
        { error: "Er is geen actief en goedgekeurd trainerprofiel gevonden." },
        403,
      );
    }

    let accountId: string;

    if (trainer.stripe_account_id) {
      stage = "existing_account";

      const account = await retrieveTrainerAccount(
        trainer.stripe_account_id,
        trainer.id,
      );

      await syncLinkedAccount(trainer.id, user.id, account);
      accountId = account.id;
    } else {
      stage = "reserve_attempt";

      const { data: reservationData, error: reservationError } =
        await supabaseAdmin.rpc("reserve_trainer_connect_attempt", {
          p_trainer_id: trainer.id,
          p_user_id: user.id,
          p_stripe_livemode: false,
        });

      if (reservationError) {
        return json(
          {
            error:
              reservationError.code === "P0001" ||
              reservationError.code === "42501"
                ? reservationError.message
                : "De accountaanmaak kon niet worden gereserveerd.",
          },
          reservationError.code === "42501" ? 403 : 409,
        );
      }

      const reservation = reservationData as Reservation | null;

      if (!reservation) {
        throw new Error("Geen geldige reserveringsbevestiging ontvangen.");
      }

      if (reservation.result === "already_linked") {
        if (!reservation.account_id) {
          throw new Error("De bevestigde accountkoppeling ontbreekt.");
        }

        const account = await retrieveTrainerAccount(
          reservation.account_id,
          trainer.id,
        );

        await syncLinkedAccount(trainer.id, user.id, account);
        accountId = account.id;
      } else {
        if (
          !["reserved", "existing_attempt"].includes(reservation.result) ||
          !reservation.attempt_id
        ) {
          throw new Error("De accountaanmaakpoging is ongeldig.");
        }

        attemptId = reservation.attempt_id;

        if (reservation.status !== "reserved") {
          return json(
            {
              code: "CONNECT_ATTEMPT_REQUIRES_CHECK",
              attemptId,
              error:
                "Er is al een accountaanmaak gestart of deze vereist controle. Er wordt geen nieuw Stripe-account aangemaakt. Vernieuw het dashboard; blijft dit zo, neem contact op met Gowtrain.",
            },
            409,
          );
        }

        stage = "prepare_attempt";

        const { data: preparedData, error: prepareError } =
          await supabaseAdmin.rpc("prepare_trainer_connect_attempt", {
            p_attempt_id: attemptId,
            p_user_id: user.id,
          });

        if (prepareError) {
          /*
           * De RPC kan bij een verbindingsprobleem al gecommit zijn.
           * Geen accounts.create zonder bevestigde voorbereiding.
           */
          throw new Error(
            "De voorbereiding kon niet worden bevestigd. Controleer de bestaande poging.",
          );
        }

        if (!preparedData) {
          return json(
            {
              code: "CONNECT_ATTEMPT_ALREADY_STARTED",
              attemptId,
              error:
                "Deze accountaanmaak is al gestart of de trainer is inmiddels gekoppeld. Vernieuw het dashboard. Er is door deze aanroep geen nieuw account aangemaakt.",
            },
            409,
          );
        }

        creationReleased = true;

        const prepared = preparedData as PreparedAttempt;
        const payload = prepared.stripe_payload;
        const metadata = payload?.metadata;

        if (
          prepared.attempt_id !== attemptId ||
          prepared.trainer_id !== trainer.id ||
          !prepared.idempotency_key ||
          !payload ||
          payload.type !== "express" ||
          !["NL", "BE"].includes(payload.country ?? "") ||
          payload.business_type !== "individual" ||
          payload.capabilities?.transfers?.requested !== true ||
          !metadata ||
          typeof metadata !== "object" ||
          Array.isArray(metadata) ||
          metadata.gowtrain_trainer_id !== trainer.id ||
          metadata.gowtrain_connect_attempt_id !== attemptId
        ) {
          throw new Error("De voorbereide accountaanvraag is inconsistent.");
        }

        stage = "create_account";

        /*
         * Uitsluitend de exact opgeslagen aanvraag gebruiken.
         * Geen automatische retry na een onzekere uitkomst.
         */
        const created = await stripe.accounts.create(payload, {
          idempotencyKey: prepared.idempotency_key,
        });

        createdAccountId = created.id;

        stage = "verify_created_account";

        const verified = await retrieveTrainerAccount(
          created.id,
          trainer.id,
        );

        if (
          verified.metadata?.gowtrain_connect_attempt_id !== attemptId ||
          verified.country !== payload.country ||
          verified.business_type !== payload.business_type
        ) {
          throw new Error(
            "Het aangemaakte account wijkt af van de opgeslagen aanvraag.",
          );
        }

        stage = "link_account";

        const { data: linkResult, error: linkError } =
          await supabaseAdmin.rpc(
            "link_verified_trainer_connect_account",
            {
              p_attempt_id: attemptId,
              p_user_id: user.id,
              p_account_id: verified.id,
              p_details_submitted: verified.details_submitted === true,
              p_charges_enabled: verified.charges_enabled === true,
              p_payouts_enabled: verified.payouts_enabled === true,
            },
          );

        if (linkError || linkResult !== true) {
          throw new Error(
            "Het Stripe-account bestaat, maar de koppeling kon niet worden bevestigd.",
          );
        }

        linked = true;
        accountId = verified.id;
      }
    }

    /*
     * Nogmaals de actuele eigenaar en opgeslagen bestemming controleren
     * voordat een onboardinglink wordt gemaakt.
     */
    stage = "check_link_access";

    const { data: currentTrainer, error: accessError } =
      await supabaseAdmin
        .from("trainers")
        .select("id")
        .eq("id", trainer.id)
        .eq("user_id", user.id)
        .eq("approval_status", "approved")
        .eq("is_active", true)
        .eq("stripe_account_id", accountId)
        .maybeSingle();

    if (accessError || !currentTrainer) {
      return json(
        {
          error:
            "De huidige toegang tot het gekoppelde Stripe-account kon niet worden bevestigd.",
        },
        accessError ? 503 : 403,
      );
    }

    stage = "create_onboarding_link";

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: new URL(
        "/trainer-dashboard?stripe=refresh",
        appBaseUrl,
      ).toString(),
      return_url: new URL(
        "/trainer-dashboard?stripe=return",
        appBaseUrl,
      ).toString(),
      type: "account_onboarding",
    });

    return json({
      onboardingUrl: accountLink.url,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Onbekende Connect-fout.";

    console.error("Connect-onboarding kon niet worden afgerond:", {
      stage,
      attemptId,
      accountId: createdAccountId,
      message,
    });

    if (attemptId && creationReleased && !linked) {
      try {
        await markAttemptForReview(
          attemptId,
          `${stage}: ${message}`,
          createdAccountId,
        );
      } catch {
        console.error("Connect-herstelregistratie niet bevestigd:", {
          attemptId,
          accountId: createdAccountId,
        });
      }
    }

    /*
     * Als alleen de onboardinglink mislukt, blijft het al gekoppelde
     * account behouden. Een volgende klik gebruikt datzelfde account.
     */
const safeValidationCodes = new Set([
      "CONNECT_ACCOUNT_ID_MISMATCH",
      "CONNECT_ACCOUNT_NOT_EXPRESS",
      "CONNECT_TRAINER_METADATA_MISSING",
      "CONNECT_TRAINER_METADATA_MISMATCH",
    ]);

    let diagnosticCode = "CONNECT_OPERATION_NOT_CONFIRMED";

    if (safeValidationCodes.has(message)) {
      diagnosticCode = message;
    } else if (error instanceof Stripe.errors.StripeError) {
      if (error.code === "resource_missing") {
        diagnosticCode = "STRIPE_RESOURCE_MISSING";
      } else if (error.type === "StripeAuthenticationError") {
        diagnosticCode = "STRIPE_AUTHENTICATION_ERROR";
      } else if (error.type === "StripePermissionError") {
        diagnosticCode = "STRIPE_PERMISSION_ERROR";
      } else if (error.type === "StripeConnectionError") {
        diagnosticCode = "STRIPE_CONNECTION_ERROR";
      } else {
        diagnosticCode = "STRIPE_REQUEST_ERROR";
      }
    }

    return json(
      {
        code: "CONNECT_ONBOARDING_NOT_CONFIRMED",
        stage,
        diagnosticCode,
        ...(attemptId ? { attemptId } : {}),
        error:
          stage === "create_onboarding_link"
            ? "Het account is gekoppeld, maar de onboardinglink kon niet worden gemaakt. Je kunt de onboarding opnieuw openen zonder een nieuw account aan te maken."
            : "De onboarding kon niet volledig worden bevestigd. Controle van de bestaande koppeling of aanmaakpoging is nodig.",
      },
      503,
    );
  }
}