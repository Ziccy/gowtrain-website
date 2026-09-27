import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

import { syncSingleLessonPayment } from "@/lib/sync-single-lesson-payment";

type CloseResult = {
  attemptId: string;
  bookingId: string;
  outcome:
    | "not_due"
    | "requires_review"
    | "payment_pending"
    | "payment_applied"
    | "closed"
    | "already_closed";
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("SINGLE_PAYMENT_CLOSE_CONFIGURATION_MISSING");
  }

  return value;
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/**
 * Alleen vanuit een geautoriseerde servercontext aanroepen.
 *
 * Dit is geen publieke API en doet zelf geen gebruikersauthenticatie.
 * Een toekomstige route moet de bevoegdheid/eigenaar eerst controleren.
 *
 * Geen nieuwe PaymentIntent aanmaken.
 * Geen poging zonder opgeslagen PaymentIntent-ID vrijgeven.
 * Geen refund of trainertransfer uitvoeren.
 */
export async function closeExpiredSingleLessonPayment(
  attemptId: string
): Promise<CloseResult> {
  if (!UUID_PATTERN.test(attemptId)) {
    throw new Error("SINGLE_PAYMENT_CLOSE_INVALID_ID");
  }

  const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("SINGLE_PAYMENT_CLOSE_TEST_MODE_REQUIRED");
  }

  const stripe = new Stripe(stripeKey, {
    timeout: 20_000,
    maxNetworkRetries: 0,
  });

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

  const { data: attemptRow, error: attemptError } = await admin
    .from("single_lesson_payment_attempts")
    .select(`
      id,
      booking_id,
      trainer_id,
      channel,
      status,
      amount_cents,
      currency,
      stripe_livemode,
      funds_flow,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      reservation_expires_at,
      payment_verified_at,
      booking_confirmed_at,
      review_code
    `)
    .eq("id", attemptId.toLowerCase())
    .maybeSingle();

  if (attemptError || !attemptRow) {
    throw new Error("SINGLE_PAYMENT_CLOSE_ATTEMPT_NOT_CONFIRMED");
  }

  const attempt = attemptRow;

  const result = (
    outcome: CloseResult["outcome"]
  ): CloseResult => ({
    attemptId: attempt.id,
    bookingId: attempt.booking_id,
    outcome,
  });

  if (
    attempt.channel !== "paymentsheet" ||
    attempt.stripe_livemode !== false ||
    attempt.funds_flow !== "separate_transfers_v1" ||
    attempt.currency !== "eur" ||
    !Number.isSafeInteger(attempt.amount_cents) ||
    attempt.amount_cents <= 0 ||
    attempt.stripe_checkout_session_id !== null
  ) {
    throw new Error("SINGLE_PAYMENT_CLOSE_CONTEXT_INVALID");
  }

  if (attempt.status === "succeeded") {
    // Geen uitspraak opnieuw over de actuele boekingsstatus.
    return result("payment_applied");
  }

  if (
    attempt.status === "needs_review" ||
    attempt.review_code !== null ||
    attempt.payment_verified_at !== null ||
    attempt.booking_confirmed_at !== null
  ) {
    return result("requires_review");
  }

  const expiresAt = Date.parse(attempt.reservation_expires_at);

  if (!Number.isFinite(expiresAt)) {
    throw new Error("SINGLE_PAYMENT_CLOSE_EXPIRY_INVALID");
  }

  if (expiresAt > Date.now()) {
    return result("not_due");
  }

  if (
    typeof attempt.stripe_payment_intent_id !== "string" ||
    !/^pi_[A-Za-z0-9]+$/.test(attempt.stripe_payment_intent_id)
  ) {
    /*
     * Er kan al een Stripe-object bestaan terwijl de koppeling
     * verloren ging. Een leeg veld bewijst geen veilige vrijgave.
     */
    return result("requires_review");
  }

  if (!["open", "processing", "cancelled"].includes(attempt.status)) {
    return result("requires_review");
  }

  const intentId = attempt.stripe_payment_intent_id;

  const expectedMetadata: Record<string, string> = {
    gowtrain_single_payment_attempt_id: attempt.id,
    gowtrain_booking_id: attempt.booking_id,
    gowtrain_trainer_id: attempt.trainer_id,
    gowtrain_funds_flow: attempt.funds_flow,
    gowtrain_payment_channel: "paymentsheet",
  };

  function validateIntent(intent: Stripe.PaymentIntent): void {
    const metadata = intent.metadata ?? {};

    if (
      intent.id !== intentId ||
      intent.livemode !== false ||
      intent.amount !== attempt.amount_cents ||
      intent.currency !== attempt.currency ||
      intent.capture_method !== "automatic" ||
      intent.confirmation_method !== "automatic" ||
      intent.transfer_data != null ||
      intent.on_behalf_of != null ||
      intent.application_fee_amount != null ||
      Object.keys(metadata).length !==
        Object.keys(expectedMetadata).length ||
      Object.entries(expectedMetadata).some(
        ([key, value]) => metadata[key] !== value
      )
    ) {
      throw new Error("SINGLE_PAYMENT_CLOSE_STRIPE_CONTEXT_MISMATCH");
    }
  }

  async function handlePaid(): Promise<CloseResult> {
    const synced = await syncSingleLessonPayment(intentId);

    if (!synced.handled || synced.outcome === "not_succeeded") {
      throw new Error("SINGLE_PAYMENT_CLOSE_SUCCESS_NOT_CONFIRMED");
    }

    return result(
      synced.outcome === "needs_review"
        ? "requires_review"
        : "payment_applied"
    );
  }

  let intent: Stripe.PaymentIntent;

  try {
    intent = await stripe.paymentIntents.retrieve(intentId);
  } catch {
    throw new Error("SINGLE_PAYMENT_CLOSE_STRIPE_LOOKUP_FAILED");
  }

  validateIntent(intent);

  if (intent.status === "succeeded") {
    return handlePaid();
  }

  /*
   * Een reeds afgehandelde poging hoort niet opnieuw actief
   * bij Stripe te zijn. Niet alsnog een betaalactie uitvoeren.
   */
  if (
    attempt.status === "cancelled" &&
    intent.status !== "canceled"
  ) {
    throw new Error("SINGLE_PAYMENT_CLOSE_TERMINAL_STATE_MISMATCH");
  }

  if (
    intent.status === "processing" ||
    intent.status === "requires_action"
  ) {
    return result("payment_pending");
  }

  if (intent.status === "requires_capture") {
    return result("requires_review");
  }

  if (
    intent.status === "requires_payment_method" ||
    intent.status === "requires_confirmation"
  ) {
    if (intent.amount_received !== 0) {
      return result("requires_review");
    }

    /*
     * Een betaling kan tussen retrieve en cancel veranderen.
     * Stripe beslist of annulering nog mogelijk is.
     *
     * Gebruik het cancelantwoord niet zelfstandig als eindbewijs.
     */
    try {
      await stripe.paymentIntents.cancel(
        intentId,
        { cancellation_reason: "abandoned" },
        {
          idempotencyKey:
            `gowtrain-single-payment-cancel/${attempt.id}`,
        }
      );
    } catch {
      /*
       * Geen blinde herhaling.
       * De annulering kan zijn gelukt of de betaling kan juist
       * inmiddels gestart/geslaagd zijn. Opnieuw ophalen.
       */
    }

    try {
      intent = await stripe.paymentIntents.retrieve(intentId);
    } catch {
      throw new Error("SINGLE_PAYMENT_CLOSE_CANCEL_OUTCOME_UNKNOWN");
    }

    validateIntent(intent);
  }

  if (intent.status === "succeeded") {
    return handlePaid();
  }

  if (
    intent.status === "processing" ||
    intent.status === "requires_action"
  ) {
    return result("payment_pending");
  }

  if (intent.status !== "canceled") {
    throw new Error("SINGLE_PAYMENT_CLOSE_CANCELLATION_NOT_CONFIRMED");
  }

  if (intent.amount_received !== 0) {
    return result("requires_review");
  }

  /*
   * Alleen de noodzakelijke geverifieerde velden doorgeven.
   * Geen client secret of volledig Stripe-object naar de RPC.
   *
   * De database controleert opnieuw de koppeling en vergrendelt
   * betaalpoging, boeking en slot voordat zij afsluit.
   */
  const { data: closed, error: closeError } = await admin.rpc(
    "close_cancelled_single_lesson_payment",
    {
      p_attempt_id: attempt.id,
      p_payment_intent: {
        id: intent.id,
        object: intent.object,
        status: intent.status,
        livemode: intent.livemode,
        amount: intent.amount,
        amount_received: intent.amount_received,
        currency: intent.currency,
        metadata: intent.metadata,
        transfer_data: intent.transfer_data,
        on_behalf_of: intent.on_behalf_of,
        application_fee_amount: intent.application_fee_amount,
      },
    }
  );

  if (
    closeError ||
    !isObject(closed) ||
    closed.attempt_id !== attempt.id ||
    closed.booking_id !== attempt.booking_id ||
    !["closed", "already_closed"].includes(String(closed.outcome))
  ) {
    throw new Error("SINGLE_PAYMENT_CLOSE_DATABASE_NOT_CONFIRMED");
  }

  return result(
    closed.outcome === "already_closed"
      ? "already_closed"
      : "closed"
  );
}