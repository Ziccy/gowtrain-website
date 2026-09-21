import "server-only";

import { createClient } from "@supabase/supabase-js";
import { inspectSandboxPackageTransferSource } from "@/lib/inspect-sandbox-package-transfer-source";
import {
  compareSandboxTransferHistory,
  type CompletedSandboxTransferHistoryEntry,
  type SandboxTransferHistoryComparison,
} from "@/lib/compare-sandbox-transfer-history";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`${name} ontbreekt.`);

  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function requiredObject(
  value: unknown,
): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error("TRANSFER_HISTORY_DATABASE_OBJECT_INVALID");
  }

  return value;
}

function requiredString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error("TRANSFER_HISTORY_DATABASE_STRING_INVALID");
  }

  return value;
}

function requiredUuid(value: unknown): string {
  const text = requiredString(value);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      text,
    )
  ) {
    throw new Error("TRANSFER_HISTORY_DATABASE_UUID_INVALID");
  }

  return text.toLowerCase();
}

function requiredInteger(value: unknown, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error("TRANSFER_HISTORY_DATABASE_AMOUNT_INVALID");
  }

  return value;
}

function requiredTimestamp(value: unknown): string {
  const text = requiredString(value);

  if (!Number.isFinite(Date.parse(text))) {
    throw new Error("TRANSFER_HISTORY_DATABASE_TIMESTAMP_INVALID");
  }

  return text;
}

const database = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export type SandboxTransferHistoryInspection = {
  source: Awaited<
    ReturnType<typeof inspectSandboxPackageTransferSource>
  >;
  databaseRequestCount: number;
  historyComparison: SandboxTransferHistoryComparison;
};

/*
 * Inspectie van volledig afgeronde relevante transferhistorie.
 *
 * Alleen voor vertrouwde server-side aanroepers.
 * Een API-route moet zelf adminautorisatie uitvoeren.
 *
 * Geen registratie, claim, prepare of Stripe-write.
 * Geen resultaatsynchronisatie of incidentwijziging.
 *
 * Deze inspectieversie accepteert GEEN onafgeronde opdrachten.
 * Niet rechtstreeks gebruiken na het claimen van een nieuwe transfer.
 */
