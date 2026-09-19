import "server-only";

import { isDeepStrictEqual } from "node:util";
import type Stripe from "stripe";
import { buildTrainerTransferPayload } from "@/lib/stripe-trainer-transfer-payload";

type TransferPayloadInput =
  Parameters<typeof buildTrainerTransferPayload>[0];

export type VerifiedSandboxTrainerTransfer = {
  requestId: string;
  bookingId: string;
  packagePurchaseId: string;
  trainerId: string;

  transferId: string;
  destinationAccountId: string;
  sourceChargeId: string;

  amountCents: number;
  currency: "eur";
  livemode: false;

  stripeCreatedAt: string;
  checkedAt: string;
};

function objectId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

/*
 * Verifieert een bestaande transfer tegen een voorbereide opdracht.
 *
 * input.expected, storedPayload en storedIdempotencyKey moeten
 * afkomstig zijn uit de bestaande databaseopdracht.
 *
 * De aanroeper moet bovendien controleren dat:
 * - de opdracht daadwerkelijk is voorbereid;
 * - de payload en bronverificatie onveranderlijk zijn opgeslagen;
 * - een eventueel eerder opgeslagen transfer-ID overeenkomt;
 * - de huidige status gecontroleerde synchronisatie toestaat.
 *
 * Geen transferaanmaak.
 * Geen databasewrites.
 * Geen bankpayout.
 */
export async function verifySandboxTrainerTransfer(
  stripe: Stripe,
  input: {
    transferId: string;
    expected: TransferPayloadInput;
    storedPayload: unknown;
    storedIdempotencyKey: string;
  },
): Promise<VerifiedSandboxTrainerTransfer> {
  if (!/^tr_[A-Za-z0-9]+$/.test(input.transferId)) {
    throw new Error("TRAINER_TRANSFER_RESULT_ID_INVALID");
  }

  const built = buildTrainerTransferPayload(input.expected);

  if (
    input.storedIdempotencyKey !== built.idempotencyKey ||
    !isDeepStrictEqual(input.storedPayload, built.payload)
  ) {
    throw new Error("TRAINER_TRANSFER_STORED_REQUEST_MISMATCH");
  }

  const checkedAt = new Date().toISOString();

  const transfer = await stripe.transfers.retrieve(input.transferId);

  if (
    transfer.object !== "transfer" ||
    transfer.id !== input.transferId
  ) {
    throw new Error("TRAINER_TRANSFER_RESULT_ID_MISMATCH");
  }

  if (transfer.livemode !== false) {
    throw new Error("TRAINER_TRANSFER_RESULT_LIVE_NOT_ALLOWED");
  }

  if (
    !Number.isSafeInteger(transfer.amount) ||
    transfer.amount <= 0 ||
    transfer.amount !== input.expected.amountCents ||
    transfer.currency !== "eur"
  ) {
    throw new Error("TRAINER_TRANSFER_RESULT_AMOUNT_MISMATCH");
  }

  const destinationAccountId = objectId(transfer.destination);
  const sourceChargeId = objectId(transfer.source_transaction);

  if (
    destinationAccountId !== input.expected.destinationAccountId ||
    sourceChargeId !== input.expected.sourceChargeId
  ) {
    throw new Error("TRAINER_TRANSFER_RESULT_ACCOUNT_OR_SOURCE_MISMATCH");
  }

  if (
    transfer.transfer_group !== built.payload.transfer_group ||
    !isDeepStrictEqual(transfer.metadata, built.payload.metadata)
  ) {
    throw new Error("TRAINER_TRANSFER_RESULT_METADATA_MISMATCH");
  }

  /*
   * Eerste synchronisatieversie ondersteunt geen reversals.
   * Een teruggedraaide transfer niet simpelweg als betaald boeken.
   */
  if (
    !Number.isSafeInteger(transfer.amount_reversed) ||
    transfer.amount_reversed !== 0 ||
    transfer.reversed !== false
  ) {
    throw new Error("TRAINER_TRANSFER_REVERSAL_REQUIRES_REVIEW");
  }

  if (
    !transfer.reversals ||
    !Array.isArray(transfer.reversals.data) ||
    transfer.reversals.data.length !== 0 ||
    transfer.reversals.has_more !== false
  ) {
    throw new Error("TRAINER_TRANSFER_REVERSAL_REQUIRES_REVIEW");
  }

  if (
    !Number.isSafeInteger(transfer.created) ||
    transfer.created <= 0
  ) {
    throw new Error("TRAINER_TRANSFER_CREATED_AT_INVALID");
  }

  const stripeCreatedAt = new Date(transfer.created * 1000);

  if (!Number.isFinite(stripeCreatedAt.getTime())) {
    throw new Error("TRAINER_TRANSFER_CREATED_AT_INVALID");
  }

  return {
    requestId: input.expected.requestId.toLowerCase(),
    bookingId: input.expected.bookingId.toLowerCase(),
    packagePurchaseId: input.expected.packagePurchaseId.toLowerCase(),
    trainerId: input.expected.trainerId.toLowerCase(),

    transferId: transfer.id,
    destinationAccountId,
    sourceChargeId,

    amountCents: transfer.amount,
    currency: "eur",
    livemode: false,

    stripeCreatedAt: stripeCreatedAt.toISOString(),
    checkedAt,
  };
}