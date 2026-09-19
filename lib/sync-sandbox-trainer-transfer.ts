import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { verifySandboxTrainerTransfer } from "@/lib/verify-sandbox-trainer-transfer";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

const stripe = new Stripe(stripeKey, {
  timeout: 10_000,
  maxNetworkRetries: 0,
});

const supabaseAdmin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export type SandboxTrainerTransferSyncResult = {
  result: "applied" | "already_applied";
  requestId: string;
  bookingId: string;
  transferId: string;
  appliedAt: string;
};

/*
 * Alleen voor vertrouwde server-side aanroepers.
 * Een eventuele API-route moet zelf autorisatie afdwingen.
 *
 * Controleert één bestaand Stripe-transferobject tegen de
 * oorspronkelijke voorbereide databaseopdracht.
 *
 * Geen transferaanmaak.
 * Geen reset, herclaim of nieuwe vrijgave.
 * Geen bankuitbetaling.
 */
export async function syncSandboxTrainerTransfer(
  requestId: string,
  transferId: string,
): Promise<SandboxTrainerTransferSyncResult> {
  if (
    !isUuid(requestId) ||
    !/^tr_[A-Za-z0-9]+$/.test(transferId)
  ) {
    throw new Error("TRAINER_TRANSFER_SYNC_INPUT_INVALID");
  }

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("TRAINER_TRANSFER_SYNC_TEST_KEY_REQUIRED");
  }

  const { data: request, error: requestError } = await supabaseAdmin
    .from("trainer_transfer_requests")
    .select(`
      id,
      booking_id,
      trainer_id,
      source_package_purchase_id,
      amount_cents,
      currency,
      destination_account_id,
      stripe_payment_intent_id,
      stripe_livemode,
      funds_flow,
      stripe_source_charge_id,
      source_verified_at,
      status,
      stripe_idempotency_key,
      stripe_request_payload,
      first_stripe_request_at,
      stripe_transfer_id
    `)
    .eq("id", requestId)
    .maybeSingle();

  if (requestError) {
    console.error("Transferopdracht ophalen voor synchronisatie mislukt:", {
      requestId,
      databaseCode: requestError.code,
    });

    throw new Error("TRAINER_TRANSFER_SYNC_REQUEST_LOOKUP_FAILED");
  }

  if (!request) {
    throw new Error("TRAINER_TRANSFER_SYNC_REQUEST_MISSING");
  }

  if (
    !isUuid(request.booking_id) ||
    !isUuid(request.trainer_id) ||
    !isUuid(request.source_package_purchase_id) ||
    request.stripe_livemode !== false ||
    request.funds_flow !== "separate_transfers_v1" ||
    request.currency !== "eur" ||
    !Number.isSafeInteger(request.amount_cents) ||
    request.amount_cents <= 0 ||
    typeof request.destination_account_id !== "string" ||
    typeof request.stripe_payment_intent_id !== "string" ||
    typeof request.stripe_source_charge_id !== "string" ||
    typeof request.stripe_idempotency_key !== "string" ||
    !isObject(request.stripe_request_payload) ||
    !request.first_stripe_request_at ||
    !Number.isFinite(Date.parse(request.first_stripe_request_at)) ||
    !request.source_verified_at ||
    !Number.isFinite(Date.parse(request.source_verified_at)) ||
    !["processing", "review_required", "succeeded"].includes(
      request.status,
    )
  ) {
    throw new Error("TRAINER_TRANSFER_SYNC_PREPARED_CONTEXT_INVALID");
  }

  if (
    request.stripe_transfer_id !== null &&
    request.stripe_transfer_id !== transferId
  ) {
    throw new Error("TRAINER_TRANSFER_SYNC_EXISTING_RESULT_MISMATCH");
  }

  /*
   * Gebruik de oorspronkelijke bestemming uit de opdracht.
   * Niet vervangen door een eventueel later gewijzigde
   * trainerkoppeling: we registreren het werkelijk uitgevoerde resultaat.
   */
  const verified = await verifySandboxTrainerTransfer(stripe, {
    transferId,
    expected: {
      requestId: request.id,
      bookingId: request.booking_id,
      trainerId: request.trainer_id,
      packagePurchaseId: request.source_package_purchase_id,
      amountCents: request.amount_cents,
      currency: "eur",
      destinationAccountId: request.destination_account_id,
      sourceChargeId: request.stripe_source_charge_id,
      paymentIntentId: request.stripe_payment_intent_id,
      stripeLivemode: false,
      fundsFlow: "separate_transfers_v1",
    },
    storedPayload: request.stripe_request_payload,
    storedIdempotencyKey: request.stripe_idempotency_key,
  });

  /*
   * Geen geldige uitvoeringslease vereist voor synchronisatie.
   * De RPC controleert de actuele opdracht en boeking opnieuw
   * onder locks en past beide transactioneel toe.
   */
  const { data: result, error: applyError } = await supabaseAdmin.rpc(
    "apply_verified_sandbox_trainer_transfer",
    {
      p_request_id: verified.requestId,
      p_transfer_id: verified.transferId,
      p_destination_account_id: verified.destinationAccountId,
      p_source_charge_id: verified.sourceChargeId,
      p_amount_cents: verified.amountCents,
      p_currency: verified.currency,
      p_stripe_created_at: verified.stripeCreatedAt,
      p_checked_at: verified.checkedAt,
    },
  );

  if (applyError) {
    console.error("Stripe-transfer geverifieerd; toepassing niet bevestigd:", {
      requestId,
      transferId,
      databaseCode: applyError.code,
    });

    /*
     * Geen transfer opnieuw aanmaken.
     * De bestaande transfer is bij Stripe aangetroffen.
     */
    throw new Error("TRAINER_TRANSFER_SYNC_APPLICATION_NOT_CONFIRMED");
  }

  if (
    !isObject(result) ||
    (result.result !== "applied" && result.result !== "already_applied") ||
    result.request_id !== verified.requestId ||
    result.booking_id !== verified.bookingId ||
    result.stripe_transfer_id !== verified.transferId ||
    typeof result.applied_at !== "string" ||
    !Number.isFinite(Date.parse(result.applied_at))
  ) {
    throw new Error("TRAINER_TRANSFER_SYNC_RESPONSE_NOT_CONFIRMED");
  }

  return {
    result: result.result,
    requestId: verified.requestId,
    bookingId: verified.bookingId,
    transferId: verified.transferId,
    appliedAt: result.applied_at,
  };
}