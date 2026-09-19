import "server-only";

import { isDeepStrictEqual } from "node:util";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { inspectSandboxPackageTransferSource } from "@/lib/inspect-sandbox-package-transfer-source";
import { retrieveTrainerConnectV2StatusSnapshot } from "@/lib/stripe-connect-v2-status";
import {
  buildTrainerTransferPayload,
  type TrainerTransferCreateParams,
} from "@/lib/stripe-trainer-transfer-payload";
import { syncSandboxTrainerTransfer } from "@/lib/sync-sandbox-trainer-transfer";

/*
 * Eerste uitvoeringsversie: uitsluitend deze ene echte testles.
 * Geen vrije keuze vanuit browserinput en geen automatische batch.
 */
const ALLOWED_BOOKING_ID = "c413bd74-8c8f-4ba5-8f03-98430c08f905";
const ALLOWED_PURCHASE_ID = "c02e8212-9379-4f3f-8edd-023dea74910a";
const ALLOWED_TRAINER_ID = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";
const ALLOWED_DESTINATION_ID = "acct_1UHJRCBAMjpV6Qwm";
const ALLOWED_AMOUNT_CENTS = 1900;

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

function diagnosticCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    if (error.type === "StripeConnectionError") {
      return "TRANSFER_EXECUTION_STRIPE_CONNECTION_ERROR";
    }

    return "TRANSFER_EXECUTION_STRIPE_REQUEST_ERROR";
  }

  const message = error instanceof Error ? error.message : "";

  if (
    /^(TRANSFER_|TRAINER_TRANSFER_|CONNECT_V2_)[A-Z0-9_]+$/.test(
      message,
    ) &&
    message.length <= 150
  ) {
    return message;
  }

  return "TRANSFER_EXECUTION_NOT_CONFIRMED";
}

export type SandboxTrainerTransferExecutionResult =
  | {
      result: "disabled" | "not_claimed";
      requestId: string;
    }
  | {
      result: "synchronized";
      requestId: string;
      transferId: string;
      applicationResult: "applied" | "already_applied";
    }
  | {
      result: "not_confirmed";
      requestId: string;
      stage: string;
      diagnosticCode: string;
      transferId: string | null;
      reviewRecorded: boolean;
    };

/*
 * Uitsluitend voor een vertrouwde server-side aanroeper.
 * Deze helper verzorgt geen gebruikersautorisatie.
 *
 * Een toekomstige route moet zelf toegang en expliciete
 * uitvoerbevestiging controleren.
 *
 * Geen registratie/backfill.
 * Geen herclaim.
 * Geen automatische retry van transfers.create.
 */
