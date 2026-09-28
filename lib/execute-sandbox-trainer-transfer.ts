import "server-only";

import { isDeepStrictEqual } from "node:util";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { inspectClaimedSandboxTransferHistory } from "@/lib/inspect-sandbox-transfer-history";
import { retrieveTrainerConnectV2StatusSnapshot } from "@/lib/stripe-connect-v2-status";
import {
  buildTrainerTransferPayload,
  type TrainerTransferCreateParams,
} from "@/lib/stripe-trainer-transfer-payload";
import { syncSandboxTrainerTransfer } from "@/lib/sync-sandbox-trainer-transfer";

/*
 * Handmatige ingang blijft vastgezet op de reeds uitgevoerde tweede les.
 * Geen verbreding van de bestaande adminroute.
 */
const MANUAL_BOOKING_ID = "1be93a44-2570-475c-a061-ea574b638258";
const MANUAL_PURCHASE_ID = "0ceb3427-c520-4351-9cb4-e2fb9ea08069";
const MANUAL_AMOUNT_CENTS = 1900;

/*
 * Uitsluitend de vaste handmatige testscope.
 *
 * Automatische uitvoering gebruikt trainer en bestemming uit
 * de bevestigde databaseclaim. De bestaande historie-, Connect-,
 * prepare- en synchronisatiecontroles blijven verplicht.
 */
const ALLOWED_TRAINER_ID = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";
const ALLOWED_DESTINATION_ID = "acct_1UHJRCBAMjpV6Qwm";

type ExecutionMode = "manual" | "automatic";

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
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function executionEnabled(mode: ExecutionMode): boolean {
  if (
    process.env.SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED !== "true"
  ) {
    return false;
  }

  return (
    mode === "manual" ||
    process.env.SANDBOX_TRAINER_TRANSFER_AUTOMATIC_ENABLED === "true"
  );
}

function createDependencies() {
  const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("TRANSFER_EXECUTION_TEST_KEY_REQUIRED");
  }

  return {
    stripe: new Stripe(stripeKey, {
      timeout: 10_000,
      maxNetworkRetries: 0,
    }),
    database: createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    ),
  };
}

type Dependencies = ReturnType<typeof createDependencies>;

function diagnosticCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return error.type === "StripeConnectionError"
      ? "TRANSFER_EXECUTION_STRIPE_CONNECTION_ERROR"
      : "TRANSFER_EXECUTION_STRIPE_REQUEST_ERROR";
  }

  const message = error instanceof Error ? error.message : "";

  if (
    /^(TRANSFER_|TRAINER_TRANSFER_|CONNECT_V2_)[A-Z0-9_]+$/.test(message) &&
    message.length <= 150
  ) {
    return message;
  }

  return "TRANSFER_EXECUTION_NOT_CONFIRMED";
}

type SynchronizedResult = {
  result: "synchronized";
  requestId: string;
  transferId: string;
  applicationResult: "applied" | "already_applied";
};

type FailureResult<T extends string | null> = {
  result: "not_confirmed";
  requestId: T;
  stage: string;
  diagnosticCode: string;
  transferId: string | null;
  reviewRecorded: boolean;
};

export type SandboxTrainerTransferExecutionResult =
  | {
      result: "disabled" | "not_claimed";
      requestId: string;
    }
  | SynchronizedResult
  | FailureResult<string>;

export type AutomaticSandboxTrainerTransferExecutionResult =
  | { result: "disabled" }
  | {
      result: "not_claimed";
      considered: number;
      deferred: number;
      busy: number;
    }
  | SynchronizedResult
  | FailureResult<string | null>;

type ExecutionClaim = {
  request_id: string;
  booking_id: string;
  source_package_purchase_id: string;
  trainer_id: string;
  destination_account_id: string;
  amount_cents: number;
  currency: "eur";
  stripe_payment_intent_id: string;
  stripe_livemode: false;
  funds_flow: "separate_transfers_v1";
  stripe_idempotency_key: string;
  lock_token: string;
  locked_until: string;
  attempts: 1;
};

