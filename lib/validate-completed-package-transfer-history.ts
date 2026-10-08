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
    throw new Error("TRANSFER_PACKAGE_HISTORY_OBJECT_INVALID");
  }

  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error("TRANSFER_PACKAGE_HISTORY_STRING_INVALID");
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
    throw new Error("TRANSFER_PACKAGE_HISTORY_UUID_INVALID");
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
    throw new Error("TRANSFER_PACKAGE_HISTORY_AMOUNT_INVALID");
  }

  return value;
}

function timestamp(value: unknown): string {
  const result = text(value);

  if (!Number.isFinite(Date.parse(result))) {
    throw new Error("TRANSFER_PACKAGE_HISTORY_TIMESTAMP_INVALID");
  }

  return result;
}

/*
 * Controleert één volledig toegepaste pakketlestransfer uit
 * een vertrouwde databasehistorieloader.
 *
 * Geen actuele aankoopgeschiktheid opnieuw beoordelen:
 * een latere refund of klacht maakt een werkelijk uitgevoerde
 * transfer niet ongedaan.
 *
 * De aanroeper moet aanvullend:
 * - de relatie met de huidige betaalbron controleren;
 * - de volledige relevante historie meenemen;
 * - alle entries via compareSandboxTransferHistory vergelijken.
 *
 * Die vergelijking controleert de exacte payload, Stripe-metadata,
 * bedragen, bron, bestemming, tijdstempels en reversals.
 *
 * Geen netwerkverkeer, databasewrites of uitvoeringsautorisatie.
 */
export function validateCompletedPackageTransferHistory(
  rawEntry: unknown,
): CompletedSandboxTransferHistoryEntry {
  const entry = object(rawEntry);
  const request = object(entry.request);
  const booking = object(entry.booking);
  const purchase = object(entry.purchase);

  const requestId = uuid(request.id);
  const bookingId = uuid(request.booking_id);
  const trainerId = uuid(request.trainer_id);
  const purchaseId = uuid(request.source_package_purchase_id);

  const amountCents = integer(request.amount_cents, 1);
  const bookingTotal = integer(booking.total_price_cents, 1);
  const bookingCommission = integer(booking.commission_amount_cents, 0);
  const purchaseTotal = integer(purchase.total_price_cents, 1);
  const purchaseNet = integer(purchase.trainer_net_amount_cents, 0);

  const paymentIntentId = text(request.stripe_payment_intent_id);
  const sourceChargeId = text(request.stripe_source_charge_id);
  const destinationAccountId = text(request.destination_account_id);
  const transferId = text(request.stripe_transfer_id);

  if (
    request.status !== "succeeded" ||
    request.currency !== "eur" ||
    request.stripe_livemode !== false ||
    request.funds_flow !== "separate_transfers_v1" ||
    request.has_lock_token !== false ||
    request.locked_until !== null ||
    !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
    !/^(ch|py)_[A-Za-z0-9]+$/.test(sourceChargeId) ||
    !/^acct_[A-Za-z0-9]+$/.test(destinationAccountId) ||
    !/^tr_[A-Za-z0-9]+$/.test(transferId)
  ) {
    throw new Error("TRANSFER_PACKAGE_HISTORY_REQUEST_INVALID");
  }

  // Bestaande pakketregel behouden: minimaal één geregistreerde poging.
  integer(request.attempts, 1);

  if (
    booking.id !== bookingId ||
    booking.trainer_id !== trainerId ||
    booking.package_purchase_id !== purchaseId ||
    booking.currency !== "eur" ||
    booking.trainer_net_amount_cents !== amountCents ||
    booking.trainer_payout_status !== "paid" ||
    booking.stripe_transfer_id !== transferId ||
    purchase.id !== purchaseId ||
    purchase.trainer_id !== trainerId ||
    purchase.currency !== "eur" ||
    purchase.stripe_livemode !== false ||
    purchase.funds_flow !== "separate_transfers_v1" ||
    purchase.stripe_payment_intent_id !== paymentIntentId
  ) {
    throw new Error("TRANSFER_PACKAGE_HISTORY_CONTEXT_MISMATCH");
  }

  timestamp(booking.paid_at);
  timestamp(purchase.paid_at);

  if (
    bookingCommission + amountCents !== bookingTotal ||
    bookingTotal > purchaseTotal ||
    amountCents > purchaseNet
  ) {
    throw new Error("TRANSFER_PACKAGE_HISTORY_ALLOCATION_MISMATCH");
  }

  return {
    expected: {
      sourceKind: "package",
      requestId,
      bookingId,
      trainerId,
      packagePurchaseId: purchaseId,
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
      packagePurchaseId: purchaseId,
      trainerNetAmountCents: amountCents,
      currency: "eur",
      trainerPayoutStatus: "paid",
      stripeTransferId: transferId,
      trainerPaidAt: timestamp(booking.trainer_paid_at),
    },
  };
}