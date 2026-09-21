import "server-only";

import { isDeepStrictEqual } from "node:util";
import {
  buildTrainerTransferPayload,
} from "@/lib/stripe-trainer-transfer-payload";
import type {
  SandboxSourceTransferInspection,
} from "@/lib/inspect-sandbox-source-transfers";

type ExpectedTransfer =
  Parameters<typeof buildTrainerTransferPayload>[0];

/*
 * Deze gegevens moeten door de backend uit opdracht én boeking
 * worden samengesteld. Niet vanuit browserinput.
 *
 * De loader moet de volledige relevante historie ophalen en
 * onzekere/onafgeronde opdrachten afzonderlijk blokkeren.
 */
export type CompletedSandboxTransferHistoryEntry = {
  expected: ExpectedTransfer;

  requestStatus: string;
  storedPayload: unknown;
  storedIdempotencyKey: string;

  stripeTransferId: string;
  firstStripeRequestAt: string;
  sourceVerifiedAt: string;
  succeededAt: string;
  appliedAt: string;

  booking: {
    id: string;
    trainerId: string;
    packagePurchaseId: string;
    trainerNetAmountCents: number;
    currency: string;
    trainerPayoutStatus: string;
    stripeTransferId: string;
    trainerPaidAt: string;
  };
};

export type SandboxTransferHistoryComparison = {
  comparisonConfirmed: true;

  /*
   * Alleen een inventaris van gecontroleerde eerdere transfers.
   * Geen vrij budget en geen uitvoeringsautorisatie.
   */
  matchedTransfers: Array<{
    requestId: string;
    bookingId: string;
    packagePurchaseId: string;
    transferId: string;
    sourceChargeId: string;
    destinationAccountId: string;
    amountCents: number;
    matchesCurrentSource: boolean;
    matchesCurrentDestination: boolean;
  }>;

  currentSourceTransferredCents: number;
  currentDestinationTransferredCents: number;
};

function requiredTimestamp(value: string): number {
  if (typeof value !== "string") {
    throw new Error("TRANSFER_HISTORY_TIMESTAMP_INVALID");
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error("TRANSFER_HISTORY_TIMESTAMP_INVALID");
  }

  return timestamp;
}

function addSafeAmount(total: number, amount: number): number {
  const result = total + amount;

  if (!Number.isSafeInteger(result)) {
    throw new Error("TRANSFER_HISTORY_TOTAL_INVALID");
  }

  return result;
}

/*
 * Vergelijkt de relevante Stripe-scan met de volledige, reeds
 * afgeronde databasehistorie die de backend heeft aangeleverd.
 *
 * Controleert beide richtingen:
 * - iedere relevante Stripe-transfer moet lokaal verklaard zijn;
 * - iedere aangeleverde lokale transfer moet in de scan staan.
 *
 * Geen databasewrites, Stripe-aanroepen of budgetvrijgave.
 * Geen ondersteuning voor reversals in deze eerste uitbreiding.
 */
