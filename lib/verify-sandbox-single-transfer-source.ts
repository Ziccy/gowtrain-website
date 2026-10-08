import "server-only";

import type Stripe from "stripe";

type CommonExpectedSource = {
  bookingId: string;
  trainerId: string;
  paymentIntentId: string;

  totalAmountCents: number;
  commissionRateBps: number;
  commissionAmountCents: number;
  trainerNetAmountCents: number;

  currency: "eur";
};

export type ExpectedSandboxSingleTransferSource =
  | (CommonExpectedSource & {
      paymentChannel: "legacy_checkout";
      checkoutSessionId: string;
      paymentAttemptId: null;
      storedChargeId: string | null;
    })
  | (CommonExpectedSource & {
      paymentChannel: "paymentsheet";
      checkoutSessionId: null;
      paymentAttemptId: string;
      storedChargeId: string;
    });

export type VerifiedSandboxSingleTransferSource = {
  sourceKind: "single_lesson";
  bookingId: string;
  trainerId: string;
  paymentChannel: "legacy_checkout" | "paymentsheet";
  paymentAttemptId: string | null;
  checkoutSessionId: string | null;
  paymentIntentId: string;
  chargeId: string;
  amountCents: number;
  currency: "eur";
  livemode: false;
  fundsFlow: "separate_transfers_v1";
  checkedAt: string;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isChargeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(ch|py)_[A-Za-z0-9]+$/.test(value)
  );
}

function isDatabaseInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2147483647
  );
}

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function validateExpected(
  expected: ExpectedSandboxSingleTransferSource,
): void {
  if (
    !expected ||
    !isUuid(expected.bookingId) ||
    !isUuid(expected.trainerId) ||
    typeof expected.paymentIntentId !== "string" ||
    !/^pi_[A-Za-z0-9]+$/.test(expected.paymentIntentId) ||
    expected.currency !== "eur" ||
    !isDatabaseInteger(expected.totalAmountCents) ||
    expected.totalAmountCents <= 0 ||
    !isDatabaseInteger(expected.commissionRateBps) ||
    expected.commissionRateBps > 3000 ||
    !isDatabaseInteger(expected.commissionAmountCents) ||
    !isDatabaseInteger(expected.trainerNetAmountCents) ||
    expected.trainerNetAmountCents <= 0 ||
    expected.commissionAmountCents + expected.trainerNetAmountCents !==
      expected.totalAmountCents
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_EXPECTED_INVALID");
  }

  /*
   * Controle van de vastgelegde verdeling.
   * Voor niet-negatieve bedragen gelijk aan PostgreSQL round(...).
   *
   * Dit bewijst niet dat het opgeslagen commissiepercentage
   * historisch onveranderd is. Die bescherming hoort bij de
   * databasecontext, niet bij Stripe.
   */
  const commission = Number(
    (
      BigInt(expected.totalAmountCents) *
        BigInt(expected.commissionRateBps) +
      BigInt(5000)
    ) / BigInt(10000),
  );

  if (commission !== expected.commissionAmountCents) {
    throw new Error("TRANSFER_SINGLE_SOURCE_ALLOCATION_MISMATCH");
  }

  if (expected.paymentChannel === "legacy_checkout") {
    if (
      typeof expected.checkoutSessionId !== "string" ||
      !/^cs_test_[A-Za-z0-9]+$/.test(expected.checkoutSessionId) ||
      expected.paymentAttemptId !== null ||
      (
        expected.storedChargeId !== null &&
        !isChargeId(expected.storedChargeId)
      )
    ) {
      throw new Error("TRANSFER_SINGLE_SOURCE_CHECKOUT_CONTEXT_INVALID");
    }

    return;
  }

  if (
    expected.paymentChannel !== "paymentsheet" ||
    expected.checkoutSessionId !== null ||
    !isUuid(expected.paymentAttemptId) ||
    !isChargeId(expected.storedChargeId)
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_ATTEMPT_CONTEXT_INVALID");
  }
}

function validateMetadata(
  metadata: Stripe.Metadata | null | undefined,
  expected: ExpectedSandboxSingleTransferSource,
): void {
  if (
    !metadata ||
    metadata.gowtrain_booking_id !== expected.bookingId ||
    metadata.gowtrain_trainer_id !== expected.trainerId ||
    metadata.gowtrain_funds_flow !== "separate_transfers_v1"
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_METADATA_MISMATCH");
  }

  if (expected.paymentChannel === "paymentsheet") {
    const required = {
      gowtrain_single_payment_attempt_id: expected.paymentAttemptId,
      gowtrain_booking_id: expected.bookingId,
      gowtrain_trainer_id: expected.trainerId,
      gowtrain_funds_flow: "separate_transfers_v1",
      gowtrain_payment_channel: "paymentsheet",
    };

    if (
      Object.keys(metadata).length !== Object.keys(required).length ||
      Object.entries(required).some(
        ([key, value]) => metadata[key] !== value,
      )
    ) {
      throw new Error("TRANSFER_SINGLE_SOURCE_ATTEMPT_METADATA_MISMATCH");
    }

    return;
  }

  /*
   * Oudere hosted en embedded Checkout hebben verschillende
   * aanvullende metadata. De gezamenlijke identiteit hierboven
   * blijft verplicht; pakket-/native context niet accepteren.
   */
  if (
    "gowtrain_single_payment_attempt_id" in metadata ||
    "gowtrain_payment_channel" in metadata ||
    "gowtrain_checkout_attempt_id" in metadata ||
    "gowtrain_package_purchase_id" in metadata ||
    "package_id" in metadata ||
    (
      "booking_type" in metadata &&
      metadata.booking_type !== "single_slot"
    ) ||
    (
      "trainer_id" in metadata &&
      metadata.trainer_id !== expected.trainerId
    )
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_LEGACY_METADATA_CONFLICT");
  }
}

