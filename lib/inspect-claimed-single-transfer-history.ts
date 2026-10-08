import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  inspectSandboxSingleTransferSource,
  type InspectedSandboxSingleTransferSource,
} from "@/lib/inspect-sandbox-single-transfer-source";
import {
  separateClaimedSingleTransferHistory,
  type ExpectedSingleTransferHistoryClaim,
} from "@/lib/separate-claimed-single-transfer-history";
import {
  validateCompletedSingleTransferHistory,
} from "@/lib/validate-completed-single-transfer-history";
import {
  validateCompletedPackageTransferHistory,
} from "@/lib/validate-completed-package-transfer-history";
import {
  compareSandboxTransferHistory,
  type CompletedSandboxTransferHistoryEntry,
  type SandboxTransferHistoryComparison,
} from "@/lib/compare-sandbox-transfer-history";

export type ClaimedSingleTransferHistoryInspection = {
  source: InspectedSandboxSingleTransferSource;
  currentRequestId: string;
  databaseRequestCount: number;
  completedRequestCount: number;
  claimCheckedAt: string;
  claimLockedUntil: string;
  historyComparison: SandboxTransferHistoryComparison;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CONFIGURATION_MISSING");
  }

  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_OBJECT_INVALID");
  }

  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_UUID_INVALID");
  }

  return value.toLowerCase();
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_TIMESTAMP_INVALID");
  }

  return value;
}

/*
 * Alleen vanuit een vertrouwde uitvoerder aanroepen.
 *
 * expected en lockToken komen uit de bevestigde databaseclaim.
 * Geen vrije browserinput of achteraf geconstrueerde claim accepteren.
 *
 * Deze helper:
 * - doet Stripe-reads en databasecontext-/claimcontroles;
 * - maakt geen opdracht, claim of transfer aan;
 * - bereidt geen verzending voor;
 * - synchroniseert geen transferresultaat.
 *
 * De claim-RPC houdt tijdelijk rijlocks binnen zijn transactie.
 * Er blijft geen PostgreSQL-lock over de Stripe-reads heen bestaan.
 * Prepare moet daarom alle noodzakelijke controles opnieuw uitvoeren.
 */
