import "server-only";

import type Stripe from "stripe";

export type TrainerTransferCreateParams = NonNullable<
  Parameters<Stripe["transfers"]["create"]>[0]
>;

type TrainerTransferPayloadInput = {
  requestId: string;
  bookingId: string;
  trainerId: string;
  packagePurchaseId: string;

  amountCents: number;
  currency: "eur";

  destinationAccountId: string;
  sourceChargeId: string;
  paymentIntentId: string;

  stripeLivemode: false;
  fundsFlow: "separate_transfers_v1";
};

export type PreparedTrainerTransferPayload = {
  idempotencyKey: string;
  payload: TrainerTransferCreateParams;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/*
 * Bouwt uitsluitend de aanvraag voor één pakketlestransfer.
 *
 * Alle input moet afkomstig zijn uit de gecontroleerde
 * transferopdracht en de geverifieerde betaalbron.
 *
 * Deze helper bewijst NIET:
 * - dat de les al transfergerechtigd is;
 * - dat er geen refund/melding/blokkade bestaat;
 * - dat de bestemming actueel geschikt is;
 * - dat de bron voldoende ruimte heeft;
 * - dat er niet eerder een transfer is uitgevoerd.
 *
 * Geen Stripe-aanroep of databasewrite.
 */
export function buildTrainerTransferPayload(
  input: TrainerTransferPayloadInput,
): PreparedTrainerTransferPayload {
  if (
    ![
      input.requestId,
      input.bookingId,
      input.trainerId,
      input.packagePurchaseId,
    ].every(isUuid) ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > 2147483647 ||
    input.currency !== "eur" ||
    input.stripeLivemode !== false ||
    input.fundsFlow !== "separate_transfers_v1" ||
    !/^acct_[A-Za-z0-9]+$/.test(input.destinationAccountId) ||
    !/^(ch|py)_[A-Za-z0-9]+$/.test(input.sourceChargeId) ||
    !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId)
  ) {
    throw new Error("TRAINER_TRANSFER_PAYLOAD_INPUT_INVALID");
  }

  // UUID's gelijk normaliseren aan PostgreSQL uuid::text.
  const requestId = input.requestId.toLowerCase();
  const bookingId = input.bookingId.toLowerCase();
  const trainerId = input.trainerId.toLowerCase();
  const purchaseId = input.packagePurchaseId.toLowerCase();

  const payload: TrainerTransferCreateParams = {
    amount: input.amountCents,
    currency: "eur",
    destination: input.destinationAccountId,

    /*
     * Gebruik de expliciet geverifieerde broncharge.
     * Nooit stilzwijgend terugvallen op een transfer zonder bron.
     */
    source_transaction: input.sourceChargeId,

    /*
     * Groepeert toekomstige lestransfers uit dezelfde aankoop.
     * Dit is alleen een referentie, geen saldoreservering
     * en geen deduplicatiemechanisme.
     */
    transfer_group: `gowtrain-package/${purchaseId}`,

    metadata: {
      gowtrain_transfer_request_id: requestId,
      gowtrain_booking_id: bookingId,
      gowtrain_trainer_id: trainerId,
      gowtrain_package_purchase_id: purchaseId,
      gowtrain_payment_intent_id: input.paymentIntentId,
      gowtrain_funds_flow: "separate_transfers_v1",
    },
  };

  return {
    idempotencyKey: `gowtrain-trainer-transfer/${requestId}`,
    payload,
  };
}