export function compareSandboxTransferHistory(input: {
  inspection: SandboxSourceTransferInspection;
  completedRequests: CompletedSandboxTransferHistoryEntry[];
}): SandboxTransferHistoryComparison {
  const { inspection, completedRequests } = input;

  if (
    inspection.scanCompleted !== true ||
    !/^(ch|py)_[A-Za-z0-9]+$/.test(inspection.sourceChargeId) ||
    !/^acct_[A-Za-z0-9]+$/.test(inspection.destinationAccountId) ||
    !Array.isArray(inspection.relevantTransfers) ||
    !Array.isArray(completedRequests) ||
    !Number.isSafeInteger(inspection.scannedTransferCount) ||
    inspection.scannedTransferCount < 0
  ) {
    throw new Error("TRANSFER_HISTORY_SCAN_INVALID");
  }

  const scanStartedAt = requiredTimestamp(inspection.checkedAt);
  const scanFinishedAt = requiredTimestamp(inspection.finishedAt);

  if (scanFinishedAt < scanStartedAt) {
    throw new Error("TRANSFER_HISTORY_SCAN_TIMES_INVALID");
  }

  const stripeById = new Map<
    string,
    SandboxSourceTransferInspection["relevantTransfers"][number]
  >();

  let sourceCount = 0;
  let destinationCount = 0;
  let destinationWithoutSourceCount = 0;

  for (const transfer of inspection.relevantTransfers) {
    if (
      !/^tr_[A-Za-z0-9]+$/.test(transfer.transferId) ||
      stripeById.has(transfer.transferId) ||
      transfer.livemode !== false ||
      !Number.isSafeInteger(transfer.amountCents) ||
      transfer.amountCents <= 0 ||
      !Number.isSafeInteger(transfer.created) ||
      transfer.created <= 0
    ) {
      throw new Error("TRANSFER_HISTORY_SCAN_TRANSFER_INVALID");
    }

    const matchesSource =
      transfer.sourceChargeId === inspection.sourceChargeId;

    const matchesDestination =
      transfer.destinationAccountId === inspection.destinationAccountId;

    if (
      (!matchesSource && !matchesDestination) ||
      transfer.matchesSourceCharge !== matchesSource ||
      transfer.matchesDestination !== matchesDestination
    ) {
      throw new Error("TRANSFER_HISTORY_SCAN_SCOPE_MISMATCH");
    }

    if (matchesSource) sourceCount++;

    if (matchesDestination) {
      destinationCount++;

      if (transfer.sourceChargeId === null) {
        destinationWithoutSourceCount++;
      }
    }

    /*
     * Een reversal niet verrekenen als nieuw beschikbaar budget.
     * Ook reversalrecords zonder positief reversed-bedrag blokkeren.
     */
    if (
      transfer.amountReversedCents !== 0 ||
      transfer.fullyReversed !== false ||
      transfer.hasReversalRecords !== false
    ) {
      throw new Error("TRANSFER_HISTORY_REVERSAL_REQUIRES_REVIEW");
    }

    stripeById.set(transfer.transferId, transfer);
  }

  if (
    inspection.sourceTransferCount !== sourceCount ||
    inspection.destinationTransferCount !== destinationCount ||
    inspection.destinationTransfersWithoutSourceCount !==
      destinationWithoutSourceCount ||
    inspection.scannedTransferCount < stripeById.size
  ) {
    throw new Error("TRANSFER_HISTORY_SCAN_COUNTS_MISMATCH");
  }

  const requestIds = new Set<string>();
  const bookingIds = new Set<string>();
  const matchedTransferIds = new Set<string>();

  const matchedTransfers:
    SandboxTransferHistoryComparison["matchedTransfers"] = [];

  let currentSourceTransferredCents = 0;
  let currentDestinationTransferredCents = 0;

  for (const entry of completedRequests) {
    /*
     * De builder valideert de financiële input en bouwt
     * de exact verwachte oorspronkelijke aanvraag opnieuw.
     */
    const built = buildTrainerTransferPayload(entry.expected);

    const requestId = entry.expected.requestId.toLowerCase();
    const bookingId = entry.expected.bookingId.toLowerCase();
    const trainerId = entry.expected.trainerId.toLowerCase();
    const purchaseId = entry.expected.packagePurchaseId.toLowerCase();

    if (
      requestIds.has(requestId) ||
      bookingIds.has(bookingId) ||
      matchedTransferIds.has(entry.stripeTransferId)
    ) {
      throw new Error("TRANSFER_HISTORY_DUPLICATE_DATABASE_ENTRY");
    }

    requestIds.add(requestId);
    bookingIds.add(bookingId);

    if (
      entry.requestStatus !== "succeeded" ||
      !/^tr_[A-Za-z0-9]+$/.test(entry.stripeTransferId) ||
      entry.storedIdempotencyKey !== built.idempotencyKey ||
      !isDeepStrictEqual(entry.storedPayload, built.payload)
    ) {
      throw new Error("TRANSFER_HISTORY_STORED_REQUEST_MISMATCH");
    }

    const preparedAt = requiredTimestamp(entry.firstStripeRequestAt);
    const sourceVerifiedAt = requiredTimestamp(entry.sourceVerifiedAt);
    const succeededAt = requiredTimestamp(entry.succeededAt);
    requiredTimestamp(entry.appliedAt);
    const bookingPaidAt = requiredTimestamp(entry.booking.trainerPaidAt);

    /*
     * Zelfde beperkte tolerantie als de bestaande SQL-toepassing.
     * Stripe created heeft secondenprecisie; servers kunnen
     * bovendien een klein klokverschil hebben.
     */
    if (
      sourceVerifiedAt > preparedAt + 5_000 ||
      succeededAt < preparedAt - 120_000
    ) {
      throw new Error("TRANSFER_HISTORY_REQUEST_TIMES_MISMATCH");
    }

    if (
      entry.booking.id !== bookingId ||
      entry.booking.trainerId !== trainerId ||
      entry.booking.packagePurchaseId !== purchaseId ||
      entry.booking.trainerNetAmountCents !== entry.expected.amountCents ||
      entry.booking.currency !== "eur" ||
      entry.booking.trainerPayoutStatus !== "paid" ||
      entry.booking.stripeTransferId !== entry.stripeTransferId ||
      bookingPaidAt !== succeededAt
    ) {
      throw new Error("TRANSFER_HISTORY_BOOKING_MISMATCH");
    }

    const matchesCurrentSource =
      entry.expected.sourceChargeId === inspection.sourceChargeId;

    const matchesCurrentDestination =
      entry.expected.destinationAccountId ===
      inspection.destinationAccountId;

    if (!matchesCurrentSource && !matchesCurrentDestination) {
      throw new Error("TRANSFER_HISTORY_DATABASE_SCOPE_MISMATCH");
    }

    const transfer = stripeById.get(entry.stripeTransferId);

    if (!transfer) {
      throw new Error("TRANSFER_HISTORY_DATABASE_TRANSFER_MISSING_AT_STRIPE");
    }

    if (
      transfer.sourceChargeId !== entry.expected.sourceChargeId ||
      transfer.destinationAccountId !==
        entry.expected.destinationAccountId ||
      transfer.amountCents !== entry.expected.amountCents ||
      transfer.currency !== "eur" ||
      transfer.transferGroup !== built.payload.transfer_group ||
      !isDeepStrictEqual(transfer.metadata, built.payload.metadata) ||
      transfer.created * 1000 !== succeededAt
    ) {
      throw new Error("TRANSFER_HISTORY_STRIPE_REQUEST_MISMATCH");
    }

    matchedTransferIds.add(transfer.transferId);

    if (matchesCurrentSource) {
      currentSourceTransferredCents = addSafeAmount(
        currentSourceTransferredCents,
        transfer.amountCents,
      );
    }

    if (matchesCurrentDestination) {
      currentDestinationTransferredCents = addSafeAmount(
        currentDestinationTransferredCents,
        transfer.amountCents,
      );
    }

    matchedTransfers.push({
      requestId,
      bookingId,
      packagePurchaseId: purchaseId,
      transferId: transfer.transferId,
      sourceChargeId: entry.expected.sourceChargeId,
      destinationAccountId: entry.expected.destinationAccountId,
      amountCents: transfer.amountCents,
      matchesCurrentSource,
      matchesCurrentDestination,
    });
  }

  /*
   * Geen relevante Stripe-transfer stilzwijgend overslaan.
   * Een ontbrekende lokale opdracht of foutieve metadata
   * resulteert dus niet in een succesvolle vergelijking.
   */
  if (matchedTransferIds.size !== stripeById.size) {
    throw new Error("TRANSFER_HISTORY_UNEXPLAINED_STRIPE_TRANSFER");
  }

  return {
    comparisonConfirmed: true,
    matchedTransfers,
    currentSourceTransferredCents,
    currentDestinationTransferredCents,
  };
}