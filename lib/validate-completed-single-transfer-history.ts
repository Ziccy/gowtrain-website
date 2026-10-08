import "server-only";

import type {
  CompletedSandboxTransferHistoryEntry,
} from "@/lib/compare-sandbox-transfer-history";

function object(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_OBJECT_INVALID");
  }

  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_STRING_INVALID");
  }

  return value;
}

function uuid(value: unknown): string {
  const result = text(value);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      result,
    )
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_UUID_INVALID");
  }

  return result;
}

function integer(value: unknown, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 2147483647
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_AMOUNT_INVALID");
  }

  return value;
}

function timestamp(value: unknown): string {
  const result = text(value);

  if (!Number.isFinite(Date.parse(result))) {
    throw new Error("TRANSFER_SINGLE_HISTORY_TIMESTAMP_INVALID");
  }

  return result;
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  return Date.parse(timestamp(left)) === Date.parse(timestamp(right));
}

/*
 * Valideert één reeds toegepaste losse-lestransfer uit de
 * vertrouwde databasehistorieloader.
 *
 * Geen browserinput rechtstreeks doorgeven.
 * Geen netwerkverkeer of databasewrites.
 *
 * Geen nieuwe geschiktheidsbeslissing:
 * latere refunds, annuleringen of een gewijzigde Connect-koppeling
 * maken een werkelijk uitgevoerde transfer niet ongedaan.
 *
 * De teruggegeven rij moet nog door compareSandboxTransferHistory:
 * exacte payload, idempotency-key, Stripe-resultaat, reversals,
 * tijdstempels en volledige scanvergelijking blijven verplicht.
 */
export function validateCompletedSingleTransferHistory(
  rawEntry: unknown,
): CompletedSandboxTransferHistoryEntry {
  const entry = object(rawEntry);
  const request = object(entry.request);
  const booking = object(entry.booking);

  if (
    request.source_package_purchase_id !== null ||
    booking.package_purchase_id !== null ||
    entry.purchase !== null
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_PACKAGE_CONFLICT");
  }

  const requestId = uuid(request.id);
  const bookingId = uuid(request.booking_id);
  const trainerId = uuid(request.trainer_id);

  const amountCents = integer(request.amount_cents, 1);
  const total = integer(booking.total_price_cents, 1);
  const commission = integer(booking.commission_amount_cents, 0);
  const rate = integer(booking.commission_rate_bps, 0);

  if (
    rate > 3000 ||
    commission + amountCents !== total ||
    Number(
      (BigInt(total) * BigInt(rate) + BigInt(5000)) / BigInt(10000),
    ) !== commission
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_ALLOCATION_MISMATCH");
  }

  const paymentIntentId = text(request.stripe_payment_intent_id);
  const sourceChargeId = text(request.stripe_source_charge_id);
  const destinationAccountId = text(request.destination_account_id);
  const transferId = text(request.stripe_transfer_id);

  if (
    !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
    !/^(ch|py)_[A-Za-z0-9]+$/.test(sourceChargeId) ||
    !/^acct_[A-Za-z0-9]+$/.test(destinationAccountId) ||
    destinationAccountId.length > 255 ||
    !/^tr_[A-Za-z0-9]+$/.test(transferId) ||
    request.status !== "succeeded" ||
    request.currency !== "eur" ||
    request.stripe_livemode !== false ||
    request.funds_flow !== "separate_transfers_v1" ||
    request.attempts !== 1 ||
    request.has_lock_token !== false ||
    request.locked_until !== null
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_REQUEST_INVALID");
  }

  if (
    booking.id !== bookingId ||
    booking.trainer_id !== trainerId ||
    booking.currency !== "eur" ||
    booking.trainer_net_amount_cents !== amountCents ||
    booking.stripe_payment_intent_id !== paymentIntentId ||
    booking.trainer_payout_status !== "paid" ||
    booking.stripe_transfer_id !== transferId ||
    (
      booking.stripe_charge_id !== null &&
      booking.stripe_charge_id !== sourceChargeId
    )
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_BOOKING_MISMATCH");
  }

  timestamp(booking.paid_at);

  /*
   * Een ontbrekend payment_attempt-veld is ongeldig.
   * Alleen expliciet null betekent legacy Checkout.
   */
  if (entry.payment_attempt === null) {
    const sessionId = text(booking.stripe_checkout_session_id);

    if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
      throw new Error("TRANSFER_SINGLE_HISTORY_CHECKOUT_INVALID");
    }
  } else {
    const attempt = object(entry.payment_attempt);
    const attemptId = uuid(attempt.id);
    const slotId = uuid(booking.slot_id);
    const participants = integer(booking.participant_count, 1);

    if (
      participants > 4 ||
      attempt.booking_id !== bookingId ||
      attempt.trainer_id !== trainerId ||
      attempt.slot_id !== slotId ||
      attempt.player_matches_booking !== true ||
      attempt.channel !== "paymentsheet" ||
      attempt.status !== "succeeded" ||
      attempt.amount_cents !== total ||
      attempt.currency !== "eur" ||
      attempt.stripe_livemode !== false ||
      attempt.funds_flow !== "separate_transfers_v1" ||
      attempt.participant_count !== participants ||
      attempt.stripe_payment_intent_id !== paymentIntentId ||
      attempt.stripe_charge_id !== sourceChargeId ||
      booking.stripe_charge_id !== sourceChargeId ||
      attempt.stripe_checkout_session_id !== null ||
      booking.stripe_checkout_session_id !== null ||
      attempt.review_code !== null ||
      attempt.stripe_idempotency_key !==
        `gowtrain-single-payment/${attemptId}`
    ) {
      throw new Error("TRANSFER_SINGLE_HISTORY_ATTEMPT_MISMATCH");
    }

    if (!sameTimestamp(attempt.starts_at, booking.original_starts_at)) {
      throw new Error("TRANSFER_SINGLE_HISTORY_LESSON_TIME_MISMATCH");
    }

    timestamp(attempt.first_stripe_request_at);
    timestamp(attempt.payment_verified_at);
    timestamp(attempt.booking_confirmed_at);
  }

  return {
    expected: {
      sourceKind: "single_lesson",
      requestId,
      bookingId,
      trainerId,
      amountCents,
      currency: "eur",
      destinationAccountId,
      sourceChargeId,
      paymentIntentId,
      stripeLivemode: false,
      fundsFlow: "separate_transfers_v1",
    },

    requestStatus: "succeeded",
    storedPayload: object(request.stripe_request_payload),
    storedIdempotencyKey: text(request.stripe_idempotency_key),

    stripeTransferId: transferId,
    firstStripeRequestAt: timestamp(request.first_stripe_request_at),
    sourceVerifiedAt: timestamp(request.source_verified_at),
    succeededAt: timestamp(request.succeeded_at),
    appliedAt: timestamp(request.applied_at),

    booking: {
      id: bookingId,
      trainerId,
      packagePurchaseId: null,
      trainerNetAmountCents: amountCents,
      currency: "eur",
      trainerPayoutStatus: "paid",
      stripeTransferId: transferId,
      trainerPaidAt: timestamp(booking.trainer_paid_at),
    },
  };
}