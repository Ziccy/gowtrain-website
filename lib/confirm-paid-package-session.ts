import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
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

/*
 * Uitsluitend server-side gebruiken.
 *
 * Haalt de actuele Stripe Session en Payment Intent op.
 * Controleert ze tegen de opgeslagen betaalpoging.
 * Bevestigt daarna de aankoop via de bestaande transactionele RPC.
 *
 * Maakt geen betaling, refund of transfer aan.
 */
export async function confirmPaidPackageSessionById(
  checkoutSessionId: string,
  expectedAttemptId?: string
): Promise<string> {
  const session = await stripe.checkout.sessions.retrieve(
    checkoutSessionId
  );

  const attemptId =
    session.metadata?.gowtrain_checkout_attempt_id?.trim();

  const packageId = session.metadata?.package_id?.trim();
  const playerId = session.metadata?.player_id?.trim();

  if (
    !attemptId ||
    !packageId ||
    !playerId ||
    session.metadata?.booking_type !== "package" ||
    session.metadata?.gowtrain_funds_flow !==
      "separate_transfers_v1" ||
    (expectedAttemptId && expectedAttemptId !== attemptId)
  ) {
    throw new Error(
      "De Stripe Session bevat geen geldige pakketbetaalpoging."
    );
  }

  if (
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid"
  ) {
    throw new Error(
      "De pakketbetaling is niet definitief geslaagd."
    );
  }

  const amountTotal = session.amount_total;
  const currency = session.currency;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (
    !paymentIntentId ||
    typeof amountTotal !== "number" ||
    !Number.isSafeInteger(amountTotal) ||
    amountTotal <= 0 ||
    currency !== "eur"
  ) {
    throw new Error("De betaalgegevens zijn ongeldig.");
  }

  const { data: attempt, error: attemptError } =
    await supabaseAdmin
      .from("checkout_attempts")
      .select(
        `
          id,
          package_id,
          booking_id,
          player_id,
          trainer_id,
          amount_cents,
          currency,
          stripe_livemode,
          funds_flow,
          stripe_checkout_session_id,
          stripe_payment_intent_id
        `
      )
      .eq("id", attemptId)
      .maybeSingle();

  if (attemptError) {
    throw new Error(
      `Betaalpoging ophalen mislukt: ${attemptError.message}`
    );
  }

  if (!attempt) {
    throw new Error("De geregistreerde betaalpoging ontbreekt.");
  }

  if (
    attempt.package_id !== packageId ||
    attempt.booking_id !== null ||
    attempt.player_id !== playerId ||
    session.client_reference_id !== attempt.id ||
    session.metadata?.trainer_id !== attempt.trainer_id ||
    attempt.amount_cents !== amountTotal ||
    attempt.currency !== currency ||
    attempt.stripe_livemode !== session.livemode ||
    attempt.funds_flow !== "separate_transfers_v1" ||
    attempt.stripe_checkout_session_id !== session.id ||
    (
      attempt.stripe_payment_intent_id !== null &&
      attempt.stripe_payment_intent_id !== paymentIntentId
    )
  ) {
    throw new Error(
      "De Stripe Session komt niet overeen met de betaalpoging."
    );
  }

  /*
   * Als deze Session al correct verwerkt is, is er niets
   * meer te bevestigen. Dit mag ook na een latere refund:
   * we maken geen nieuwe aankoop of lessen aan.
   */
  const { data: purchase, error: purchaseError } =
    await supabaseAdmin
      .from("package_purchases")
      .select(
        `
          id,
          package_id,
          player_id,
          trainer_id,
          total_price_cents,
          currency,
          stripe_payment_intent_id,
          stripe_livemode,
          funds_flow
        `
      )
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();

  if (purchaseError) {
    throw new Error(
      `Bestaande aankoop controleren mislukt: ${purchaseError.message}`
    );
  }

  if (purchase) {
    if (
      purchase.package_id !== packageId ||
      purchase.player_id !== playerId ||
      purchase.trainer_id !== attempt.trainer_id ||
      purchase.total_price_cents !== amountTotal ||
      purchase.currency !== currency ||
      purchase.stripe_payment_intent_id !== paymentIntentId ||
      purchase.stripe_livemode !== session.livemode ||
      purchase.funds_flow !== "separate_transfers_v1"
    ) {
      throw new Error(
        "De bestaande aankoop wijkt af van de betaalpoging."
      );
    }

    return purchase.id;
  }

  /*
   * Voor een nog ontbrekende aankoop controleren we ook
   * de actuele Payment Intent en de bijbehorende charge.
   */
  const paymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    {
      expand: ["latest_charge"],
    }
  );

  if (
    paymentIntent.status !== "succeeded" ||
    paymentIntent.livemode !== session.livemode ||
    paymentIntent.currency !== currency ||
    paymentIntent.amount !== amountTotal ||
    paymentIntent.amount_received !== amountTotal
  ) {
    throw new Error(
      "De Payment Intent komt niet overeen met de betaalde Checkout."
    );
  }

  if (
    paymentIntent.metadata.gowtrain_checkout_attempt_id !==
      attempt.id ||
    paymentIntent.metadata.package_id !== packageId ||
    paymentIntent.metadata.player_id !== playerId ||
    paymentIntent.metadata.trainer_id !== attempt.trainer_id ||
    paymentIntent.metadata.gowtrain_funds_flow !==
      "separate_transfers_v1"
  ) {
    throw new Error(
      "De Payment Intent hoort niet bij deze pakketbetaalpoging."
    );
  }

  if (
    paymentIntent.transfer_data != null ||
    paymentIntent.application_fee_amount != null ||
    paymentIntent.on_behalf_of != null
  ) {
    throw new Error(
      "De betaling gebruikt een onverwachte Connect-geldstroom."
    );
  }

  const charge =
    paymentIntent.latest_charge &&
    typeof paymentIntent.latest_charge !== "string"
      ? paymentIntent.latest_charge
      : null;

  if (
    !charge ||
    !charge.paid ||
    !charge.captured ||
    charge.refunded ||
    charge.amount_refunded > 0 ||
    charge.disputed
  ) {
    throw new Error(
      "De charge ontbreekt, is niet geïncasseerd, terugbetaald of betwist. Handmatige controle nodig."
    );
  }

  const { data: purchaseId, error: confirmationError } =
    await supabaseAdmin.rpc(
      "confirm_paid_package_checkout",
      {
        p_attempt_id: attempt.id,
        p_checkout_session_id: session.id,
        p_payment_intent_id: paymentIntent.id,
        p_amount_total: amountTotal,
        p_currency: currency,
        p_stripe_livemode: session.livemode,
      }
    );

  if (confirmationError) {
    throw new Error(
      `Pakketaankoop bevestigen mislukt: ${confirmationError.message}`
    );
  }

  if (typeof purchaseId !== "string" || !purchaseId) {
    throw new Error("Geen geldig aankoop-ID ontvangen.");
  }

  return purchaseId;
}