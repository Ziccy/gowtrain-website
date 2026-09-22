import "server-only";

import { createClient } from "@supabase/supabase-js";
import { inspectSandboxPackageTransferSource } from "@/lib/inspect-sandbox-package-transfer-source";
import {
  compareSandboxTransferHistory,
  type CompletedSandboxTransferHistoryEntry,
  type SandboxTransferHistoryComparison,
} from "@/lib/compare-sandbox-transfer-history";
import {
  separateClaimedTransferHistory,
} from "@/lib/separate-claimed-transfer-history";

type VerifiedSource = Awaited<
  ReturnType<typeof inspectSandboxPackageTransferSource>
>;

type ExpectedClaim = Parameters<
  typeof separateClaimedTransferHistory
>[0]["expected"];

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
  source: VerifiedSource;
  databaseRequestCount: number;
  historyComparison: SandboxTransferHistoryComparison;
};

export type ClaimedSandboxTransferHistoryInspection = {
  source: VerifiedSource;
  currentRequestId: string;

  // Inclusief de ene gecontroleerde eigen claim.
  databaseRequestCount: number;

  // Alleen de eerdere, volledig gecontroleerde opdrachten.
  completedRequestCount: number;

  claimCheckedAt: string;
  claimLockedUntil: string;
  historyComparison: SandboxTransferHistoryComparison;
};

/*
 * Gedeelde validatie voor eerdere, afgeronde opdrachten.
 *
 * Bij een gewone inspectie is dit de volledige databasehistorie.
 * Bij claiminspectie is uitsluitend de vooraf door de RPC en
 * separateClaimedTransferHistory gecontroleerde eigen claim verwijderd.
 *
 * Alle overige statussen, ook cancelled, worden voorlopig geweigerd.
 *
 * Geen netwerkverkeer of databasewrites in deze functie.
 */