/*
 * Alleen-lezen Stripe-verificatie voor een losse-lestransfer.
 *
 * expected moet afkomstig zijn uit gecontroleerde databasecontext:
 * - boeking en slot horen niet bij een pakket;
 * - betaalreferenties en financiële verdeling zijn gecontroleerd;
 * - bij PaymentSheet hoort de geslaagde poging bij deze boeking;
 * - bij legacy Checkout bestaat geen conflicterende betaalpoging.
 *
 * Deze helper controleert NIET:
 * - transfermoment, claim of Connect-bestemming;
 * - database-refundregistraties en open issues;
 * - eerdere transfers of beschikbaar transferbudget.
 *
 * Die controles blijven afzonderlijk verplicht vóór prepare.
 *
 * Geen databasewrites, betaling, refund of transferaanmaak.
 */
export async function verifySandboxSingleTransferSource(
  stripe: Stripe,
  expected: ExpectedSandboxSingleTransferSource,
): Promise<VerifiedSandboxSingleTransferSource> {
  validateExpected(expected);

  const checkedAt = new Date().toISOString();

  if (expected.paymentChannel === "legacy_checkout") {
    const session = await stripe.checkout.sessions.retrieve(
      expected.checkoutSessionId,
    );

    if (
      session.id !== expected.checkoutSessionId ||
      session.livemode !== false ||
      session.mode !== "payment" ||
      session.status !== "complete" ||
      session.payment_status !== "paid" ||
      session.amount_total !== expected.totalAmountCents ||
      session.currency !== expected.currency ||
      objectId(session.payment_intent) !== expected.paymentIntentId
    ) {
      throw new Error("TRANSFER_SINGLE_SOURCE_CHECKOUT_MISMATCH");
    }

    validateMetadata(session.metadata, expected);
  }

  const intent = await stripe.paymentIntents.retrieve(
    expected.paymentIntentId,
  );

  if (
    intent.id !== expected.paymentIntentId ||
    intent.livemode !== false ||
    intent.status !== "succeeded" ||
    intent.currency !== expected.currency ||
    intent.amount !== expected.totalAmountCents ||
    intent.amount_received !== expected.totalAmountCents ||
    intent.amount_capturable !== 0 ||
    intent.capture_method !== "automatic"
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_PAYMENT_MISMATCH");
  }

  validateMetadata(intent.metadata, expected);

  if (
    intent.transfer_data != null ||
    intent.application_fee_amount != null ||
    intent.on_behalf_of != null
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_PAYMENT_FLOW_MISMATCH");
  }

  const chargeId = objectId(intent.latest_charge);

  if (
    !isChargeId(chargeId) ||
    (
      expected.storedChargeId !== null &&
      chargeId !== expected.storedChargeId
    )
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_CHARGE_REFERENCE_MISMATCH");
  }

  const charge = await stripe.charges.retrieve(chargeId);

  if (
    charge.id !== chargeId ||
    objectId(charge.payment_intent) !== expected.paymentIntentId ||
    charge.livemode !== false ||
    charge.status !== "succeeded" ||
    charge.paid !== true ||
    charge.captured !== true ||
    charge.currency !== expected.currency ||
    charge.amount !== expected.totalAmountCents ||
    charge.amount_captured !== expected.totalAmountCents
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_CHARGE_MISMATCH");
  }

  if (
    charge.transfer_data != null ||
    charge.transfer != null ||
    charge.application_fee != null ||
    charge.application_fee_amount != null ||
    charge.on_behalf_of != null
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_CHARGE_FLOW_MISMATCH");
  }

  if (charge.refunded !== false || charge.amount_refunded !== 0) {
    throw new Error("TRANSFER_SINGLE_SOURCE_REFUND_REQUIRES_REVIEW");
  }

  if (charge.disputed !== false) {
    throw new Error("TRANSFER_SINGLE_SOURCE_DISPUTE_REQUIRES_REVIEW");
  }

  const refunds = await stripe.refunds.list({
    charge: chargeId,
    limit: 1,
  });

  if (
    !Array.isArray(refunds.data) ||
    refunds.data.length !== 0 ||
    refunds.has_more !== false
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_REFUND_REQUIRES_REVIEW");
  }

  const disputes = await stripe.disputes.list({
    charge: chargeId,
    limit: 1,
  });

  if (
    !Array.isArray(disputes.data) ||
    disputes.data.length !== 0 ||
    disputes.has_more !== false
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_DISPUTE_REQUIRES_REVIEW");
  }

  return {
    sourceKind: "single_lesson",
    bookingId: expected.bookingId,
    trainerId: expected.trainerId,
    paymentChannel: expected.paymentChannel,
    paymentAttemptId: expected.paymentAttemptId,
    checkoutSessionId: expected.checkoutSessionId,
    paymentIntentId: intent.id,
    chargeId: charge.id,
    amountCents: charge.amount_captured,
    currency: "eur",
    livemode: false,
    fundsFlow: "separate_transfers_v1",
    checkedAt,
  };
}