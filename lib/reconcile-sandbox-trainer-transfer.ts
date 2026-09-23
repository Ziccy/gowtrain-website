import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  findSandboxTrainerTransfer,
  type OtherSourceTransferContext,
  type SandboxTransferSearchResult,
} from "@/lib/find-sandbox-trainer-transfer";
import {
  syncSandboxTrainerTransfer,
  type SandboxTrainerTransferSyncResult,
} from "@/lib/sync-sandbox-trainer-transfer";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`${name} ontbreekt.`);

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

type RecoverySearchContext = {
  scannedTransferCount: number;
  checkedAt: string;
  finishedAt: string;

  // Deze overige transfers zijn niet door deze herstelactie goedgekeurd.
  otherSourceTransfers: OtherSourceTransferContext[];
  historyApprovalGranted: false;
};

export type SandboxTrainerTransferRecoveryResult =
  | {
      result: "lease_still_active" | "not_recovery_candidate";
      requestId: string;
    }
  | {
      result: "unprepared_requires_review";
      requestId: string;
    }
  | (RecoverySearchContext & {
      result: "not_found_requires_review";
      requestId: string;
    })
  | (RecoverySearchContext & {
      result: "synchronized";
      requestId: string;
      synchronization: SandboxTrainerTransferSyncResult;
    });

/*
 * Herstel van precies één bestaande opdracht.
 *
 * Alleen voor vertrouwde server-side aanroepers.
 * Een route moet zelf authenticatie en autorisatie uitvoeren.
 *
 * Geen registratie, claim, prepare of transfers.create.
 * Geen reset of automatische herverzending.
 *
 * Mogelijke databasewrites:
 * - verlopen claim blokkeren;
 * - geverifieerd bestaand resultaat toepassen.
 *
 * Andere brontransfers zijn context, geen goedgekeurde historie.
 * Nieuwe prepare blijft de volledige historiecontrole vereisen.
 */
export async function reconcileSandboxTrainerTransfer(
  requestId: string,
  recordCompletedSearch?: (
    search: SandboxTransferSearchResult,
  ) => Promise<void>,
): Promise<SandboxTrainerTransferRecoveryResult> {
  if (!isUuid(requestId)) {
    throw new Error("TRANSFER_RECOVERY_REQUEST_ID_INVALID");
  }

  requestId = requestId.toLowerCase();

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

  const hasPreparationTime =
    request.first_stripe_request_at !== null;
  const hasPayload =
    request.stripe_request_payload !== null;

  if (hasPreparationTime !== hasPayload) {
    throw new Error("TRANSFER_RECOVERY_PREPARATION_INCONSISTENT");
  }

  if (!hasPreparationTime) {
    if (
      request.stripe_transfer_id !== null ||
      request.succeeded_at !== null ||
      request.applied_at !== null ||
      request.status === "succeeded"
    ) {
      throw new Error("TRANSFER_RECOVERY_RESULT_STATE_INCONSISTENT");
    }

    return {
      result: "unprepared_requires_review",
      requestId,
    };
  }

  const knownTransferId = request.stripe_transfer_id;

  if (
    knownTransferId !== null &&
    (
      typeof knownTransferId !== "string" ||
      !/^tr_[A-Za-z0-9]+$/.test(knownTransferId)
    )
  ) {
    throw new Error("TRANSFER_RECOVERY_RESULT_ID_INVALID");
  }

  if (
    knownTransferId === null &&
    (
      request.status === "succeeded" ||
      request.succeeded_at !== null ||
      request.applied_at !== null
    )
  ) {
    throw new Error("TRANSFER_RECOVERY_RESULT_STATE_INCONSISTENT");
  }

  if (
    !isUuid(request.booking_id) ||
    !isUuid(request.trainer_id) ||
    !isUuid(request.source_package_purchase_id) ||
    request.currency !== "eur" ||
    request.stripe_livemode !== false ||
    request.funds_flow !== "separate_transfers_v1" ||
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
    knownTransferId,
  });

  /*
   * Bij een geregistreerd onderzoek de voltooide zoekscan
   * duurzaam opslaan vóór eventuele financiële synchronisatie.
   *
   * Opslagfout: exception doorgeven, niet doorgaan naar sync.
   * Geen gedeeltelijke of mislukte zoekscan als voltooid registreren.
   *
   * De callback is alleen voor vertrouwde server-side aanroepers.
   * Bestaande directe aanroepers zonder callback blijven compatibel,
   * maar slaan daarmee geen onderzoeksscan op.
   */
  if (recordCompletedSearch) {
    await recordCompletedSearch(search);
  }

  const searchContext: RecoverySearchContext = {
    scannedTransferCount: search.scannedTransferCount,
    checkedAt: search.checkedAt,
    finishedAt: search.finishedAt,
    otherSourceTransfers: search.otherSourceTransfers,
    historyApprovalGranted: false,
  };

  if (search.otherSourceTransfers.length > 0) {
    console.info("Transferherstel: overige brontransfers waargenomen.", {
      requestId,
      otherTransferIds: search.otherSourceTransfers.map(
        (transfer) => transfer.transferId,
      ),
      historyApprovalGranted: false,
    });
  }

  if (search.result === "not_found_requires_review") {
    /*
     * Afwezigheid tijdens de scan geeft geen toestemming
     * voor reset, nieuwe vrijgave of herverzending.
     */
    return {
      result: "not_found_requires_review",
      requestId,
      ...searchContext,
    };
  }

  /*
   * Haal opdracht en transfer opnieuw op via de gedeelde sync.
   * Laat de database onder locks de daadwerkelijke toepassing
   * en eventuele herhaalde toepassing controleren.
   */
  const synchronization = await syncSandboxTrainerTransfer(
    requestId,
    search.verified.transferId,
  );

  return {
    result: "synchronized",
    requestId,
    synchronization,
    ...searchContext,
  };
}