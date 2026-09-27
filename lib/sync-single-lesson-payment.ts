import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9]+$/;
const CHARGE_PATTERN = /^(ch|py)_[A-Za-z0-9]+$/;

export type SingleLessonPaymentSyncResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      attemptId: string;
      bookingId: string;
      outcome: "not_succeeded";
    }
  | {
      handled: true;
      attemptId: string;
      bookingId: string;
      outcome: "applied" | "already_applied";
      bookingStatus: string;
    }
  | {
      handled: true;
      attemptId: string;
      bookingId: string;
      outcome: "needs_review";
      reviewCode: string;
    };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("SINGLE_PAYMENT_CONFIGURATION_MISSING");
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

/**
 * Verwerkt uitsluitend nieuwe PaymentSheet-betalingen
 * voor losse lessen.
 *
 * Input is alleen een PaymentIntent-ID.
 * Stripe-objecten worden hier zelf opgehaald, niet vertrouwd
 * vanuit een browserbody of een oud webhookobject.
 *
 * Deze functie:
 * - maakt geen PaymentIntent aan;
 * - geeft geen client secret terug;
 * - annuleert geen betaling;
 * - start geen refund of trainertransfer;
 * - verwerkt geen pakketbetalingen.
 *
 * Geen publieke route rechtstreeks zonder eigenaarscontrole
 * op deze helper aansluiten.
 */
