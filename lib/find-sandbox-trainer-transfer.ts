import "server-only";

import type Stripe from "stripe";
import { buildTrainerTransferPayload } from "@/lib/stripe-trainer-transfer-payload";
import {
  verifySandboxTrainerTransfer,
  type VerifiedSandboxTrainerTransfer,
} from "@/lib/verify-sandbox-trainer-transfer";
import { isDeepStrictEqual } from "node:util";

type ExpectedTransfer =
  Parameters<typeof buildTrainerTransferPayload>[0];

export type SandboxTransferSearchResult =
  | {
      result: "verified_match";
      scannedTransferCount: number;
      verified: VerifiedSandboxTrainerTransfer;
    }
  | {
      result: "not_found_requires_review";
      scannedTransferCount: number;
      checkedAt: string;
      finishedAt: string;
    };

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

/*
 * Uitsluitend zoeken naar een reeds uitgevoerde transfer.
 *
 * De aanroeper moet vooraf uit de database bevestigen:
 * - bestaande voorbereide testopdracht;
 * - processing of review_required;
 * - opgeslagen payload en bronverificatie;
 * - geen reeds bekend transfer-ID.
 *
 * Gebruik uitsluitend de platform-testclient.
 *
 * Geen transferaanmaak, herverzending, reset of databasewrite.
 */
export async function findSandboxTrainerTransfer(
  stripe: Stripe,
  input: {
    expected: ExpectedTransfer;
    storedPayload: unknown;
    storedIdempotencyKey: string;
  },
): Promise<SandboxTransferSearchResult> {
  const built = buildTrainerTransferPayload(input.expected);

  if (
    input.storedIdempotencyKey !== built.idempotencyKey ||
    !isDeepStrictEqual(input.storedPayload, built.payload)
  ) {
    throw new Error("TRANSFER_SEARCH_STORED_REQUEST_MISMATCH");
  }

  const requestId = input.expected.requestId.toLowerCase();
  const checkedAt = new Date().toISOString();

  const seenIds = new Set<string>();
  const candidateIds: string[] = [];

  /*
   * Ook transfers uit dezelfde bron naar dezelfde bestemming
   * zonder onze verwachte opdrachtmetadata signaleren.
   * Die kunnen we niet automatisch aan deze opdracht toewijzen.
   */
  const unexplainedIds: string[] = [];

  let startingAfter: string | undefined;
  let scanCompleted = false;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    /*
     * Geen destination- of transfer_group-filter:
     * een verkeerd uitgevoerde transfer met onze opdrachtmetadata
     * moet ook worden gevonden en vervolgens worden geweigerd.
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
        !transfer.id ||
        seenIds.has(transfer.id)
      ) {
        throw new Error("TRANSFER_SEARCH_DUPLICATE_OR_INVALID_RESULT");
      }

      if (transfer.livemode !== false) {
        throw new Error("TRANSFER_SEARCH_LIVE_RESULT_NOT_ALLOWED");
      }

      seenIds.add(transfer.id);

      const metadataRequestId =
        transfer.metadata?.gowtrain_transfer_request_id;

      if (metadataRequestId === requestId) {
        candidateIds.push(transfer.id);
      } else if (
        objectId(transfer.source_transaction) ===
          input.expected.sourceChargeId &&
        objectId(transfer.destination) ===
          input.expected.destinationAccountId
      ) {
        unexplainedIds.push(transfer.id);
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

  /*
   * Nooit de eerste match kiezen als meerdere transfers
   * dezelfde opdracht claimen. Ook reversals niet wegfilteren.
   */
  if (candidateIds.length > 1) {
    throw new Error("TRANSFER_SEARCH_MULTIPLE_MATCHES_REQUIRE_REVIEW");
  }

  /*
   * Eerste uitvoeringsflow: geen andere transfers uit deze bron
   * naar deze bestemming automatisch verklaren of verrekenen.
   */
  if (unexplainedIds.length > 0) {
    throw new Error("TRANSFER_SEARCH_OTHER_SOURCE_TRANSFERS_REQUIRE_REVIEW");
  }

  if (candidateIds.length === 0) {
    return {
      result: "not_found_requires_review",
      scannedTransferCount: seenIds.size,
      checkedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  /*
   * Metadata is slechts de zoekreferentie.
   * De volledige opgeslagen aanvraag moet overeenkomen:
   * bedrag, valuta, bron, bestemming, groep, metadata en reversals.
   */
  const verified = await verifySandboxTrainerTransfer(stripe, {
    transferId: candidateIds[0],
    expected: input.expected,
    storedPayload: input.storedPayload,
    storedIdempotencyKey: input.storedIdempotencyKey,
  });

  return {
    result: "verified_match",
    scannedTransferCount: seenIds.size,
    verified,
  };
}