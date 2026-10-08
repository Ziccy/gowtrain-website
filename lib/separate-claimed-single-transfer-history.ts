import "server-only";

import type {
  SandboxSourceTransferInspection,
} from "@/lib/inspect-sandbox-source-transfers";

export type ExpectedSingleTransferHistoryClaim = {
  requestId: string;
  bookingId: string;
  trainerId: string;
  destinationAccountId: string;
  paymentIntentId: string;
  amountCents: number;
};

export type SeparatedSingleTransferHistory = {
  currentRequestId: string;
  historyWithoutCurrentClaim: Record<string, unknown>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") {
    throw new Error("TRANSFER_SINGLE_HISTORY_TIMESTAMP_INVALID");
  }

  const result = Date.parse(value);

  if (!Number.isFinite(result)) {
    throw new Error("TRANSFER_SINGLE_HISTORY_TIMESTAMP_INVALID");
  }

  return result;
}

/*
 * Alleen voor een zelf uitgevoerde backendaanroep van:
 * read_claimed_sandbox_single_transfer_history.
 *
 * expected komt uit de bevestigde uitvoeringsclaim.
 * Een vrij aangeleverd claim_verified=true is geen autorisatie.
 *
 * Deze functie:
 * - controleert precies één eigen, onvoorbereide claim;
 * - weigert bestaande Stripe-resultaten voor die opdracht/boeking;
 * - verwijdert alleen de eigen rij uit de verdere vergelijking.
 *
 * Geen goedkeuring van overige historie.
 * Geen databasewrites of Stripe-aanroepen.
 */