export async function inspectClaimedSingleTransferHistory(input: {
  expected: ExpectedSingleTransferHistoryClaim;
  lockToken: string;
}): Promise<ClaimedSingleTransferHistoryInspection> {
  const expected: ExpectedSingleTransferHistoryClaim = {
    requestId: uuid(input.expected.requestId),
    bookingId: uuid(input.expected.bookingId),
    trainerId: uuid(input.expected.trainerId),
    destinationAccountId: input.expected.destinationAccountId,
    paymentIntentId: input.expected.paymentIntentId,
    amountCents: input.expected.amountCents,
  };

  const lockToken = uuid(input.lockToken);

  if (
    typeof expected.destinationAccountId !== "string" ||
    !/^acct_[A-Za-z0-9]+$/.test(expected.destinationAccountId) ||
    expected.destinationAccountId.length > 255 ||
    typeof expected.paymentIntentId !== "string" ||
    !/^pi_[A-Za-z0-9]+$/.test(expected.paymentIntentId) ||
    !Number.isSafeInteger(expected.amountCents) ||
    expected.amountCents <= 0 ||
    expected.amountCents > 2147483647
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CLAIM_INPUT_INVALID");
  }

  /*
   * Databasebroncontext, actuele Stripe-betaling, refunds,
   * disputes en relevante transfers controleren.
   *
   * Deze scan is nog geen goedgekeurde transferhistorie.
   */
  const source = await inspectSandboxSingleTransferSource({
    bookingId: expected.bookingId,
    trainerId: expected.trainerId,
    destinationAccountId: expected.destinationAccountId,
    paymentIntentId: expected.paymentIntentId,
    amountCents: expected.amountCents,
  });

  if (
    source.sourceKind !== "single_lesson" ||
    source.bookingId !== expected.bookingId ||
    source.trainerId !== expected.trainerId ||
    source.paymentIntentId !== expected.paymentIntentId ||
    source.currency !== "eur" ||
    source.livemode !== false ||
    source.fundsFlow !== "separate_transfers_v1" ||
    source.transferInspection.sourceChargeId !== source.chargeId ||
    source.transferInspection.destinationAccountId !==
      expected.destinationAccountId
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_SOURCE_MISMATCH");
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

  /*
   * Zelf de RPC uitvoeren met het werkelijk verkregen token.
   * Geen aangeleverde claim_verified-response vertrouwen.
   */
  const { data, error } = await database.rpc(
    "read_claimed_sandbox_single_transfer_history",
    {
      p_request_id: expected.requestId,
      p_lock_token: lockToken,
      p_source_charge_id: source.chargeId,
    },
  );

  if (error) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CLAIM_LOOKUP_NOT_CONFIRMED");
  }

  const claimedResponse = object(data);

  const separated = separateClaimedSingleTransferHistory({
    claimedResponse,
    expected,
    inspection: source.transferInspection,
  });

  const history = separated.historyWithoutCurrentClaim;

  /*
   * De claimreader is na de Stripe-reads uitgevoerd.
   * Controleer dat het betaalde totaal nog overeenkomt met
   * de daadwerkelijk geverifieerde Stripe-betaling.
   */
  if (
    history.source_total_amount_cents !== source.amountCents ||
    history.source_trainer_net_amount_cents !== expected.amountCents ||
    !Array.isArray(history.requests) ||
    history.request_count !== history.requests.length
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_SOURCE_AMOUNTS_CHANGED");
  }

  const completedRequests: CompletedSandboxTransferHistoryEntry[] = [];

  for (const value of history.requests) {
    const entry = object(value);
    const request = object(entry.request);

    /*
     * Expliciet null betekent losse les.
     * Een ontbrekend of ongeldig pakket-ID valt niet stilzwijgend
     * terug op die interpretatie: de pakketvalidator weigert dat.
     */
    const completed =
      request.source_package_purchase_id === null
        ? validateCompletedSingleTransferHistory(entry)
        : validateCompletedPackageTransferHistory(entry);

    /*
     * Een losse betaling financiert één lestransfer.
     * Iedere eerdere opdracht met dezelfde PI of charge blokkeert,
     * ongeacht de bronsoort of bestemming van die eerdere opdracht.
     */
    if (
      completed.expected.paymentIntentId === source.paymentIntentId ||
      completed.expected.sourceChargeId === source.chargeId
    ) {
      throw new Error("TRANSFER_SINGLE_HISTORY_SOURCE_ALREADY_USED");
    }

    /*
     * Andere betaalbronnen mogen alleen in deze vergelijking
     * voorkomen als zij binnen de bestemmingsscan vallen.
     *
     * De loader leest bewust ruimer. Historie buiten de scan
     * niet stilzwijgend negeren.
     */
    if (
      completed.expected.destinationAccountId !==
      expected.destinationAccountId
    ) {
      throw new Error("TRANSFER_SINGLE_HISTORY_OUTSIDE_SCAN_SCOPE");
    }

    completedRequests.push(completed);
  }

  /*
   * Volledige vergelijking in beide richtingen.
   * Een extra Stripe-transfer zonder passende databaseopdracht
   * of een ontbrekende Stripe-transfer blokkeert.
   */
  const historyComparison = compareSandboxTransferHistory({
    inspection: source.transferInspection,
    completedRequests,
  });

  if (
    historyComparison.comparisonConfirmed !== true ||
    historyComparison.currentSourceTransferredCents !== 0
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_SOURCE_NOT_UNUSED");
  }

  const fullHistory = object(claimedResponse.history);

  if (
    fullHistory.request_count !== completedRequests.length + 1
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CLAIM_COUNT_MISMATCH");
  }

  const claimCheckedAt = timestamp(claimedResponse.checked_at);
  const claimLockedUntil = timestamp(claimedResponse.locked_until);

  if (
    Date.parse(claimLockedUntil) <= Date.parse(claimCheckedAt) ||
    Date.parse(claimLockedUntil) <= Date.now()
  ) {
    throw new Error("TRANSFER_SINGLE_HISTORY_CLAIM_LEASE_INVALID");
  }

  return {
    source,
    currentRequestId: separated.currentRequestId,
    databaseRequestCount: completedRequests.length + 1,
    completedRequestCount: completedRequests.length,
    claimCheckedAt,
    claimLockedUntil,
    historyComparison,
  };
}