function isClaim(value: unknown): value is ExecutionClaim {
  if (!isObject(value)) return false;

  return (
    isUuid(value.request_id) &&
    isUuid(value.booking_id) &&
    isUuid(value.source_package_purchase_id) &&
    isUuid(value.trainer_id) &&
    typeof value.destination_account_id === "string" &&
    /^acct_[A-Za-z0-9]+$/.test(value.destination_account_id) &&
    value.destination_account_id.length <= 255 &&
    typeof value.amount_cents === "number" &&
    Number.isSafeInteger(value.amount_cents) &&
    value.amount_cents > 0 &&
    value.currency === "eur" &&
    typeof value.stripe_payment_intent_id === "string" &&
    /^pi_[A-Za-z0-9]+$/.test(value.stripe_payment_intent_id) &&
    value.stripe_livemode === false &&
    value.funds_flow === "separate_transfers_v1" &&
    value.stripe_idempotency_key ===
      `gowtrain-trainer-transfer/${value.request_id}` &&
    isUuid(value.lock_token) &&
    isTimestamp(value.locked_until) &&
    value.attempts === 1
  );
}

async function failure<T extends string | null>(
  dependencies: Dependencies,
  input: {
    requestId: T;
    lockToken: string | null;
    stage: string;
    transferId: string | null;
    error: unknown;
  },
): Promise<FailureResult<T>> {
  const code = diagnosticCode(input.error);

  console.error("Sandboxtransfer niet bevestigd:", {
    requestId: input.requestId,
    stage: input.stage,
    diagnosticCode: code,
    transferId: input.transferId,
  });

  let reviewRecorded = false;

  if (input.requestId && input.lockToken) {
    try {
      const { data, error } = await dependencies.database.rpc(
        "mark_sandbox_trainer_transfer_for_review",
        {
          p_request_id: input.requestId,
          p_lock_token: input.lockToken,
          p_error_code: code,
        },
      );

      reviewRecorded = !error && data === true;

      if (!reviewRecorded) {
        console.warn("Transferblokkering niet bevestigd:", {
          requestId: input.requestId,
          databaseCode: error?.code,
        });
      }
    } catch {
      console.error("Verbinding bij transferblokkering onderbroken:", {
        requestId: input.requestId,
      });
    }
  }

  /*
   * Een false kan ook betekenen dat synchronisatie al is afgerond.
   * Geen reset, herclaim of automatische herverzending.
   */
  return {
    result: "not_confirmed",
    requestId: input.requestId,
    stage: input.stage,
    diagnosticCode: code,
    transferId: input.transferId,
    reviewRecorded,
  };
}

/*
 * Intern: uitsluitend aangeroepen met een bevestigde claimresponse
 * uit een van de twee publieke ingangen hieronder.
 *
 * Niet exporteren. Geen tweede claim en geen browserclaim accepteren.
 */
