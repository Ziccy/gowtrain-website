import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { findSandboxTrainerTransfer } from "@/lib/find-sandbox-trainer-transfer";
import {
  syncSandboxTrainerTransfer,
  type SandboxTrainerTransferSyncResult,
} from "@/lib/sync-sandbox-trainer-transfer";

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

async function readRequest(requestId: string) {
  const { data, error } = await supabaseAdmin
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
      stripe_transfer_id,
      succeeded_at,
      applied_at
    `)
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    console.error("Transferherstel: opdracht ophalen mislukt.", {
      requestId,
      databaseCode: error.code,
    });

    throw new Error("TRANSFER_RECOVERY_REQUEST_LOOKUP_FAILED");
  }

  if (!data) {
    throw new Error("TRANSFER_RECOVERY_REQUEST_MISSING");
  }

  return data;
}

export type SandboxTrainerTransferRecoveryResult =
  | {
      result: "lease_still_active" | "not_recovery_candidate";
      requestId: string;
    }
  | {
      result: "unprepared_requires_review";
      requestId: string;
    }
  | {
      result: "not_found_requires_review";
      requestId: string;
      scannedTransferCount: number;
      checkedAt: string;
      finishedAt: string;
    }
  | {
      result: "synchronized";
      requestId: string;
      synchronization: SandboxTrainerTransferSyncResult;
    };

/*
 * Alleen voor vertrouwde server-side aanroepers.
 * Een route moet zelf authenticatie en autorisatie controleren.
 *
 * Verwerkt precies één bestaande opdracht.
 *
 * Geen registratie of claim.
 * Geen prepare.
 * Geen Stripe-transferaanmaak of herverzending.
 * Geen automatische reset naar queued.
 *
 * Mogelijke databasewrites:
 * - verlopen claim blokkeren;
 * - geverifieerd Stripe-resultaat transactioneel toepassen.
 */
export async function reconcileSandboxTrainerTransfer(
  requestId: string,
): Promise<SandboxTrainerTransferRecoveryResult> {
  if (!isUuid(requestId)) {
    throw new Error("TRANSFER_RECOVERY_REQUEST_ID_INVALID");
  }

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("TRANSFER_RECOVERY_TEST_KEY_REQUIRED");
  }

  let request = await readRequest(requestId);

  if (
    request.stripe_livemode !== false ||
    request.funds_flow !== "separate_transfers_v1" ||
    !isUuid(request.source_package_purchase_id)
  ) {
    throw new Error("TRANSFER_RECOVERY_UNSUPPORTED_CONTEXT");
  }

  if (request.status === "processing") {
    /*
     * De database bepaalt onder locks met haar eigen klok
     * of de lease verlopen is.
     *
     * Niet afgaan op de lokale serverklok en geen blind
     * wissen van een claimtoken vanuit TypeScript.
     */
    const { data: blocked, error: blockError } =
      await supabaseAdmin.rpc(
        "block_expired_sandbox_trainer_transfer",
        {
          p_request_id: requestId,
        },
      );

    if (
      blockError ||
      !isObject(blocked) ||
      ![
        "lease_still_active",
        "blocked_for_review",
        "not_processing",
      ].includes(String(blocked.result)) ||
      blocked.request_id !== requestId
    ) {
      console.error("Transferherstel: blokkering niet bevestigd.", {
        requestId,
        databaseCode: blockError?.code,
      });

      throw new Error("TRANSFER_RECOVERY_BLOCK_NOT_CONFIRMED");
    }

    if (blocked.result === "lease_still_active") {
      return {
        result: "lease_still_active",
        requestId,
      };
    }

    // Een andere synchronisatie kan ondertussen zijn afgerond.
    request = await readRequest(requestId);
  }

  if (
    request.status !== "review_required" &&
    request.status !== "succeeded"
  ) {
    return {
      result: "not_recovery_candidate",
      requestId,
    };
  }

  /*
   * Een bestaand resultaat opnieuw volledig verifiëren via
   * de gedeelde synchronisatiehelper.
   *
   * Ook bij succeeded niet uitsluitend vertrouwen op de
   * lokaal opgeslagen status.
   */
  if (request.stripe_transfer_id !== null) {
    if (typeof request.stripe_transfer_id !== "string") {
      throw new Error("TRANSFER_RECOVERY_RESULT_ID_INVALID");
    }

    const synchronization = await syncSandboxTrainerTransfer(
      requestId,
      request.stripe_transfer_id,
    );

    return {
      result: "synchronized",
      requestId,
      synchronization,
    };
  }

  if (
    request.status === "succeeded" ||
    request.succeeded_at !== null ||
    request.applied_at !== null
  ) {
    throw new Error("TRANSFER_RECOVERY_RESULT_STATE_INCONSISTENT");
  }

  const hasPreparationTime =
    request.first_stripe_request_at !== null;

  const hasPayload =
    request.stripe_request_payload !== null;

  if (hasPreparationTime !== hasPayload) {
    throw new Error("TRANSFER_RECOVERY_PREPARATION_INCONSISTENT");
  }

  if (!hasPreparationTime) {
    /*
     * Geen vrijgave geregistreerd.
     * Toch geen automatische reset: gecontroleerde afhandeling
     * van onverzonden opdrachten wordt afzonderlijk gebouwd.
     */
    return {
      result: "unprepared_requires_review",
      requestId,
    };
  }

  if (
    !isUuid(request.booking_id) ||
    !isUuid(request.trainer_id) ||
    !isUuid(request.source_package_purchase_id) ||
    request.currency !== "eur" ||
    !Number.isSafeInteger(request.amount_cents) ||
    request.amount_cents <= 0 ||
    typeof request.destination_account_id !== "string" ||
    typeof request.stripe_payment_intent_id !== "string" ||
    typeof request.stripe_source_charge_id !== "string" ||
    typeof request.stripe_idempotency_key !== "string" ||
    !isObject(request.stripe_request_payload) ||
    typeof request.first_stripe_request_at !== "string" ||
    !Number.isFinite(Date.parse(request.first_stripe_request_at)) ||
    typeof request.source_verified_at !== "string" ||
    !Number.isFinite(Date.parse(request.source_verified_at))
  ) {
    throw new Error("TRANSFER_RECOVERY_PREPARED_CONTEXT_INVALID");
  }

  const search = await findSandboxTrainerTransfer(stripe, {
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

  if (search.result === "not_found_requires_review") {
    /*
     * Geen databasewijziging op basis van afwezigheid.
     * De opdracht wordt hier niet vrijgegeven of herverzonden.
     * Een gelijktijdige synchronisatie kan ondertussen wel
     * zelfstandig een gevonden resultaat hebben toegepast.
     */
    return {
      result: "not_found_requires_review",
      requestId,
      scannedTransferCount: search.scannedTransferCount,
      checkedAt: search.checkedAt,
      finishedAt: search.finishedAt,
    };
  }

  /*
   * Synchronisatie haalt opdracht én transfer opnieuw op.
   * Niet rechtstreeks de zoekresponse op de boeking toepassen.
   */
  const synchronization = await syncSandboxTrainerTransfer(
    requestId,
    search.verified.transferId,
  );

  return {
    result: "synchronized",
    requestId,
    synchronization,
  };
}