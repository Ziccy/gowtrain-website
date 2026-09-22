import "server-only";

import type {
  SandboxSourceTransferInspection,
} from "@/lib/inspect-sandbox-source-transfers";

type ExpectedClaim = {
  requestId: string;
  bookingId: string;
  purchaseId: string;
  trainerId: string;
  destinationAccountId: string;
  paymentIntentId: string;
  amountCents: number;
};

export type SeparatedClaimedTransferHistory = {
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/*
 * Alleen gebruiken op het resultaat van:
 * read_claimed_sandbox_transfer_history(requestId, lockToken, chargeId).
 *
 * claim_verified is op zichzelf geen autorisatiebewijs.
 * De aanroeper moet de geauthenticeerde backend-RPC zelf hebben
 * uitgevoerd met het claimtoken; geen browser-JSON doorgeven.
 *
 * De RPC controleert de lease met de databaseklok.
 * Prepare controleert de claim later opnieuw onder locks.
 *
 * Deze helper:
 * - controleert de teruggegeven eigen claim;
 * - weigert bestaande Stripe-resultaten voor die claim;
 * - zet uitsluitend die ene rij apart;
 * - laat alle overige historie intact.
 *
 * Dit is GEEN goedkeuring van de resterende historie.
 */
export function separateClaimedTransferHistory(input: {
  claimedResponse: unknown;
  expected: ExpectedClaim;
  inspection: SandboxSourceTransferInspection;
}): SeparatedClaimedTransferHistory {
  const { claimedResponse, expected, inspection } = input;

  if (
    ![
      expected.requestId,
      expected.bookingId,
      expected.purchaseId,
      expected.trainerId,
    ].every(isUuid) ||
    !/^acct_[A-Za-z0-9]+$/.test(expected.destinationAccountId) ||
    !/^pi_[A-Za-z0-9]+$/.test(expected.paymentIntentId) ||
    !Number.isSafeInteger(expected.amountCents) ||
    expected.amountCents <= 0
  ) {
    throw new Error("TRANSFER_HISTORY_CLAIM_INPUT_INVALID");
  }

  if (
    !isObject(claimedResponse) ||
    claimedResponse.claim_verified !== true ||
    claimedResponse.request_id !== expected.requestId ||
    claimedResponse.booking_id !== expected.bookingId ||
    claimedResponse.purchase_id !== expected.purchaseId ||
    claimedResponse.destination_account_id !==
      expected.destinationAccountId ||
    typeof claimedResponse.checked_at !== "string" ||
    !Number.isFinite(Date.parse(claimedResponse.checked_at)) ||
    typeof claimedResponse.locked_until !== "string" ||
    !Number.isFinite(Date.parse(claimedResponse.locked_until))
  ) {
    throw new Error("TRANSFER_HISTORY_CLAIM_RESPONSE_INVALID");
  }

  const history = claimedResponse.history;

  if (
    !isObject(history) ||
    history.purchase_id !== expected.purchaseId ||
    history.trainer_id !== expected.trainerId ||
    history.payment_intent_id !== expected.paymentIntentId ||
    history.destination_account_id !== expected.destinationAccountId ||
    history.source_charge_id !== inspection.sourceChargeId ||
    history.stripe_livemode !== false ||
    !Array.isArray(history.requests) ||
    !Array.isArray(history.orphan_bookings) ||
    typeof history.request_count !== "number" ||
    !Number.isSafeInteger(history.request_count) ||
    history.request_count !== history.requests.length
  ) {
    throw new Error("TRANSFER_HISTORY_CLAIM_HISTORY_MISMATCH");
  }

  if (
    inspection.scanCompleted !== true ||
    inspection.destinationAccountId !== expected.destinationAccountId ||
    !Array.isArray(inspection.relevantTransfers)
  ) {
    throw new Error("TRANSFER_HISTORY_CLAIM_SCAN_MISMATCH");
  }

  if (history.orphan_bookings.length !== 0) {
    throw new Error("TRANSFER_HISTORY_ORPHAN_BOOKINGS_REQUIRE_REVIEW");
  }

  const rows: Record<string, unknown>[] = [];

  for (const value of history.requests) {
    if (!isObject(value) || !isObject(value.request)) {
      throw new Error("TRANSFER_HISTORY_DATABASE_OBJECT_INVALID");
    }

    rows.push(value);
  }

  const ownRows = rows.filter((row) => {
    const request = row.request as Record<string, unknown>;
    return request.id === expected.requestId;
  });

  if (ownRows.length !== 1) {
    throw new Error("TRANSFER_HISTORY_OWN_CLAIM_NOT_UNIQUE");
  }

  const ownRow = ownRows[0];
  const request = ownRow.request as Record<string, unknown>;
  const booking = ownRow.booking;
  const purchase = ownRow.purchase;

  if (!isObject(booking) || !isObject(purchase)) {
    throw new Error("TRANSFER_HISTORY_OWN_CLAIM_CONTEXT_MISSING");
  }

  if (
    request.booking_id !== expected.bookingId ||
    request.trainer_id !== expected.trainerId ||
    request.source_package_purchase_id !== expected.purchaseId ||
    request.destination_account_id !== expected.destinationAccountId ||
    request.stripe_payment_intent_id !== expected.paymentIntentId ||
    request.amount_cents !== expected.amountCents ||
    request.currency !== "eur" ||
    request.stripe_livemode !== false ||
    request.funds_flow !== "separate_transfers_v1" ||
    request.status !== "processing" ||
    request.attempts !== 1 ||
    request.has_lock_token !== true ||
    request.locked_until !== claimedResponse.locked_until ||
    request.stripe_idempotency_key !==
      `gowtrain-trainer-transfer/${expected.requestId}` ||
    request.first_stripe_request_at !== null ||
    request.stripe_request_payload !== null ||
    request.stripe_transfer_id !== null ||
    request.succeeded_at !== null ||
    request.applied_at !== null
  ) {
    throw new Error("TRANSFER_HISTORY_OWN_CLAIM_INVALID");
  }

  if (
    request.stripe_source_charge_id !== null &&
    request.stripe_source_charge_id !== inspection.sourceChargeId
  ) {
    throw new Error("TRANSFER_HISTORY_OWN_CLAIM_SOURCE_MISMATCH");
  }

  if (
    booking.id !== expected.bookingId ||
    booking.trainer_id !== expected.trainerId ||
    booking.package_purchase_id !== expected.purchaseId ||
    booking.trainer_net_amount_cents !== expected.amountCents ||
    booking.currency !== "eur" ||
    booking.trainer_payout_status !== "processing" ||
    booking.stripe_transfer_id !== null ||
    booking.trainer_paid_at !== null ||
    purchase.id !== expected.purchaseId ||
    purchase.trainer_id !== expected.trainerId ||
    purchase.stripe_payment_intent_id !== expected.paymentIntentId ||
    purchase.stripe_livemode !== false ||
    purchase.funds_flow !== "separate_transfers_v1" ||
    purchase.currency !== "eur"
  ) {
    throw new Error("TRANSFER_HISTORY_OWN_BOOKING_OR_PURCHASE_MISMATCH");
  }

  /*
   * Een nog onvoorbereide opdracht hoort geen Stripe-resultaat
   * te hebben. Ook een andere opdrachtreferentie bij dezelfde
   * bookingmetadata vereist controle.
   */
  for (const transfer of inspection.relevantTransfers) {
    if (!isObject(transfer.metadata)) {
      throw new Error("TRANSFER_HISTORY_SCAN_METADATA_INVALID");
    }

    if (
      transfer.metadata.gowtrain_transfer_request_id ===
        expected.requestId ||
      transfer.metadata.gowtrain_booking_id === expected.bookingId
    ) {
      throw new Error("TRANSFER_HISTORY_OWN_CLAIM_ALREADY_SEEN_AT_STRIPE");
    }
  }

  const remainingRows = rows.filter((row) => {
    const item = row.request as Record<string, unknown>;
    return item.id !== expected.requestId;
  });

  return {
    currentRequestId: expected.requestId,
    historyWithoutCurrentClaim: {
      ...history,
      request_count: remainingRows.length,
      requests: remainingRows,
    },
  };
}