async function executeClaimedTransfer(
  dependencies: Dependencies,
  requestId: string,
  rawClaim: unknown,
  mode: ExecutionMode,
): Promise<SynchronizedResult | FailureResult<string>> {
  const { stripe, database } = dependencies;

  let stage = "claim_validation";
  let lockToken: string | null = null;
  let createdTransferId: string | null = null;

  try {
    /*
     * Token pas gebruiken voor foutregistratie als de response
     * aantoonbaar bij deze request-ID hoort.
     */
    if (
      !isObject(rawClaim) ||
      rawClaim.request_id !== requestId ||
      !isUuid(rawClaim.lock_token)
    ) {
      throw new Error("TRANSFER_EXECUTION_CLAIM_INVALID");
    }

    lockToken = rawClaim.lock_token;

    if (!isClaim(rawClaim)) {
      throw new Error("TRANSFER_EXECUTION_CLAIM_CONTEXT_MISMATCH");
    }

    const claim = rawClaim;

    /*
     * Alleen het automatische pad gebruikt meerdere trainers
     * en bestemmingen. De handmatige ingang blijft exact begrensd,
     * ook na ontvangst van de claimresponse.
     */
    if (
      mode === "manual" &&
      (
        claim.booking_id !== MANUAL_BOOKING_ID ||
        claim.source_package_purchase_id !== MANUAL_PURCHASE_ID ||
        claim.trainer_id !== ALLOWED_TRAINER_ID ||
        claim.destination_account_id !== ALLOWED_DESTINATION_ID ||
        claim.amount_cents !== MANUAL_AMOUNT_CENTS
      )
    ) {
      throw new Error("TRANSFER_EXECUTION_OUTSIDE_TEST_SCOPE");
    }

    if (Date.parse(claim.locked_until) <= Date.now() + 30_000) {
      throw new Error("TRANSFER_EXECUTION_CLAIM_LEASE_INVALID");
    }

    if (!executionEnabled(mode)) {
      throw new Error("TRANSFER_EXECUTION_DISABLED_AFTER_CLAIM");
    }

    stage = "inspect_claimed_history";

    const history = await inspectClaimedSandboxTransferHistory({
      expected: {
        requestId,
        bookingId: claim.booking_id,
        purchaseId: claim.source_package_purchase_id,
        trainerId: claim.trainer_id,
        destinationAccountId: claim.destination_account_id,
        paymentIntentId: claim.stripe_payment_intent_id,
        amountCents: claim.amount_cents,
      },
      lockToken,
    });

    const source = history.source;

    if (
      history.currentRequestId !== requestId ||
      history.historyComparison.comparisonConfirmed !== true ||
      history.databaseRequestCount !== history.completedRequestCount + 1 ||
      source.purchaseId !== claim.source_package_purchase_id ||
      source.paymentIntentId !== claim.stripe_payment_intent_id ||
      source.transferInspection.destinationAccountId !==
        claim.destination_account_id
    ) {
      throw new Error("TRANSFER_EXECUTION_SOURCE_CONTEXT_MISMATCH");
    }

    console.log("Transferhistorie vóór prepare gecontroleerd:", {
      requestId,
      completedRequestCount: history.completedRequestCount,
      sourceTransferredCents:
        history.historyComparison.currentSourceTransferredCents,
      destinationTransferredCents:
        history.historyComparison.currentDestinationTransferredCents,
    });

    stage = "destination_context";

    const { data: attempt, error: attemptError } = await database
      .from("trainer_connect_attempts")
      .select("id, stripe_livemode, stripe_request_payload")
      .eq("trainer_id", claim.trainer_id)
      .eq("stripe_account_id", claim.destination_account_id)
      .eq("account_api", "accounts_v2")
      .eq("status", "linked")
      .maybeSingle();

    if (
      attemptError ||
      !attempt ||
      !isUuid(attempt.id) ||
      attempt.stripe_livemode !== false
    ) {
      throw new Error("TRANSFER_EXECUTION_CONNECT_ATTEMPT_INVALID");
    }

    const accountPayload: unknown = attempt.stripe_request_payload;

    if (
      !isObject(accountPayload) ||
      !isObject(accountPayload.identity) ||
      !isObject(accountPayload.metadata) ||
      accountPayload.metadata.gowtrain_trainer_id !== claim.trainer_id ||
      accountPayload.metadata.gowtrain_connect_attempt_id !== attempt.id
    ) {
      throw new Error("TRANSFER_EXECUTION_CONNECT_PAYLOAD_INVALID");
    }

    const country = accountPayload.identity.country;

    if (country !== "NL" && country !== "BE") {
      throw new Error("TRANSFER_EXECUTION_CONNECT_COUNTRY_INVALID");
    }

    stage = "verify_destination";

    const destination = await retrieveTrainerConnectV2StatusSnapshot(
      stripe,
      {
        accountId: claim.destination_account_id,
        trainerId: claim.trainer_id,
        attemptId: attempt.id,
        country,
      },
    );

    if (
      destination.closed ||
      destination.transfersStatus !== "active" ||
      destination.reviewReasons.length > 0
    ) {
      throw new Error("TRANSFER_EXECUTION_DESTINATION_REQUIRES_REVIEW");
    }

    const built = buildTrainerTransferPayload({
      requestId,
      bookingId: claim.booking_id,
      trainerId: claim.trainer_id,
      packagePurchaseId: claim.source_package_purchase_id,
      amountCents: claim.amount_cents,
      currency: "eur",
      destinationAccountId: claim.destination_account_id,
      sourceChargeId: source.chargeId,
      paymentIntentId: source.paymentIntentId,
      stripeLivemode: false,
      fundsFlow: "separate_transfers_v1",
    });

    stage = "prepare";

    if (!executionEnabled(mode)) {
      throw new Error("TRANSFER_EXECUTION_DISABLED_AFTER_CLAIM");
    }

    const { data: preparedData, error: prepareError } = await database.rpc(
      "prepare_sandbox_trainer_transfer",
      {
        p_request_id: requestId,
        p_lock_token: lockToken,
        p_source: source,
        p_destination: destination,
        p_payload: built.payload,
      },
    );

    /*
     * Bij onzekere prepare-response nooit de opgeslagen payload
     * teruglezen om alsnog te verzenden.
     */
    if (prepareError) {
      throw new Error("TRANSFER_EXECUTION_PREPARE_NOT_CONFIRMED");
    }

    const prepared: unknown = preparedData;

    if (
      !isObject(prepared) ||
      prepared.request_id !== requestId ||
      prepared.booking_id !== claim.booking_id ||
      prepared.lock_token !== lockToken ||
      prepared.stripe_idempotency_key !== built.idempotencyKey ||
      !isDeepStrictEqual(prepared.stripe_request_payload, built.payload) ||
      !isTimestamp(prepared.first_stripe_request_at) ||
      !isTimestamp(prepared.locked_until)
    ) {
      throw new Error("TRANSFER_EXECUTION_PREPARE_RESPONSE_INVALID");
    }

    stage = "pre_send_check";

    const { data: current, error: currentError } = await database
      .from("trainer_transfer_requests")
      .select(`
        status,
        lock_token,
        locked_until,
        stripe_request_payload,
        stripe_idempotency_key,
        first_stripe_request_at,
        stripe_transfer_id
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (
      currentError ||
      !current ||
      current.status !== "processing" ||
      current.lock_token !== lockToken ||
      !isTimestamp(current.locked_until) ||
      Date.parse(current.locked_until) <= Date.now() + 30_000 ||
      current.stripe_transfer_id !== null ||
      current.stripe_idempotency_key !== built.idempotencyKey ||
      !isTimestamp(current.first_stripe_request_at) ||
      Date.parse(current.first_stripe_request_at) !==
        Date.parse(prepared.first_stripe_request_at) ||
      !isDeepStrictEqual(current.stripe_request_payload, built.payload)
    ) {
      throw new Error("TRANSFER_EXECUTION_PRE_SEND_CHECK_FAILED");
    }

    if (!executionEnabled(mode)) {
      throw new Error("TRANSFER_EXECUTION_DISABLED_AFTER_PREPARATION");
    }

    stage = "stripe_create";

    /*
     * Enige Stripe-write in deze module.
     * Eén bevestigde prepare-response, één aanroep, geen SDK-retry.
     * Geen atomair slot tussen PostgreSQL en Stripe.
     */
    const created = await stripe.transfers.create(
      prepared.stripe_request_payload as TrainerTransferCreateParams,
      { idempotencyKey: built.idempotencyKey },
    );

    if (
      typeof created.id !== "string" ||
      !/^tr_[A-Za-z0-9]+$/.test(created.id)
    ) {
      throw new Error("TRANSFER_EXECUTION_CREATE_RESPONSE_INVALID");
    }

    createdTransferId = created.id;
    stage = "synchronize";

    const synchronization = await syncSandboxTrainerTransfer(
      requestId,
      created.id,
    );

    return {
      result: "synchronized",
      requestId,
      transferId: synchronization.transferId,
      applicationResult: synchronization.result,
    };
  } catch (error: unknown) {
    return failure(dependencies, {
      requestId,
      lockToken,
      stage,
      transferId: createdTransferId,
      error,
    });
  }
}

/*
 * Bestaande handmatige ingang.
 * Publiek contract en vaste boekingsscope behouden.
 * Autorisatie blijft de verantwoordelijkheid van de adminroute.
 */
export async function executeSandboxTrainerTransfer(
  requestId: string,
): Promise<SandboxTrainerTransferExecutionResult> {
  if (!isUuid(requestId)) {
    throw new Error("TRANSFER_EXECUTION_REQUEST_ID_INVALID");
  }

  requestId = requestId.toLowerCase();

  if (!executionEnabled("manual")) {
    return { result: "disabled", requestId };
  }

  const dependencies = createDependencies();
  const { database } = dependencies;
  let stage = "request_lookup";

  try {
    const { data: request, error: lookupError } = await database
      .from("trainer_transfer_requests")
      .select(`
        id,
        booking_id,
        trainer_id,
        source_package_purchase_id,
        amount_cents,
        currency,
        destination_account_id,
        stripe_livemode,
        funds_flow
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (lookupError || !request) {
      throw new Error("TRANSFER_EXECUTION_REQUEST_LOOKUP_FAILED");
    }

    if (
      request.id !== requestId ||
      request.booking_id !== MANUAL_BOOKING_ID ||
      request.source_package_purchase_id !== MANUAL_PURCHASE_ID ||
      request.trainer_id !== ALLOWED_TRAINER_ID ||
      request.destination_account_id !== ALLOWED_DESTINATION_ID ||
      request.amount_cents !== MANUAL_AMOUNT_CENTS ||
      request.currency !== "eur" ||
      request.stripe_livemode !== false ||
      request.funds_flow !== "separate_transfers_v1"
    ) {
      throw new Error("TRANSFER_EXECUTION_OUTSIDE_TEST_SCOPE");
    }

    stage = "claim";

    const { data, error } = await database.rpc(
      "claim_sandbox_trainer_transfer",
      {
        p_request_id: requestId,
        p_lease_seconds: 300,
      },
    );

    if (error) {
      throw new Error("TRANSFER_EXECUTION_CLAIM_NOT_CONFIRMED");
    }

    if (data === null) {
      return { result: "not_claimed", requestId };
    }

    return await executeClaimedTransfer(
      dependencies,
      requestId,
      data,
      "manual",
    );
  } catch (error: unknown) {
    /*
     * Geen bevestigd claimtoken beschikbaar in deze tak.
     * Een onzekere claim kan al opgeslagen zijn: niet opnieuw claimen.
     */
    return failure(dependencies, {
      requestId,
      lockToken: null,
      stage,
      transferId: null,
      error,
    });
  }
}

/*
 * Nieuwe automatische ingang: geen request-ID of token als invoer.
 * Alleen de bevestigde selectie-/claimresponse wordt uitgevoerd.
 *
 * De toekomstige route moet zelf cron-authenticatie afdwingen.
 */
export async function executeNextSandboxTrainerTransfer():
  Promise<AutomaticSandboxTrainerTransferExecutionResult> {
  if (!executionEnabled("automatic")) {
    return { result: "disabled" };
  }

  const dependencies = createDependencies();

  try {
    const { data, error } = await dependencies.database.rpc(
      "claim_next_sandbox_trainer_transfer",
    );

    if (error) {
      console.error("Automatische transferselectie niet bevestigd:", {
        databaseCode: error.code,
      });

      throw new Error("TRANSFER_AUTO_SELECTION_NOT_CONFIRMED");
    }

    if (
      !isObject(data) ||
      !isCount(data.considered) ||
      data.considered > 10 ||
      !isCount(data.deferred) ||
      !isCount(data.busy)
    ) {
      throw new Error("TRANSFER_AUTO_SELECTION_RESPONSE_INVALID");
    }

    if (data.result === "not_claimed") {
      return {
        result: "not_claimed",
        considered: data.considered,
        deferred: data.deferred,
        busy: data.busy,
      };
    }

    if (
      data.result !== "claimed" ||
      data.considered < 1 ||
      !isObject(data.claim) ||
      !isUuid(data.claim.request_id)
    ) {
      throw new Error("TRANSFER_AUTO_SELECTION_RESPONSE_INVALID");
    }

    /*
     * Niet executeSandboxTrainerTransfer aanroepen:
     * die zou opnieuw claimen en gebruikt de handmatige scope.
     */
    return await executeClaimedTransfer(
      dependencies,
      data.claim.request_id,
      data.claim,
      "automatic",
    );
  } catch (error: unknown) {
    /*
     * Bij een onzekere selectie kan de registratie/claim al
     * gecommit zijn. Geen tweede selectie of reset.
     * Zonder betrouwbare claimcontext geen opdracht aanpassen.
     */
    return failure(dependencies, {
      requestId: null,
      lockToken: null,
      stage: "automatic_selection",
      transferId: null,
      error,
    });
  }
}