export async function executeSandboxTrainerTransfer(
  requestId: string,
): Promise<SandboxTrainerTransferExecutionResult> {
  if (!isUuid(requestId)) {
    throw new Error("TRANSFER_EXECUTION_REQUEST_ID_INVALID");
  }

  requestId = requestId.toLowerCase();

  /*
   * Standaard uit.
   * Deze variabele nu NIET instellen.
   */
  if (
    process.env.SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED !== "true"
  ) {
    return {
      result: "disabled",
      requestId,
    };
  }

  const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("TRANSFER_EXECUTION_TEST_KEY_REQUIRED");
  }

  const stripe = new Stripe(stripeKey, {
    timeout: 10_000,
    maxNetworkRetries: 0,
  });

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

  let stage = "request_lookup";
  let lockToken: string | null = null;
  let createdTransferId: string | null = null;

  try {
    /*
     * Eerst de scope controleren, voordat er een claim wordt gedaan.
     * De claim-RPC controleert daarna opnieuw onder locks.
     */
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
      request.booking_id !== ALLOWED_BOOKING_ID ||
      request.source_package_purchase_id !== ALLOWED_PURCHASE_ID ||
      request.trainer_id !== ALLOWED_TRAINER_ID ||
      request.destination_account_id !== ALLOWED_DESTINATION_ID ||
      request.amount_cents !== ALLOWED_AMOUNT_CENTS ||
      request.currency !== "eur" ||
      request.stripe_livemode !== false ||
      request.funds_flow !== "separate_transfers_v1"
    ) {
      throw new Error("TRANSFER_EXECUTION_OUTSIDE_TEST_SCOPE");
    }

    stage = "claim";

    const { data: claimData, error: claimError } = await database.rpc(
      "claim_sandbox_trainer_transfer",
      {
        p_request_id: requestId,
        p_lease_seconds: 300,
      },
    );

    if (claimError) {
      /*
       * Claimopslag kan bij een verbindingsprobleem onzeker zijn.
       * Zonder bevestigd token niet zelf proberen te resetten.
       */
      throw new Error("TRANSFER_EXECUTION_CLAIM_NOT_CONFIRMED");
    }

    if (claimData === null) {
      return {
        result: "not_claimed",
        requestId,
      };
    }

    const claim: unknown = claimData;

    if (
      !isObject(claim) ||
      claim.request_id !== requestId ||
      !isUuid(claim.lock_token)
    ) {
      throw new Error("TRANSFER_EXECUTION_CLAIM_INVALID");
    }

    lockToken = claim.lock_token;

    if (
      claim.booking_id !== ALLOWED_BOOKING_ID ||
      claim.source_package_purchase_id !== ALLOWED_PURCHASE_ID ||
      claim.trainer_id !== ALLOWED_TRAINER_ID ||
      claim.destination_account_id !== ALLOWED_DESTINATION_ID ||
      claim.amount_cents !== ALLOWED_AMOUNT_CENTS ||
      claim.currency !== "eur" ||
      claim.stripe_livemode !== false ||
      claim.funds_flow !== "separate_transfers_v1" ||
      claim.attempts !== 1 ||
      typeof claim.stripe_payment_intent_id !== "string" ||
      claim.stripe_idempotency_key !==
        `gowtrain-trainer-transfer/${requestId}`
    ) {
      throw new Error("TRANSFER_EXECUTION_CLAIM_CONTEXT_MISMATCH");
    }

    stage = "inspect_source";

    const source = await inspectSandboxPackageTransferSource(
      ALLOWED_PURCHASE_ID,
    );

    if (
      source.purchaseId !== ALLOWED_PURCHASE_ID ||
      source.paymentIntentId !== claim.stripe_payment_intent_id ||
      source.transferInspection.destinationAccountId !==
        ALLOWED_DESTINATION_ID
    ) {
      throw new Error("TRANSFER_EXECUTION_SOURCE_CONTEXT_MISMATCH");
    }

    stage = "destination_context";

    const { data: attempt, error: attemptError } = await database
      .from("trainer_connect_attempts")
      .select("id, stripe_livemode, stripe_request_payload")
      .eq("trainer_id", ALLOWED_TRAINER_ID)
      .eq("stripe_account_id", ALLOWED_DESTINATION_ID)
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
      accountPayload.metadata.gowtrain_trainer_id !== ALLOWED_TRAINER_ID ||
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
        accountId: ALLOWED_DESTINATION_ID,
        trainerId: ALLOWED_TRAINER_ID,
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
      bookingId: ALLOWED_BOOKING_ID,
      trainerId: ALLOWED_TRAINER_ID,
      packagePurchaseId: ALLOWED_PURCHASE_ID,
      amountCents: ALLOWED_AMOUNT_CENTS,
      currency: "eur",
      destinationAccountId: ALLOWED_DESTINATION_ID,
      sourceChargeId: source.chargeId,
      paymentIntentId: source.paymentIntentId,
      stripeLivemode: false,
      fundsFlow: "separate_transfers_v1",
    });

    stage = "prepare";

    const { data: preparedData, error: prepareError } =
      await database.rpc("prepare_sandbox_trainer_transfer", {
        p_request_id: requestId,
        p_lock_token: lockToken,
        p_source: source,
        p_destination: destination,
        p_payload: built.payload,
      });

    /*
     * Ook bij een timeout na succesvolle opslag NIET zelf
     * de opgeslagen payload teruglezen en alsnog verzenden.
     * Alleen deze bevestigde prepare-response geeft deze
     * uitvoering toestemming om verder te gaan.
     */
    if (prepareError) {
      throw new Error("TRANSFER_EXECUTION_PREPARE_NOT_CONFIRMED");
    }

    const prepared: unknown = preparedData;

    if (
      !isObject(prepared) ||
      prepared.request_id !== requestId ||
      prepared.booking_id !== ALLOWED_BOOKING_ID ||
      prepared.lock_token !== lockToken ||
      prepared.stripe_idempotency_key !== built.idempotencyKey ||
      !isDeepStrictEqual(prepared.stripe_request_payload, built.payload) ||
      typeof prepared.first_stripe_request_at !== "string" ||
      !Number.isFinite(Date.parse(prepared.first_stripe_request_at)) ||
      typeof prepared.locked_until !== "string" ||
      !Number.isFinite(Date.parse(prepared.locked_until))
    ) {
      throw new Error("TRANSFER_EXECUTION_PREPARE_RESPONSE_INVALID");
    }

    stage = "pre_send_check";

    /*
     * Extra controle of de claim ondertussen niet is geblokkeerd.
     * Dit is géén atomair slot tussen PostgreSQL en Stripe.
     */
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
      !current.locked_until ||
      Date.parse(current.locked_until) <= Date.now() + 30_000 ||
      !Number.isFinite(Date.parse(current.locked_until)) ||
      current.stripe_transfer_id !== null ||
      current.stripe_idempotency_key !== built.idempotencyKey ||
      !current.first_stripe_request_at ||
      Date.parse(current.first_stripe_request_at) !==
        Date.parse(prepared.first_stripe_request_at) ||
      !isDeepStrictEqual(current.stripe_request_payload, built.payload)
    ) {
      throw new Error("TRANSFER_EXECUTION_PRE_SEND_CHECK_FAILED");
    }

    stage = "stripe_create";

    /*
     * ENIGE Stripe-write in deze helper.
     *
     * Exact de bevestigde opgeslagen payload gebruiken.
     * SDK-retries staan uit.
     */
    const created = await stripe.transfers.create(
      prepared.stripe_request_payload as TrainerTransferCreateParams,
      {
        idempotencyKey: built.idempotencyKey,
      },
    );

    createdTransferId = created.id;

    stage = "synchronize";

    /*
     * Niet rechtstreeks de create-response op de boeking toepassen.
     * De synchronisatie haalt de transfer opnieuw bij Stripe op.
     */
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
    const code = diagnosticCode(error);
    const stripeError =
      error instanceof Stripe.errors.StripeError ? error : null;

    console.error("Expliciete testtransfer niet bevestigd:", {
      requestId,
      stage,
      diagnosticCode: code,
      transferId: createdTransferId,
      stripeRequestId: stripeError?.requestId,
      stripeStatusCode: stripeError?.statusCode,
    });

    let reviewRecorded = false;

    if (lockToken) {
      try {
        const { data, error: reviewError } = await database.rpc(
          "mark_sandbox_trainer_transfer_for_review",
          {
            p_request_id: requestId,
            p_lock_token: lockToken,
            p_error_code: code,
          },
        );

        reviewRecorded = !reviewError && data === true;

        if (!reviewRecorded) {
          console.warn("Transferblokkering niet bevestigd:", {
            requestId,
            databaseCode: reviewError?.code,
          });
        }
      } catch {
        console.error("Transferblokkering kon niet worden opgeslagen:", {
          requestId,
        });
      }
    }

    /*
     * false bij reviewRecorded kan ook betekenen dat een andere
     * synchronisatie al is afgerond. De actuele opdracht moet
     * worden gecontroleerd; niet opnieuw een transfer aanvragen.
     */
    return {
      result: "not_confirmed",
      requestId,
      stage,
      diagnosticCode: code,
      transferId: createdTransferId,
      reviewRecorded,
    };
  }
}