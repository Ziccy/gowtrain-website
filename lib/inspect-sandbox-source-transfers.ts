import "server-only";

import type Stripe from "stripe";

export type TransferSummary = {
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

  // Extra gegevens voor vergelijking met opgeslagen opdrachten.
  livemode: false;
  metadata: Record<string, string>;
  hasReversalRecords: boolean;
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

function readMetadata(value: unknown): Record<string, string> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("TRANSFER_SCAN_METADATA_INVALID");
  }

  const entries = Object.entries(value);

  if (entries.some(([, item]) => typeof item !== "string")) {
    throw new Error("TRANSFER_SCAN_METADATA_INVALID");
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

/*
 * Alleen-lezen inventarisatie.
 *
 * Aanroepen met de bestaande platform-testclient:
 * geen Stripe-Account-header of andere accountcontext toevoegen.
 *
 * Geen transfer aanmaken, terugdraaien of administratief toepassen.
 * Geen berekening van vrij besteedbaar budget.
 *
 * Metadata is een vergelijkingsgegeven, geen zelfstandige
 * autorisatie of bewijs van een correcte financiële koppeling.
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
     * Geen destination- of transfer_group-filter.
     * Ook transfers uit de bron naar een andere bestemming
     * moeten zichtbaar blijven.
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
        !/^tr_[A-Za-z0-9]+$/.test(transfer.id) ||
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

      if (
        !Number.isSafeInteger(transfer.created) ||
        transfer.created <= 0 ||
        typeof transfer.currency !== "string" ||
        !transfer.currency ||
        (
          transfer.transfer_group !== null &&
          typeof transfer.transfer_group !== "string"
        )
      ) {
        throw new Error("TRANSFER_SCAN_TRANSFER_FIELDS_INVALID");
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

      if (!matchesSourceCharge && !matchesDestination) {
        continue;
      }

      /*
       * Alleen vaststellen of reversalrecords bestaan.
       * Een niet-lege of gedeeltelijke lijst nooit interpreteren
       * als een volledige inventarisatie van alle reversals.
       */
      if (
        !transfer.reversals ||
        !Array.isArray(transfer.reversals.data) ||
        typeof transfer.reversals.has_more !== "boolean"
      ) {
        throw new Error("TRANSFER_SCAN_REVERSAL_DATA_INVALID");
      }

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
        livemode: false,
        metadata: readMetadata(transfer.metadata),
        hasReversalRecords:
          transfer.reversals.data.length > 0 ||
          transfer.reversals.has_more,
      });
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

  // Een begrensde, onvolledige scan is geen geslaagde controle.
  throw new Error("TRANSFER_SCAN_LIMIT_REACHED");
}