export async function syncSingleLessonPayment(
  paymentIntentId: string
): Promise<SingleLessonPaymentSyncResult> {
  if (!PAYMENT_INTENT_PATTERN.test(paymentIntentId)) {
    throw new Error("SINGLE_PAYMENT_INVALID_INTENT_ID");
  }

  const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("SINGLE_PAYMENT_TEST_MODE_REQUIRED");
  }

  const stripe = new Stripe(stripeKey, {
    timeout: 20_000,
    maxNetworkRetries: 1,
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

  /*
   * Lees ook de eventuele bestaande databasekoppeling.
   * Ontbrekende metadata op een al gekoppelde PaymentIntent
   * mag niet stilzwijgend als "niet onze betaling" verdwijnen.
   */
  const { data: linkedAttempt, error: linkedError } = await admin
    .from("single_lesson_payment_attempts")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (linkedError) {
    throw new Error("SINGLE_PAYMENT_LINK_LOOKUP_FAILED");
  }

  let intent: Stripe.PaymentIntent;

  try {
    // Geen expand: latest_charge blijft een ID.
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    throw new Error("SINGLE_PAYMENT_STRIPE_LOOKUP_FAILED");
  }

  if (intent.id !== paymentIntentId || intent.livemode !== false) {
    throw new Error("SINGLE_PAYMENT_STRIPE_IDENTITY_MISMATCH");
  }

  const metadataAttemptId =
    intent.metadata?.gowtrain_single_payment_attempt_id;

  if (!metadataAttemptId) {
    if (linkedAttempt) {
      throw new Error("SINGLE_PAYMENT_LINKED_METADATA_MISSING");
    }

    // Bestaande Checkout-/pakketbetalingen niet overnemen.
    return { handled: false };
  }

  if (
    !UUID_PATTERN.test(metadataAttemptId) ||
    metadataAttemptId !== metadataAttemptId.toLowerCase()
  ) {
    throw new Error("SINGLE_PAYMENT_INVALID_ATTEMPT_METADATA");
  }

  if (
    linkedAttempt &&
    linkedAttempt.id !== metadataAttemptId
  ) {
    throw new Error("SINGLE_PAYMENT_ATTEMPT_LINK_MISMATCH");
  }

  const { data: attempt, error: attemptError } = await admin
    .from("single_lesson_payment_attempts")
    .select(`
      id,
      booking_id,
      trainer_id,
      channel,
      amount_cents,
      currency,
      stripe_livemode,
      funds_flow,
      first_stripe_request_at,
      stripe_payment_intent_id,
      stripe_checkout_session_id
    `)
    .eq("id", metadataAttemptId)
    .maybeSingle();

  if (attemptError || !attempt) {
    throw new Error("SINGLE_PAYMENT_ATTEMPT_NOT_CONFIRMED");
  }

  if (
    attempt.channel !== "paymentsheet" ||
    attempt.stripe_livemode !== false ||
    attempt.funds_flow !== "separate_transfers_v1" ||
    !attempt.first_stripe_request_at ||
    attempt.stripe_checkout_session_id !== null ||
    (
      attempt.stripe_payment_intent_id !== null &&
      attempt.stripe_payment_intent_id !== intent.id
    ) ||
    !Number.isSafeInteger(attempt.amount_cents) ||
    attempt.amount_cents <= 0 ||
    attempt.currency !== "eur" ||
    intent.amount !== attempt.amount_cents ||
    intent.currency !== attempt.currency ||
    intent.metadata.gowtrain_booking_id !== attempt.booking_id ||
    intent.metadata.gowtrain_trainer_id !== attempt.trainer_id ||
    intent.metadata.gowtrain_funds_flow !== attempt.funds_flow ||
    intent.metadata.gowtrain_payment_channel !== "paymentsheet"
  ) {
    throw new Error("SINGLE_PAYMENT_CONTEXT_MISMATCH");
  }

  /*
   * Niet-succes is geen toestemming om de hold vrij te geven,
   * een nieuwe PaymentIntent te maken of opnieuw te betalen.
   * Veilige afsluiting krijgt een afzonderlijke handeling.
   */
  if (intent.status !== "succeeded") {
    return {
      handled: true,
      attemptId: attempt.id,
      bookingId: attempt.booking_id,
      outcome: "not_succeeded",
    };
  }

  const chargeId = intent.latest_charge;

  if (
    typeof chargeId !== "string" ||
    !CHARGE_PATTERN.test(chargeId)
  ) {
    throw new Error("SINGLE_PAYMENT_CHARGE_REFERENCE_MISSING");
  }

  let charge: Stripe.Charge;

  try {
    // Geen expand: payment_intent blijft een ID.
    charge = await stripe.charges.retrieve(chargeId);
  } catch {
    throw new Error("SINGLE_PAYMENT_CHARGE_LOOKUP_FAILED");
  }

  if (
    charge.id !== chargeId ||
    charge.payment_intent !== intent.id ||
    charge.livemode !== false ||
    charge.amount !== attempt.amount_cents ||
    charge.currency !== attempt.currency
  ) {
    throw new Error("SINGLE_PAYMENT_CHARGE_CONTEXT_MISMATCH");
  }

  /*
   * De database controleert alle noodzakelijke velden opnieuw
   * en vergrendelt betaalpoging, boeking en slot.
   *
   * Alleen deze twee server-side opgehaalde objecten doorgeven.
   * Niet loggen: het PaymentIntent-object bevat een client secret.
   *
   * De RPC gebruikt de objecten voor controles, maar bewaart
   * niet de volledige JSON-objecten of de client secret.
   */
  const { data: result, error: applyError } = await admin.rpc(
    "apply_single_lesson_payment_success",
    {
      p_attempt_id: attempt.id,
      p_payment_intent: intent,
      p_charge: charge,
    }
  );

  if (
    applyError ||
    !isObject(result) ||
    result.attempt_id !== attempt.id ||
    result.booking_id !== attempt.booking_id ||
    result.payment_recorded !== true
  ) {
    throw new Error("SINGLE_PAYMENT_APPLICATION_NOT_CONFIRMED");
  }

  if (result.outcome === "needs_review") {
    if (
      typeof result.review_code !== "string" ||
      !/^[A-Z][A-Z0-9_]{0,79}$/.test(result.review_code)
    ) {
      throw new Error("SINGLE_PAYMENT_REVIEW_NOT_CONFIRMED");
    }

    return {
      handled: true,
      attemptId: attempt.id,
      bookingId: attempt.booking_id,
      outcome: "needs_review",
      reviewCode: result.review_code,
    };
  }

  if (
    (
      result.outcome !== "applied" &&
      result.outcome !== "already_applied"
    ) ||
    typeof result.booking_status !== "string"
  ) {
    throw new Error("SINGLE_PAYMENT_RESULT_INVALID");
  }

  return {
    handled: true,
    attemptId: attempt.id,
    bookingId: attempt.booking_id,
    outcome: result.outcome,
    bookingStatus: result.booking_status,
  };
}