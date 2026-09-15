import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { confirmPaidPackageSessionById } from "@/lib/confirm-paid-package-session";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripeKey = requiredEnv("STRIPE_SECRET_KEY");
const cronSecret = requiredEnv("CRON_SECRET");

const stripe = new Stripe(stripeKey, {
  timeout: 10_000,
  maxNetworkRetries: 0,
});

const supabaseAdmin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

type PackageAttempt = {
  id: string;
  package_id: string;
  player_id: string;
  trainer_id: string;
  checkout_mode: string;
  status: string;
  amount_cents: number;
  currency: string;
  stripe_livemode: boolean;
  funds_flow: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  reservation_expires_at: string;
};

type CleanupResult = {
  attemptId: string;
  outcome: "released" | "confirmed" | "skipped" | "error";
  reason: string;
};

function getStripeLivemode(): boolean {
  if (
    stripeKey.startsWith("sk_test_") ||
    stripeKey.startsWith("rk_test_")
  ) {
    return false;
  }

  if (
    stripeKey.startsWith("sk_live_") ||
    stripeKey.startsWith("rk_live_")
  ) {
    return true;
  }

  throw new Error("Onbekend Stripe-keyformaat.");
}

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

/*
 * Controleer een bestaande Stripe Checkout Session.
 *
 * Deze functie geeft alleen vrij wanneer Stripe bevestigt:
 * - Session is expired;
 * - payment_status is unpaid;
 * - er is geen Payment Intent.
 */
async function inspectAndRelease(
  attempt: PackageAttempt
): Promise<CleanupResult> {
  try {
    const session = await stripe.checkout.sessions.retrieve(
      attempt.stripe_checkout_session_id
    );

    const expectedUiMode =
      attempt.checkout_mode === "embedded"
        ? "embedded_page"
        : attempt.checkout_mode === "hosted"
          ? "hosted"
          : null;

    const matches =
      expectedUiMode !== null &&
      session.mode === "payment" &&
      String(session.ui_mode) === expectedUiMode &&
      session.id === attempt.stripe_checkout_session_id &&
      session.livemode === attempt.stripe_livemode &&
      session.client_reference_id === attempt.id &&
      session.metadata?.gowtrain_checkout_attempt_id === attempt.id &&
      session.metadata?.package_id === attempt.package_id &&
      session.metadata?.player_id === attempt.player_id &&
      session.metadata?.trainer_id === attempt.trainer_id &&
      session.metadata?.booking_type === "package" &&
      session.metadata?.gowtrain_funds_flow ===
        "separate_transfers_v1" &&
      attempt.funds_flow === "separate_transfers_v1" &&
      session.amount_total === attempt.amount_cents &&
      session.currency === attempt.currency;

    if (!matches) {
      console.warn(
        "Pakketvrijgave geblokkeerd: Stripe-data wijkt af.",
        {
          attemptId: attempt.id,
        }
      );

      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "Stripe-gegevens wijken af. Handmatige controle nodig.",
      };
    }

    if (session.payment_status === "paid") {
  const purchaseId = await confirmPaidPackageSessionById(
    session.id,
    attempt.id
  );

  console.log("Betaalde pakketaankoop hersteld via periodieke controle:", {
    attemptId: attempt.id,
    purchaseId,
  });

  return {
    attemptId: attempt.id,
    outcome: "confirmed",
    reason:
      "De geslaagde pakketbetaling is bevestigd of was al verwerkt.",
  };
}

    if (session.status !== "expired") {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "Stripe Checkout is nog niet verlopen. Niet vrijgegeven.",
      };
    }

    if (session.payment_status !== "unpaid") {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "Onverwachte betaalstatus. Niet vrijgegeven.",
      };
    }

    if (attempt.paid_at !== null) {
  return {
    attemptId: attempt.id,
    outcome: "skipped",
    reason:
      "Er staat een betaaldatum geregistreerd. Niet vrijgegeven.",
  };
}

const paymentIntentId =
  typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

let cancelledPaymentIntentId: string | null = null;

