import "server-only";

import type Stripe from "stripe";

type TransferSummary = {
  transferId: string;
  destinationAccountId: string | null;
  sourceChargeId: string | null;
  amountCents: number;
  amountReversedCents: number;
  currency: string;
  fullyReversed: boolean;
  created: number;
  transferGroup: string | null;
  matchesSourceCharge: boolean;
  matchesDestination: boolean;
};

export type SandboxSourceTransferInspection = {
  scanCompleted: true;
  checkedAt: string;
  finishedAt: string;
  scannedTransferCount: number;
  sourceChargeId: string;
  destinationAccountId: string;
  sourceTransferCount: number;
  destinationTransferCount: number;
  destinationTransfersWithoutSourceCount: number;
  relevantTransfers: TransferSummary[];
};

const MAX_PAGES = 20;
const PAGE_SIZE = 100;

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

/*
 * Alleen-lezen inventarisatie.
 *
 * Aanroepen met de bestaande platform-testclient:
 * geen Stripe-Account-header of andere accountcontext toevoegen.
 *
 * Geen transfer aanmaken, terugdraaien of administratief toepassen.
 * Geen berekening van vrij besteedbaar budget.
 */
export async function inspectSandboxSourceTransfers(
  stripe: Stripe,
  expected: {
    sourceChargeId: string;
    destinationAccountId: string;
  },
): Promise<SandboxSourceTransferInspection> {
  if (
    !/^(ch|py)_[A-Za-z0-9]+$/.test(expected.sourceChargeId) ||
    !/^acct_[A-Za-z0-9]+$/.test(expected.destinationAccountId)
  ) {
    throw new Error("TRANSFER_SCAN_CONTEXT_INVALID");
  }

  const checkedAt = new Date().toISOString();
  const seenIds = new Set<string>();
  const relevantTransfers: TransferSummary[] = [];

  let startingAfter: string | undefined;
  let sourceTransferCount = 0;
  let destinationTransferCount = 0;
  let destinationTransfersWithoutSourceCount = 0;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    /*
     * Niet filteren op destination of transfer_group:
     * een transfer uit de broncharge naar een andere bestemming
     * moet ook zichtbaar zijn.
     */
    const page = await stripe.transfers.list({
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    if (
      !Array.isArray(page.data) ||
      typeof page.has_more !== "boolean" ||
      (page.has_more && page.data.length === 0)
    ) {
      throw new Error("TRANSFER_SCAN_PAGE_INVALID");
    }

    for (const transfer of page.data) {
      if (
        transfer.object !== "transfer" ||
        !transfer.id ||
        seenIds.has(transfer.id)
      ) {
        throw new Error("TRANSFER_SCAN_DUPLICATE_OR_INVALID_RESULT");
      }

      if (transfer.livemode !== false) {
        throw new Error("TRANSFER_SCAN_LIVE_RESULT_NOT_ALLOWED");
      }

      if (
        !Number.isSafeInteger(transfer.amount) ||
        transfer.amount <= 0 ||
        !Number.isSafeInteger(transfer.amount_reversed) ||
        transfer.amount_reversed < 0 ||
        transfer.amount_reversed > transfer.amount ||
        typeof transfer.reversed !== "boolean"
      ) {
        throw new Error("TRANSFER_SCAN_AMOUNT_INVALID");
      }

      seenIds.add(transfer.id);

      const sourceChargeId = objectId(transfer.source_transaction);
      const destinationAccountId = objectId(transfer.destination);

      const matchesSourceCharge =
        sourceChargeId === expected.sourceChargeId;

      const matchesDestination =
        destinationAccountId === expected.destinationAccountId;

      if (matchesSourceCharge) {
        sourceTransferCount++;
      }

      if (matchesDestination) {
        destinationTransferCount++;

        if (sourceChargeId === null) {
          destinationTransfersWithoutSourceCount++;
        }
      }

      if (matchesSourceCharge || matchesDestination) {
        relevantTransfers.push({
          transferId: transfer.id,
          destinationAccountId,
          sourceChargeId,
          amountCents: transfer.amount,
          amountReversedCents: transfer.amount_reversed,
          currency: transfer.currency,
          fullyReversed: transfer.reversed,
          created: transfer.created,
          transferGroup: transfer.transfer_group,
          matchesSourceCharge,
          matchesDestination,
        });
      }
    }

    if (!page.has_more) {
      return {
        scanCompleted: true,
        checkedAt,
        finishedAt: new Date().toISOString(),
        scannedTransferCount: seenIds.size,
        sourceChargeId: expected.sourceChargeId,
        destinationAccountId: expected.destinationAccountId,
        sourceTransferCount,
        destinationTransferCount,
        destinationTransfersWithoutSourceCount,
        relevantTransfers,
      };
    }

    startingAfter = page.data[page.data.length - 1]?.id;

    if (!startingAfter) {
      throw new Error("TRANSFER_SCAN_CURSOR_MISSING");
    }
  }

  /*
   * Geen gedeeltelijke uitkomst als volledige controle presenteren.
   * Grotere datasets vragen een afzonderlijke, duurzame scan.
   */
  throw new Error("TRANSFER_SCAN_LIMIT_REACHED");
}