function validateCompletedHistory(
  rawHistory: unknown,
  source: VerifiedSource,
): {
  completedRequestCount: number;
  historyComparison: SandboxTransferHistoryComparison;
} {
  const history = requiredObject(rawHistory);
  const purchaseId = source.purchaseId;

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
     * Geen andere onzekere, geclaimde of geannuleerde opdracht
     * stilzwijgend overslaan.
     */
    if (request.status !== "succeeded") {
      throw new Error(
        "TRANSFER_HISTORY_NONCOMPLETED_REQUEST_REQUIRES_REVIEW",
      );
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
    const sourceChargeId = requiredString(
      request.stripe_source_charge_id,
    );
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
    const purchaseTotal = requiredInteger(
      purchase.total_price_cents,
      1,
    );
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
     * De huidige aankoop moet dezelfde PI en broncharge gebruiken.
     * Een andere aankoop mag niet stilzwijgend dezelfde betaalbron
     * claimen.
     */
    const belongsToCurrentPurchase = originalPurchaseId === purchaseId;
    const matchesCurrentPayment =
      paymentIntentId === source.paymentIntentId;
    const matchesCurrentCharge =
      sourceChargeId === source.chargeId;

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
     * De loader leest ruimer dan de Stripe-scan.
     * Historie buiten deze scan niet stilzwijgend verwijderen.
     */
    if (
      sourceChargeId !== source.chargeId &&
      destinationAccountId !==
        source.transferInspection.destinationAccountId
    ) {
      throw new Error(
        "TRANSFER_HISTORY_OUTSIDE_SCAN_SCOPE_REQUIRES_REVIEW",
      );
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
      storedIdempotencyKey: requiredString(
        request.stripe_idempotency_key,
      ),

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
    completedRequestCount: requestCount,
    historyComparison,
  };
}

/*
 * Bestaande alleen-lezen inspectie.
 *
 * Zelfde publieke functie en returnstructuur als voorheen.
 * Accepteert geen onafgeronde opdrachten.
 *
 * Geen registratie, claim, prepare, synchronisatie of Stripe-write.
 */
export async function inspectSandboxTransferHistory(
  purchaseId: string,
): Promise<SandboxTransferHistoryInspection> {
  purchaseId = requiredUuid(purchaseId);

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

  const checked = validateCompletedHistory(data, source);

  return {
    source,
    databaseRequestCount: checked.completedRequestCount,
    historyComparison: checked.historyComparison,
  };
}

/*
 * Nieuwe claimgebonden inspectie.
 *
 * Alleen aanroepen vanuit een vertrouwde uitvoerder die de claim
 * daadwerkelijk via claim_sandbox_trainer_transfer heeft verkregen.
 *
 * expected komt uit de gecontroleerde opdracht/claim.
 * lockToken komt uit de bevestigde claimresponse.
 * Geen browserpayload rechtstreeks doorgeven.
 *
 * Geen registratie, claim, prepare, synchronisatie of Stripe-write.
 * De RPC neemt wel tijdelijk rijlocks voor de claimcontrole.
 */
export async function inspectClaimedSandboxTransferHistory(input: {
  expected: ExpectedClaim;
  lockToken: string;
}): Promise<ClaimedSandboxTransferHistoryInspection> {
  const expected: ExpectedClaim = {
    requestId: requiredUuid(input.expected.requestId),
    bookingId: requiredUuid(input.expected.bookingId),
    purchaseId: requiredUuid(input.expected.purchaseId),
    trainerId: requiredUuid(input.expected.trainerId),
    destinationAccountId: requiredString(
      input.expected.destinationAccountId,
    ),
    paymentIntentId: requiredString(input.expected.paymentIntentId),
    amountCents: requiredInteger(input.expected.amountCents, 1),
  };

  const lockToken = requiredUuid(input.lockToken);

  if (
    !/^acct_[A-Za-z0-9]+$/.test(expected.destinationAccountId) ||
    !/^pi_[A-Za-z0-9]+$/.test(expected.paymentIntentId)
  ) {
    throw new Error("TRANSFER_HISTORY_CLAIM_INPUT_INVALID");
  }

  /*
   * De helper voert de bestaande bron- en transferscan uit.
   * Refund- en disputeregistraties blijven blokkeren.
   */
  const source = await inspectSandboxPackageTransferSource(
    expected.purchaseId,
  );

  if (
    source.purchaseId !== expected.purchaseId ||
    source.paymentIntentId !== expected.paymentIntentId ||
    source.transferInspection.destinationAccountId !==
      expected.destinationAccountId
  ) {
    throw new Error("TRANSFER_HISTORY_CLAIM_SOURCE_MISMATCH");
  }

  /*
   * Controleer de eigen claim met de databaseklok en het echte token.
   * De RPC haalt de volledige historie op terwijl de relevante
   * claim-/aankoop-/boekingslocks binnen die transactie gehouden worden.
   */
  const { data, error } = await database.rpc(
    "read_claimed_sandbox_transfer_history",
    {
      p_request_id: expected.requestId,
      p_lock_token: lockToken,
      p_source_charge_id: source.chargeId,
    },
  );

  if (error) {
    console.error("Claimgebonden transferhistorie niet bevestigd:", {
      requestId: expected.requestId,
      databaseCode: error.code,
    });

    throw new Error("TRANSFER_HISTORY_CLAIM_LOOKUP_NOT_CONFIRMED");
  }

  const claimedResponse = requiredObject(data);

  /*
   * De separator:
   * - bevestigt precies één eigen onvoorbereide processing-opdracht;
   * - weigert Stripe-transfers die al naar die opdracht/boeking wijzen;
   * - laat alle overige databaserijen intact.
   */
  const separated = separateClaimedTransferHistory({
    claimedResponse,
    expected,
    inspection: source.transferInspection,
  });

  const checked = validateCompletedHistory(
    separated.historyWithoutCurrentClaim,
    source,
  );

  const fullHistory = requiredObject(claimedResponse.history);
  const fullRequestCount = requiredInteger(
    fullHistory.request_count,
    1,
  );

  if (fullRequestCount !== checked.completedRequestCount + 1) {
    throw new Error("TRANSFER_HISTORY_CLAIM_COUNT_MISMATCH");
  }

  const claimCheckedAt = requiredTimestamp(claimedResponse.checked_at);
  const claimLockedUntil = requiredTimestamp(
    claimedResponse.locked_until,
  );

  if (Date.parse(claimLockedUntil) <= Date.parse(claimCheckedAt)) {
    throw new Error("TRANSFER_HISTORY_CLAIM_LEASE_INVALID");
  }

  return {
    source,
    currentRequestId: separated.currentRequestId,
    databaseRequestCount: fullRequestCount,
    completedRequestCount: checked.completedRequestCount,
    claimCheckedAt,
    claimLockedUntil,
    historyComparison: checked.historyComparison,
  };
}