if (paymentIntentId) {
  /*
   * De Session is hierboven al gecontroleerd op:
   * - juiste betaalpoging;
   * - expired;
   * - unpaid.
   *
   * Controleer nu ook de gekoppelde Payment Intent.
   */
  const paymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntentId
  );

  const paymentIntentMatches =
    paymentIntent.livemode === attempt.stripe_livemode &&
    paymentIntent.amount === attempt.amount_cents &&
    paymentIntent.currency === attempt.currency &&
    paymentIntent.metadata.gowtrain_checkout_attempt_id ===
      attempt.id &&
    paymentIntent.metadata.package_id === attempt.package_id &&
    paymentIntent.metadata.player_id === attempt.player_id &&
    paymentIntent.metadata.trainer_id === attempt.trainer_id &&
    paymentIntent.metadata.booking_type === "package" &&
    paymentIntent.metadata.gowtrain_funds_flow ===
      "separate_transfers_v1" &&
    paymentIntent.transfer_data == null &&
    paymentIntent.application_fee_amount == null &&
    paymentIntent.on_behalf_of == null &&
    (
      attempt.stripe_payment_intent_id === null ||
      attempt.stripe_payment_intent_id === paymentIntent.id
    );

  if (!paymentIntentMatches) {
    return {
      attemptId: attempt.id,
      outcome: "skipped",
      reason:
        "De Payment Intent komt niet overeen met deze betaalpoging. Niet vrijgegeven.",
    };
  }

  if (
    paymentIntent.status !== "canceled" ||
    paymentIntent.amount_received !== 0 ||
    paymentIntent.canceled_at === null
  ) {
    return {
      attemptId: attempt.id,
      outcome: "skipped",
      reason:
        "De Payment Intent is niet definitief geannuleerd zonder ontvangen bedrag. Niet vrijgegeven.",
    };
  }

  cancelledPaymentIntentId = paymentIntent.id;
} else if (attempt.stripe_payment_intent_id !== null) {
  return {
    attemptId: attempt.id,
    outcome: "skipped",
    reason:
      "De database bevat een Payment Intent die ontbreekt bij de Stripe Session. Eerst controleren.",
  };
}

    /*
     * Stripe heeft de veilige situatie bevestigd.
     *
     * De databasefunctie vergrendelt vervolgens pakket en poging
     * en controleert opnieuw of afsluiten nog is toegestaan.
     */
    /*
 * Kies de juiste afsluitfunctie.
 *
 * Beide situaties vereisen een verlopen, onbetaalde Session:
 * 1. Geen Payment Intent.
 * 2. Geverifieerde canceled Payment Intent met amount_received = 0.
 */