export async function inspectSandboxTransferHistory(
  purchaseId: string,
): Promise<SandboxTransferHistoryInspection> {
  purchaseId = requiredUuid(purchaseId);

  /*
   * Verifieert de aankoopcontext en actuele Stripe-betaalbron,
   * en scant transfers uit de bron of naar de bestemming.
   *
   * Bestaande refund-/disputeblokkades blijven behouden.
   */
  const source = await inspectSandboxPackageTransferSource(purchaseId);

  const { data, error } = await database.rpc(
    "read_sandbox_trainer_transfer_history",
    {
      p_purchase_id: purchaseId,
      p_source_charge_id: source.chargeId,
    },
  );

  if (error) {
    console.error("Transferhistorie ophalen mislukt:", {
      purchaseId,
      databaseCode: error.code,
    });

    throw new Error("TRANSFER_HISTORY_DATABASE_LOOKUP_FAILED");
  }

  const history = requiredObject(data);

  if (
    history.purchase_id !== purchaseId ||
    history.payment_intent_id !== source.paymentIntentId ||
    history.source_charge_id !== source.chargeId ||
    history.destination_account_id !==
      source.transferInspection.destinationAccountId ||
    history.stripe_livemode !== false ||
    !Array.isArray(history.requests) ||
    !Array.isArray(history.orphan_bookings)
  ) {
    throw new Error("TRANSFER_HISTORY_DATABASE_CONTEXT_MISMATCH");
  }

  const historyTrainerId = requiredUuid(history.trainer_id);
  const requestCount = requiredInteger(history.request_count, 0);

  if (requestCount !== history.requests.length) {
    throw new Error("TRANSFER_HISTORY_DATABASE_COUNT_MISMATCH");
  }

  if (history.orphan_bookings.length !== 0) {
    throw new Error("TRANSFER_HISTORY_ORPHAN_BOOKINGS_REQUIRE_REVIEW");
  }

  const completedRequests: CompletedSandboxTransferHistoryEntry[] = [];

  for (const value of history.requests) {
    const row = requiredObject(value);
    const request = requiredObject(row.request);
    const booking = requiredObject(row.booking);
    const purchase = requiredObject(row.purchase);

    /*
     * Voor deze inspectiestap niets overslaan.
     * Ook cancelled vereist later een afzonderlijke controle
     * op aantoonbaar onvoorbereide, onverzonden afhandeling.
     */
    if (request.status !== "succeeded") {
      throw new Error("TRANSFER_HISTORY_NONCOMPLETED_REQUEST_REQUIRES_REVIEW");
    }

    const requestId = requiredUuid(request.id);
    const bookingId = requiredUuid(request.booking_id);
    const trainerId = requiredUuid(request.trainer_id);
    const originalPurchaseId = requiredUuid(
      request.source_package_purchase_id,
    );

    const amountCents = requiredInteger(request.amount_cents, 1);
    const paymentIntentId = requiredString(
      request.stripe_payment_intent_id,
    );
    const destinationAccountId = requiredString(
      request.destination_account_id,
    );
    const sourceChargeId = requiredString(request.stripe_source_charge_id);
    const transferId = requiredString(request.stripe_transfer_id);

    if (
      request.currency !== "eur" ||
      request.stripe_livemode !== false ||
      request.funds_flow !== "separate_transfers_v1" ||
      request.has_lock_token !== false ||
      request.locked_until !== null
    ) {
      throw new Error("TRANSFER_HISTORY_COMPLETED_REQUEST_INVALID");
    }

    requiredInteger(request.attempts, 1);

    if (
      booking.id !== bookingId ||
      booking.trainer_id !== trainerId ||
      booking.package_purchase_id !== originalPurchaseId ||
      booking.currency !== "eur" ||
      booking.trainer_net_amount_cents !== amountCents ||
      purchase.id !== originalPurchaseId ||
      purchase.trainer_id !== trainerId ||
      purchase.currency !== "eur" ||
      purchase.stripe_livemode !== false ||
      purchase.funds_flow !== "separate_transfers_v1" ||
      purchase.stripe_payment_intent_id !== paymentIntentId
    ) {
      throw new Error("TRANSFER_HISTORY_PURCHASE_OR_BOOKING_MISMATCH");
    }

    requiredTimestamp(booking.paid_at);
    requiredTimestamp(purchase.paid_at);

    const bookingTotal = requiredInteger(booking.total_price_cents, 1);
    const bookingCommission = requiredInteger(
      booking.commission_amount_cents,
      0,
    );
    const purchaseTotal = requiredInteger(purchase.total_price_cents, 1);
    const purchaseTrainerNet = requiredInteger(
      purchase.trainer_net_amount_cents,
      0,
    );

    if (
      bookingCommission + amountCents !== bookingTotal ||
      bookingTotal > purchaseTotal ||
      amountCents > purchaseTrainerNet
    ) {
      throw new Error("TRANSFER_HISTORY_FINANCIAL_CONTEXT_MISMATCH");
    }

    /*
     * De huidige aankoop mag niet aan een andere betaalbron worden
     * gekoppeld. Omgekeerd mag dezelfde PI/charge niet ongemerkt
     * onder een andere aankoop worden verklaard.
     */
    const belongsToCurrentPurchase = originalPurchaseId === purchaseId;
    const matchesCurrentPayment = paymentIntentId === source.paymentIntentId;
    const matchesCurrentCharge = sourceChargeId === source.chargeId;

    if (
      (
        belongsToCurrentPurchase &&
        (
          trainerId !== historyTrainerId ||
          !matchesCurrentPayment ||
          !matchesCurrentCharge
        )
      ) ||
      (
        !belongsToCurrentPurchase &&
        (matchesCurrentPayment || matchesCurrentCharge)
      )
    ) {
      throw new Error("TRANSFER_HISTORY_SOURCE_PURCHASE_MISMATCH");
    }

    /*
     * De loader leest bewust ruimer dan de Stripe-scan.
     * Een historische bestemming van dezelfde trainer niet
     * ongemerkt wegfilteren: die valt buiten deze inspectiescope.
     */
    if (
      sourceChargeId !== source.chargeId &&
      destinationAccountId !==
        source.transferInspection.destinationAccountId
    ) {
      throw new Error("TRANSFER_HISTORY_OUTSIDE_SCAN_SCOPE_REQUIRES_REVIEW");
    }

    completedRequests.push({
      expected: {
        requestId,
        bookingId,
        trainerId,
        packagePurchaseId: originalPurchaseId,
        amountCents,
        currency: "eur",
        destinationAccountId,
        sourceChargeId,
        paymentIntentId,
        stripeLivemode: false,
        fundsFlow: "separate_transfers_v1",
      },

      requestStatus: "succeeded",
      storedPayload: requiredObject(request.stripe_request_payload),
      storedIdempotencyKey: requiredString(request.stripe_idempotency_key),

      stripeTransferId: transferId,
      firstStripeRequestAt: requiredTimestamp(
        request.first_stripe_request_at,
      ),
      sourceVerifiedAt: requiredTimestamp(request.source_verified_at),
      succeededAt: requiredTimestamp(request.succeeded_at),
      appliedAt: requiredTimestamp(request.applied_at),

      booking: {
        id: bookingId,
        trainerId,
        packagePurchaseId: originalPurchaseId,
        trainerNetAmountCents: amountCents,
        currency: "eur",
        trainerPayoutStatus: requiredString(
          booking.trainer_payout_status,
        ),
        stripeTransferId: requiredString(booking.stripe_transfer_id),
        trainerPaidAt: requiredTimestamp(booking.trainer_paid_at),
      },
    });
  }

  const historyComparison = compareSandboxTransferHistory({
    inspection: source.transferInspection,
    completedRequests,
  });

  return {
    source,
    databaseRequestCount: requestCount,
    historyComparison,
  };
}