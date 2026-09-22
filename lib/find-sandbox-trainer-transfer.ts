import "server-only";

import { isDeepStrictEqual } from "node:util";
import type Stripe from "stripe";
import { buildTrainerTransferPayload } from "@/lib/stripe-trainer-transfer-payload";
import {
  verifySandboxTrainerTransfer,
  type VerifiedSandboxTrainerTransfer,
} from "@/lib/verify-sandbox-trainer-transfer";

type ExpectedTransfer =
  Parameters<typeof buildTrainerTransferPayload>[0];

export type OtherSourceTransferContext = {
  transferId: string;
  destinationAccountId: string | null;
  amountCents: number;
  currency: string;
  amountReversedCents: number;
  fullyReversed: boolean;
  metadataRequestId: string | null;
  metadataBookingId: string | null;
};

type SearchContext = {
  scannedTransferCount: number;
  checkedAt: string;
  finishedAt: string;

  /*
   * Alleen waarnemingen, geen goedgekeurde historie.
   * Deze transfers worden niet aan de onderzochte opdracht toegeschreven.
   */
  otherSourceTransfers: OtherSourceTransferContext[];
};

export type SandboxTransferSearchResult =
  | (SearchContext & {
      result: "verified_match";
      verified: VerifiedSandboxTrainerTransfer;
    })
  | (SearchContext & {
      result: "not_found_requires_review";
    });

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

/*
 * Onderzoek van precies één voorbereide opdracht.
 *
 * De aanroeper moet de context uit de opgeslagen opdracht halen.
 * Geen vrije browserinput of toewijzing op basis van alleen metadata.
 *
 * Deze functie maakt geen transfer aan en schrijft niets.
 * Geen match betekent nooit toestemming voor herverzending.
 *
 * Andere brontransfers worden als context teruggegeven.
 * Hun legitimiteit wordt hier NIET vastgesteld.
 */
export async function findSandboxTrainerTransfer(
  stripe: Stripe,
  input: {
    expected: ExpectedTransfer;
    storedPayload: unknown;
    storedIdempotencyKey: string;
    knownTransferId?: string | null;
  },
): Promise<SandboxTransferSearchResult> {
  const built = buildTrainerTransferPayload(input.expected);

  if (
    input.storedIdempotencyKey !== built.idempotencyKey ||
    !isDeepStrictEqual(input.storedPayload, built.payload)
  ) {
    throw new Error("TRANSFER_SEARCH_STORED_REQUEST_MISMATCH");
  }

  const knownTransferId = input.knownTransferId ?? null;

  if (
    knownTransferId !== null &&
    !/^tr_[A-Za-z0-9]+$/.test(knownTransferId)
  ) {
    throw new Error("TRANSFER_SEARCH_KNOWN_ID_INVALID");
  }

  const requestId = input.expected.requestId.toLowerCase();
  const bookingId = input.expected.bookingId.toLowerCase();
  const checkedAt = new Date().toISOString();

  const seenIds = new Set<string>();
  const candidateIds = new Set<string>();
  const bookingConflicts: string[] = [];
  const otherSourceTransfers: OtherSourceTransferContext[] = [];

  let startingAfter: string | undefined;
  let scanCompleted = false;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    /*
     * Geen bestemmingsfilter: ook een transfer met onze
     * opdrachtreferentie naar een verkeerde bestemming vinden.
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
      throw new Error("TRANSFER_SEARCH_PAGE_INVALID");
    }

    for (const transfer of page.data) {
      if (
        transfer.object !== "transfer" ||
        !/^tr_[A-Za-z0-9]+$/.test(transfer.id) ||
        seenIds.has(transfer.id)
      ) {
        throw new Error("TRANSFER_SEARCH_DUPLICATE_OR_INVALID_RESULT");
      }

      if (transfer.livemode !== false) {
        throw new Error("TRANSFER_SEARCH_LIVE_RESULT_NOT_ALLOWED");
      }

      seenIds.add(transfer.id);

      const metadataRequestId =
        transfer.metadata?.gowtrain_transfer_request_id ?? null;

      const metadataBookingId =
        transfer.metadata?.gowtrain_booking_id ?? null;

      const matchesRequest = metadataRequestId === requestId;
      const matchesKnownId = transfer.id === knownTransferId;
      const matchesBooking = metadataBookingId === bookingId;

      /*
       * De bekende ID en metadata zijn zoekreferenties.
       * De volledige aanvraag wordt na de scan opnieuw geverifieerd.
       */
      if (matchesRequest || matchesKnownId) {
        candidateIds.add(transfer.id);
      }

      /*
       * Een andere transfer die dezelfde les claimt niet
       * als normale eerdere pakketles behandelen.
       */
      if (matchesBooking && !matchesRequest && !matchesKnownId) {
        bookingConflicts.push(transfer.id);
      }

      const sourceChargeId = objectId(transfer.source_transaction);

      if (
        sourceChargeId === input.expected.sourceChargeId &&
        !matchesRequest &&
        !matchesKnownId
      ) {
        if (
          !Number.isSafeInteger(transfer.amount) ||
          transfer.amount <= 0 ||
          !Number.isSafeInteger(transfer.amount_reversed) ||
          transfer.amount_reversed < 0 ||
          transfer.amount_reversed > transfer.amount ||
          typeof transfer.reversed !== "boolean"
        ) {
          throw new Error("TRANSFER_SEARCH_CONTEXT_AMOUNT_INVALID");
        }

        otherSourceTransfers.push({
          transferId: transfer.id,
          destinationAccountId: objectId(transfer.destination),
          amountCents: transfer.amount,
          currency: transfer.currency,
          amountReversedCents: transfer.amount_reversed,
          fullyReversed: transfer.reversed,
          metadataRequestId,
          metadataBookingId,
        });
      }
    }

    if (!page.has_more) {
      scanCompleted = true;
      break;
    }

    startingAfter = page.data[page.data.length - 1]?.id;

    if (!startingAfter) {
      throw new Error("TRANSFER_SEARCH_CURSOR_MISSING");
    }
  }

  if (!scanCompleted) {
    throw new Error("TRANSFER_SEARCH_LIMIT_REACHED");
  }

  if (candidateIds.size > 1) {
    throw new Error("TRANSFER_SEARCH_MULTIPLE_MATCHES_REQUIRE_REVIEW");
  }

  if (bookingConflicts.length > 0) {
    throw new Error("TRANSFER_SEARCH_BOOKING_CONFLICT_REQUIRES_REVIEW");
  }

  const context: SearchContext = {
    scannedTransferCount: seenIds.size,
    checkedAt,
    finishedAt: new Date().toISOString(),
    otherSourceTransfers,
  };

  if (candidateIds.size === 0) {
    if (knownTransferId !== null) {
      throw new Error("TRANSFER_SEARCH_KNOWN_RESULT_MISSING");
    }

    return {
      ...context,
      result: "not_found_requires_review",
    };
  }

  const transferId = [...candidateIds][0];

  if (
    knownTransferId !== null &&
    transferId !== knownTransferId
  ) {
    throw new Error("TRANSFER_SEARCH_KNOWN_RESULT_MISMATCH");
  }

  /*
   * De zoekreferentie is niet genoeg:
   * retrieve + bedrag, bron, bestemming, groep,
   * exacte metadata en reversalcontrole.
   */
  const verified = await verifySandboxTrainerTransfer(stripe, {
    transferId,
    expected: input.expected,
    storedPayload: input.storedPayload,
    storedIdempotencyKey: input.storedIdempotencyKey,
  });

  return {
    ...context,
    result: "verified_match",
    verified,
  };
}