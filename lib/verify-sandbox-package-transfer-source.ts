import "server-only";

import type Stripe from "stripe";

export type ExpectedSandboxPackageTransferSource = {
  purchaseId: string;
  checkoutAttemptId: string;
  packageId: string;
  playerId: string;
  trainerId: string;
  checkoutSessionId: string;
  paymentIntentId: string;
  totalAmountCents: number;
  currency: "eur";
};

export type VerifiedSandboxPackageTransferSource = {
  purchaseId: string;
  checkoutAttemptId: string;
  checkoutSessionId: string;
  paymentIntentId: string;
  chargeId: string;
  amountCents: number;
  currency: "eur";
  livemode: false;
  fundsFlow: "separate_transfers_v1";
  checkedAt: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/*
 * Alleen-lezen controle van de oorspronkelijke pakketbetaling.
 *
 * expected moet door de backend worden samengesteld uit een
 * gecontroleerde aankoop én de bijbehorende checkout_attempt.
 * Niet rechtstreeks uit browserinput of alleen Stripe-metadata.
 *
 * Geen databasewrites.
 * Geen betaling, refund of transfer aanmaken.
 * Geen uitspraak over het nog beschikbare trainersdeel.
 */
export async function verifySandboxPackageTransferSource(
  stripe: Stripe,
  expected: ExpectedSandboxPackageTransferSource,
): Promise<VerifiedSandboxPackageTransferSource> {
  if (
    ![
      expected.purchaseId,
      expected.checkoutAttemptId,
      expected.packageId,
      expected.playerId,
      expected.trainerId,
    ].every(isUuid) ||
    !/^cs_test_[A-Za-z0-9]+$/.test(expected.checkoutSessionId) ||
    !/^pi_[A-Za-z0-9]+$/.test(expected.paymentIntentId) ||
    !Number.isSafeInteger(expected.totalAmountCents) ||
    expected.totalAmountCents <= 0 ||
    expected.currency !== "eur"
  ) {
    throw new Error("TRANSFER_SOURCE_EXPECTED_CONTEXT_INVALID");
  }

  const checkedAt = new Date().toISOString();

  const session = await stripe.checkout.sessions.retrieve(
    expected.checkoutSessionId,
  );

  const sessionPaymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (
    session.id !== expected.checkoutSessionId ||
    session.livemode !== false ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    sessionPaymentIntentId !== expected.paymentIntentId ||
    session.amount_total !== expected.totalAmountCents ||
    session.currency !== expected.currency
  ) {
    throw new Error("TRANSFER_SOURCE_CHECKOUT_MISMATCH");
  }

  if (
    session.client_reference_id !== expected.checkoutAttemptId ||
    session.metadata?.gowtrain_checkout_attempt_id !==
      expected.checkoutAttemptId ||
    session.metadata?.booking_type !== "package" ||
    session.metadata?.package_id !== expected.packageId ||
    session.metadata?.player_id !== expected.playerId ||
    session.metadata?.trainer_id !== expected.trainerId ||
    session.metadata?.gowtrain_funds_flow !== "separate_transfers_v1"
  ) {
    throw new Error("TRANSFER_SOURCE_CHECKOUT_METADATA_MISMATCH");
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(
    expected.paymentIntentId,
  );

  if (
    paymentIntent.id !== expected.paymentIntentId ||
    paymentIntent.livemode !== false ||
    paymentIntent.status !== "succeeded" ||
    paymentIntent.currency !== expected.currency ||
    paymentIntent.amount !== expected.totalAmountCents ||
    paymentIntent.amount_received !== expected.totalAmountCents ||
    paymentIntent.amount_capturable !== 0
  ) {
    throw new Error("TRANSFER_SOURCE_PAYMENT_INTENT_MISMATCH");
  }

  if (
    paymentIntent.metadata.gowtrain_checkout_attempt_id !==
      expected.checkoutAttemptId ||
    paymentIntent.metadata.package_id !== expected.packageId ||
    paymentIntent.metadata.player_id !== expected.playerId ||
    paymentIntent.metadata.trainer_id !== expected.trainerId ||
    paymentIntent.metadata.gowtrain_funds_flow !== "separate_transfers_v1"
  ) {
    throw new Error("TRANSFER_SOURCE_PAYMENT_METADATA_MISMATCH");
  }

  if (
    paymentIntent.transfer_data != null ||
    paymentIntent.application_fee_amount != null ||
    paymentIntent.on_behalf_of != null
  ) {
    throw new Error("TRANSFER_SOURCE_PAYMENT_FUNDS_FLOW_MISMATCH");
  }

  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id;

  if (!chargeId) {
    throw new Error("TRANSFER_SOURCE_CHARGE_MISSING");
  }

  // Niet vertrouwen op een oude of gedeeltelijk embedded charge.
  const charge = await stripe.charges.retrieve(chargeId);

  const chargePaymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (
    charge.id !== chargeId ||
    chargePaymentIntentId !== expected.paymentIntentId ||
    charge.livemode !== false ||
    charge.status !== "succeeded" ||
    charge.paid !== true ||
    charge.captured !== true ||
    charge.currency !== expected.currency ||
    charge.amount !== expected.totalAmountCents ||
    charge.amount_captured !== expected.totalAmountCents
  ) {
    throw new Error("TRANSFER_SOURCE_CHARGE_MISMATCH");
  }

  if (
    charge.transfer_data != null ||
    charge.transfer != null ||
    charge.application_fee != null ||
    charge.application_fee_amount != null ||
    charge.on_behalf_of != null
  ) {
    throw new Error("TRANSFER_SOURCE_CHARGE_FUNDS_FLOW_MISMATCH");
  }

  if (
    charge.refunded !== false ||
    charge.amount_refunded !== 0
  ) {
    throw new Error("TRANSFER_SOURCE_REFUND_REQUIRES_REVIEW");
  }

  if (charge.disputed !== false) {
    throw new Error("TRANSFER_SOURCE_DISPUTE_REQUIRES_REVIEW");
  }

  /*
   * Een nog pending refund hoeft nog niet als amount_refunded
   * zichtbaar te zijn. Controleer daarom ook refundobjecten.
   *
   * Eén gevonden refund is voor deze eerste, conservatieve
   * broncontrole voldoende om te blokkeren, ongeacht status.
   * Er is dus geen paginering nodig om afwezigheid te controleren.
   */
  const refunds = await stripe.refunds.list({
    charge: charge.id,
    limit: 1,
  });

  if (refunds.data.length > 0 || refunds.has_more) {
    throw new Error("TRANSFER_SOURCE_REFUND_REQUIRES_REVIEW");
  }

  /*
   * Ook disputeobjecten expliciet controleren.
   * Een historische dispute wordt niet automatisch genegeerd.
   */
  const disputes = await stripe.disputes.list({
    charge: charge.id,
    limit: 1,
  });

  if (disputes.data.length > 0 || disputes.has_more) {
    throw new Error("TRANSFER_SOURCE_DISPUTE_REQUIRES_REVIEW");
  }

  return {
    purchaseId: expected.purchaseId,
    checkoutAttemptId: expected.checkoutAttemptId,
    checkoutSessionId: session.id,
    paymentIntentId: paymentIntent.id,
    chargeId: charge.id,
    amountCents: charge.amount_captured,
    currency: "eur",
    livemode: false,
    fundsFlow: "separate_transfers_v1",
    checkedAt,
  };
}