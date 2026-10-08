import "server-only";

import type {
  TrainerTransferCreateParams,
  PreparedTrainerTransferPayload,
} from "@/lib/stripe-trainer-transfer-payload";

export type SingleLessonTransferPayloadInput = {
  requestId: string;
  bookingId: string;
  trainerId: string;

  amountCents: number;
  currency: "eur";

  destinationAccountId: string;
  sourceChargeId: string;
  paymentIntentId: string;

  stripeLivemode: false;
  fundsFlow: "separate_transfers_v1";
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/*
 * Bouwt uitsluitend de aanvraag voor één losse-lestransfer.
 *
 * De aanroeper moet eerst bevestigen dat:
 * - de boeking geen pakketles is;
 * - de betaalbron en financiële verdeling kloppen;
 * - de transfergrens verstreken is;
 * - refunds, issues en Connect-blokkades ontbreken;
 * - de relevante database- en Stripe-historie overeenkomen;
 * - de opdracht een geldige, eenmalige claim heeft.
 *
 * Ondersteuning voor Checkout en PaymentSheet zit in de
 * bronvalidatie, niet in deze payloadbuilder.
 *
 * Geen Stripe-aanroep, databasewrite of uitvoeringsautorisatie.
 */
export function buildSingleLessonTrainerTransferPayload(
  input: SingleLessonTransferPayloadInput,
): PreparedTrainerTransferPayload {
  if (
    !input ||
    !isUuid(input.requestId) ||
    !isUuid(input.bookingId) ||
    !isUuid(input.trainerId) ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > 2147483647 ||
    input.currency !== "eur" ||
    input.stripeLivemode !== false ||
    input.fundsFlow !== "separate_transfers_v1" ||
    typeof input.destinationAccountId !== "string" ||
    input.destinationAccountId.length > 255 ||
    !/^acct_[A-Za-z0-9]+$/.test(input.destinationAccountId) ||
    typeof input.sourceChargeId !== "string" ||
    !/^(ch|py)_[A-Za-z0-9]+$/.test(input.sourceChargeId) ||
    typeof input.paymentIntentId !== "string" ||
    !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId)
  ) {
    throw new Error("TRAINER_SINGLE_TRANSFER_PAYLOAD_INPUT_INVALID");
  }

  /*
   * Een pakketcontext niet stilzwijgend als losse les behandelen.
   * De bestaande pakketbuilder blijft daarvoor verantwoordelijk.
   */
  if ("packagePurchaseId" in input) {
    throw new Error("TRAINER_SINGLE_TRANSFER_PACKAGE_CONTEXT_NOT_ALLOWED");
  }

  const requestId = input.requestId.toLowerCase();
  const bookingId = input.bookingId.toLowerCase();
  const trainerId = input.trainerId.toLowerCase();

  const payload: TrainerTransferCreateParams = {
    amount: input.amountCents,
    currency: "eur",
    destination: input.destinationAccountId,

    // Nooit terugvallen op een transfer zonder geverifieerde bron.
    source_transaction: input.sourceChargeId,

    /*
     * Nieuwe conventie voor losse lessen.
     * Groepering is geen saldoreservering of deduplicatie.
     */
    transfer_group: `gowtrain-single/${bookingId}`,

    metadata: {
      gowtrain_transfer_request_id: requestId,
      gowtrain_booking_id: bookingId,
      gowtrain_trainer_id: trainerId,
      gowtrain_payment_intent_id: input.paymentIntentId,
      gowtrain_funds_flow: "separate_transfers_v1",
      gowtrain_booking_type: "single_lesson",
    },
  };

  return {
    idempotencyKey: `gowtrain-trainer-transfer/${requestId}`,
    payload,
  };
}