const {
  data: closed,
  error: closeError,
} = cancelledPaymentIntentId
  ? await supabaseAdmin.rpc(
      "close_cancelled_package_payment",
      {
        p_attempt_id: attempt.id,
        p_checkout_session_id: session.id,
        p_payment_intent_id: cancelledPaymentIntentId,
      }
    )
  : await supabaseAdmin.rpc(
      "close_expired_package_checkout",
      {
        p_attempt_id: attempt.id,
        p_checkout_session_id: session.id,
      }
    );

    if (closeError) {
      console.error("Pakketbetaalpoging afsluiten mislukt:", {
        attemptId: attempt.id,
        code: closeError.code,
        message: closeError.message,
      });

      return {
        attemptId: attempt.id,
        outcome: "error",
        reason:
          "Databaseafsluiting kon niet worden bevestigd. Later opnieuw controleren.",
      };
    }

    if (closed !== true) {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "De database staat vrijgave niet toe. Mogelijk is de poging ondertussen gewijzigd.",
      };
    }

    console.log("Verlopen pakketbetaalpoging afgesloten:", {
      attemptId: attempt.id,
      checkoutSessionId: session.id,
    });

    return {
      attemptId: attempt.id,
      outcome: "released",
      reason:
        "Verlopen, onbetaalde pakketbetaalpoging afgesloten.",
    };
  } catch (error: unknown) {
    console.error("Stripe-controle voor pakketvrijgave mislukt:", {
      attemptId: attempt.id,
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return {
      attemptId: attempt.id,
      outcome: "error",
      reason:
        "Controle niet afgerond. Geen vrijgave op basis van deze fout.",
    };
  }
}

/*
 * Plan de volgende controle voordat Stripe wordt aangeroepen.
 *
 * Zo blijven overgeslagen pogingen niet telkens de eerste
 * plekken van de batch bezet houden.
 */
async function scheduleAndInspect(
  attempt: PackageAttempt
): Promise<CleanupResult> {
  try {
    const checkedAt = new Date();

    const nextCheckAt = new Date(
      checkedAt.getTime() + 10 * 60 * 1000
    );

    const {
      data: scheduledAttempt,
      error: scheduleError,
    } = await supabaseAdmin
      .from("checkout_attempts")
      .update({
        next_cleanup_check_at: nextCheckAt.toISOString(),
        updated_at: checkedAt.toISOString(),
      })
      .eq("id", attempt.id)
      .in("status", ["open", "payment_processing"])
      .eq(
        "stripe_checkout_session_id",
        attempt.stripe_checkout_session_id
      )
      .lte(
        "next_cleanup_check_at",
        checkedAt.toISOString()
      )
      .select("id")
      .maybeSingle();

    if (scheduleError) {
      console.error("Volgende pakketcontrole plannen mislukt:", {
        attemptId: attempt.id,
        code: scheduleError.code,
        message: scheduleError.message,
      });

      return {
        attemptId: attempt.id,
        outcome: "error",
        reason:
          "De volgende controle kon niet worden gepland. Geen vrijgave uitgevoerd.",
      };
    }

    if (!scheduledAttempt) {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "De poging is gewijzigd of een andere uitvoering heeft de controle al ingepland.",
      };
    }

    return await inspectAndRelease(attempt);
  } catch (error: unknown) {
    console.error("Pakketcontrole voorbereiden mislukt:", {
      attemptId: attempt.id,
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return {
      attemptId: attempt.id,
      outcome: "error",
      reason:
        "De controle kon niet worden voorbereid. Later opnieuw controleren.",
    };
  }
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  if (
    request.headers.get("authorization") !==
    `Bearer ${cronSecret}`
  ) {
    return json(
      { error: "Niet geautoriseerd." },
      401
    );
  }

  let closedBeforeStripe = 0;

  try {
    const livemode = getStripeLivemode();

    /*
     * 1. Sluit verlopen reserved-pogingen af waarvoor
     * nog nooit een Stripe-aanroep is voorbereid.
     *
     * De databasefunctie controleert dit opnieuw onder locks.
     * Creating-pogingen vallen hier nadrukkelijk niet onder.
     */
    const {
      data: unstartedClosed,
      error: unstartedError,
    } = await supabaseAdmin.rpc(
      "close_unstarted_package_checkouts",
      {
        p_stripe_livemode: livemode,
        p_limit: 20,
      }
    );

    if (unstartedError) {
      console.error(
        "Niet-gestarte pakketpogingen afsluiten mislukt:",
        {
          code: unstartedError.code,
          message: unstartedError.message,
        }
      );

      return json(
        {
          success: false,
          error:
            "Niet-gestarte pakketreserveringen konden niet worden afgesloten.",
        },
        503
      );
    }

    if (
      typeof unstartedClosed !== "number" ||
      !Number.isInteger(unstartedClosed) ||
      unstartedClosed < 0
    ) {
      throw new Error(
        "De database gaf geen geldig aantal afgesloten reserveringen terug."
      );
    }

    closedBeforeStripe = unstartedClosed;

    if (closedBeforeStripe > 0) {
      console.log("Niet-gestarte pakketreserveringen afgesloten:", {
        count: closedBeforeStripe,
      });
    }

    /*
     * 2. Selecteer open pogingen met een opgeslagen Session-ID.
     *
     * Alleen dezelfde Stripe-omgeving wordt verwerkt.
     * Creating, payment_processing en review_required
     * worden nog niet automatisch afgehandeld.
     */
    const selectionTime = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("checkout_attempts")
      .select(
        `
          id,
          package_id,
          player_id,
          trainer_id,
          checkout_mode,
          status,
          amount_cents,
          currency,
          stripe_livemode,
          funds_flow,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          paid_at,
          reservation_expires_at
        `
      )
      .not("package_id", "is", null)
      .not("stripe_checkout_session_id", "is", null)
      .in("status", ["open", "payment_processing"])
      .eq("stripe_livemode", livemode)
      .eq("funds_flow", "separate_transfers_v1")
      .lte("reservation_expires_at", selectionTime)
      .lte("next_cleanup_check_at", selectionTime)
      .order("next_cleanup_check_at", { ascending: true })
      .order("reservation_expires_at", { ascending: true })
      .limit(5);

    if (error) {
      console.error("Verlopen pakketpogingen ophalen mislukt:", {
        code: error.code,
        message: error.message,
      });

      return json(
        {
          success: false,
          closedBeforeStripe,
          error:
            "Pakketbetaalpogingen konden niet worden opgehaald.",
        },
        503
      );
    }

    const attempts = (data ?? []) as PackageAttempt[];

    /*
     * 3. Plan en controleer maximaal vijf Stripe Sessions.
     */
    const results: CleanupResult[] = await Promise.all(
      attempts.map(scheduleAndInspect)
    );

    const released = results.filter(
      (result) => result.outcome === "released"
    ).length;

    const skipped = results.filter(
      (result) => result.outcome === "skipped"
    ).length;

    const errors = results.filter(
      (result) => result.outcome === "error"
    ).length;

    const confirmed = results.filter(
  (result) => result.outcome === "confirmed"
).length;

    return json(
      {
        success: errors === 0,
        closedBeforeStripe,
        checked: attempts.length,
        confirmed,
        released,
        skipped,
        errors,
        results,
      },
      errors > 0 ? 503 : 200
    );
  } catch (error: unknown) {
    console.error("Pakketopruiming mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return json(
      {
        success: false,
        closedBeforeStripe,
        error: "De pakketopruiming kon niet worden afgerond.",
      },
      500
    );
  }
}