export function separateClaimedSingleTransferHistory(input: {
  claimedResponse: unknown;
  expected: ExpectedSingleTransferHistoryClaim;
  inspection: SandboxSourceTransferInspection;
}): SeparatedSingleTransferHistory {
  const { claimedResponse, expected, inspection } = input;

  if (
    !isUuid(expected.requestId) ||
    !isUuid(expected.bookingId) ||
    !isUuid(expected.trainerId) ||
    typeof expected.destinationAccountId !== "string" ||
    !/^acct_[A-Za-z0-9]+$/.test(expected.destinationAccountId) ||
    expected.destinationAccountId.length > 255 ||
    typeof expected.paymentIntentId !== "string" ||
    !/^pi_[A-Za-z0-9]+$/.test(expected.paymentIntentId) ||
    !Number.isSafeInteger(expected.amountCents) ||
    expected.amountCents <= 0 ||
    expected.amountCents > 2147483647
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CLAIM_INPUT_INVALID");
  }

  if (
    !isObject(claimedResponse) ||
    claimedResponse.claim_verified !== true ||
    claimedResponse.source_kind !== "single_lesson" ||
    claimedResponse.request_id !== expected.requestId ||
    claimedResponse.booking_id !== expected.bookingId ||
    claimedResponse.purchase_id !== null ||
    claimedResponse.destination_account_id !==
      expected.destinationAccountId
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CLAIM_RESPONSE_INVALID");
  }

  const checkedAt = timestamp(claimedResponse.checked_at);
  const lockedUntil = timestamp(claimedResponse.locked_until);

  if (lockedUntil <= checkedAt) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CLAIM_LEASE_INVALID");
  }

  const history = claimedResponse.history;

  if (
    !isObject(history) ||
    history.source_kind !== "single_lesson" ||
    history.booking_id !== expected.bookingId ||
    history.purchase_id !== null ||
    history.trainer_id !== expected.trainerId ||
    history.payment_intent_id !== expected.paymentIntentId ||
    history.destination_account_id !== expected.destinationAccountId ||
    history.source_charge_id !== inspection.sourceChargeId ||
    history.source_trainer_net_amount_cents !== expected.amountCents ||
    typeof history.source_total_amount_cents !== "number" ||
    !Number.isSafeInteger(history.source_total_amount_cents) ||
    history.source_total_amount_cents < expected.amountCents ||
    history.source_total_amount_cents > 2147483647 ||
    history.stripe_verification_required !== true ||
    !Array.isArray(history.requests) ||
    !Array.isArray(history.orphan_bookings) ||
    typeof history.request_count !== "number" ||
    !Number.isSafeInteger(history.request_count) ||
    history.request_count < 1 ||
    history.request_count > 2000 ||
    history.request_count !== history.requests.length
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CONTEXT_MISMATCH");
  }

  if (history.orphan_bookings.length !== 0) {
    throw new Error("TRANSFER_SINGLE_ORPHAN_HISTORY_REQUIRES_REVIEW");
  }

  if (
    inspection.scanCompleted !== true ||
    typeof inspection.sourceChargeId !== "string" ||
    !/^(ch|py)_[A-Za-z0-9]+$/.test(inspection.sourceChargeId) ||
    inspection.destinationAccountId !== expected.destinationAccountId ||
    !Array.isArray(inspection.relevantTransfers)
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_SCAN_MISMATCH");
  }

  const rows: Record<string, unknown>[] = [];

  for (const value of history.requests) {
    if (!isObject(value) || !isObject(value.request)) {
      throw new Error("TRANSFER_SINGLE_HISTORY_ENTRY_INVALID");
    }

    rows.push(value);
  }

  const ownRows = rows.filter((row) => {
    const request = row.request as Record<string, unknown>;
    return request.id === expected.requestId;
  });

  if (ownRows.length !== 1) {
    throw new Error("TRANSFER_SINGLE_OWN_HISTORY_NOT_UNIQUE");
  }

  const ownRow = ownRows[0];
  const request = ownRow.request as Record<string, unknown>;
  const booking = ownRow.booking;

  if (!isObject(booking) || ownRow.purchase !== null) {
    throw new Error("TRANSFER_SINGLE_OWN_HISTORY_CONTEXT_INVALID");
  }

  if (
    request.booking_id !== expected.bookingId ||
    request.trainer_id !== expected.trainerId ||
    request.source_package_purchase_id !== null ||
    request.destination_account_id !== expected.destinationAccountId ||
    request.stripe_payment_intent_id !== expected.paymentIntentId ||
    request.amount_cents !== expected.amountCents ||
    request.currency !== "eur" ||
    request.stripe_livemode !== false ||
    request.funds_flow !== "separate_transfers_v1" ||
    request.status !== "processing" ||
    request.attempts !== 1 ||
    request.has_lock_token !== true ||
    request.stripe_idempotency_key !==
      `gowtrain-trainer-transfer/${expected.requestId}` ||
    request.first_stripe_request_at !== null ||
    request.stripe_request_payload !== null ||
    request.stripe_transfer_id !== null ||
    request.succeeded_at !== null ||
    request.applied_at !== null ||
    request.stripe_source_charge_id !== null ||
    request.source_verified_at !== null
  ) {
    throw new Error("TRANSFER_SINGLE_OWN_CLAIM_INVALID");
  }

  if (timestamp(request.locked_until) !== lockedUntil) {
    throw new Error("TRANSFER_SINGLE_OWN_LEASE_MISMATCH");
  }

  if (
    booking.id !== expected.bookingId ||
    booking.trainer_id !== expected.trainerId ||
    booking.package_purchase_id !== null ||
    booking.stripe_payment_intent_id !== expected.paymentIntentId ||
    booking.trainer_net_amount_cents !== expected.amountCents ||
    booking.total_price_cents !== history.source_total_amount_cents ||
    booking.currency !== "eur" ||
    booking.trainer_payout_status !== "processing" ||
    booking.stripe_transfer_id !== null ||
    booking.trainer_paid_at !== null ||
    (
      booking.stripe_charge_id !== null &&
      booking.stripe_charge_id !== inspection.sourceChargeId
    )
  ) {
    throw new Error("TRANSFER_SINGLE_OWN_BOOKING_MISMATCH");
  }

  timestamp(booking.paid_at);

  /*
   * Een nieuwe losse-lesclaim hoort nog geen Stripe-resultaat
   * voor deze opdracht of boeking te hebben.
   *
   * Andere transfers worden hier niet goedgekeurd:
   * zij blijven onderdeel van de volledige historiecontrole.
   */
  for (const transfer of inspection.relevantTransfers) {
    if (!isObject(transfer.metadata)) {
      throw new Error("TRANSFER_SINGLE_HISTORY_SCAN_METADATA_INVALID");
    }

    if (
      transfer.metadata.gowtrain_transfer_request_id ===
        expected.requestId ||
      transfer.metadata.gowtrain_booking_id === expected.bookingId
    ) {
      throw new Error("TRANSFER_SINGLE_OWN_CLAIM_ALREADY_AT_STRIPE");
    }
  }

  const remaining = rows.filter((row) => {
    const request = row.request as Record<string, unknown>;
    return request.id !== expected.requestId;
  });

  return {
    currentRequestId: expected.requestId,
    historyWithoutCurrentClaim: {
      ...history,
      request_count: remaining.length,
      requests: remaining,
    },
  };
}