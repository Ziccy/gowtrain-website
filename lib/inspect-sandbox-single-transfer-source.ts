import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  verifySandboxSingleTransferSource,
  type ExpectedSandboxSingleTransferSource,
  type VerifiedSandboxSingleTransferSource,
} from "@/lib/verify-sandbox-single-transfer-source";
import {
  inspectSandboxSourceTransfers,
  type SandboxSourceTransferInspection,
} from "@/lib/inspect-sandbox-source-transfers";

type ExpectedSingleTransferContext = {
  bookingId: string;
  trainerId: string;
  destinationAccountId: string;
  paymentIntentId: string;
  amountCents: number;
};

export type InspectedSandboxSingleTransferSource =
  VerifiedSandboxSingleTransferSource & {
    transferInspection: SandboxSourceTransferInspection;
  };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("TRANSFER_SINGLE_SOURCE_CONFIGURATION_MISSING");
  }

  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

/*
 * Alleen voor vertrouwde backendaanroepers.
 *
 * input komt straks uit de gecontroleerde databaseclaim,
 * nooit rechtstreeks uit een browserbody.
 *
 * Controleert:
 * - broncontext uit de database;
 * - overeenstemming met de verwachte claimidentiteit;
 * - bestaande v2-testkoppeling;
 * - actuele Stripe-betaling, refunds en disputes;
 * - transfers voor de bron en bestemming.
 *
 * De scan is een waarneming, GEEN goedgekeurde historie.
 * Vergelijking met databasehistorie en prepare blijven verplicht.
 *
 * Geen registratie, claim, prepare, synchronisatie of Stripe-write.
 */
export async function inspectSandboxSingleTransferSource(
  input: ExpectedSingleTransferContext,
): Promise<InspectedSandboxSingleTransferSource> {
  if (
    !input ||
    !isUuid(input.bookingId) ||
    !isUuid(input.trainerId) ||
    typeof input.destinationAccountId !== "string" ||
    input.destinationAccountId.length > 255 ||
    !/^acct_[A-Za-z0-9]+$/.test(input.destinationAccountId) ||
    typeof input.paymentIntentId !== "string" ||
    !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId) ||
    !isInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > 2147483647
  ) {
    throw new Error("TRANSFER_SINGLE_INSPECTION_INPUT_INVALID");
  }

  const bookingId = input.bookingId.toLowerCase();
  const trainerId = input.trainerId.toLowerCase();

  const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_TEST_KEY_REQUIRED");
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

  const { data, error } = await database.rpc(
    "read_sandbox_single_transfer_source_context",
    { p_booking_id: bookingId },
  );

  if (error) {
    throw new Error("TRANSFER_SINGLE_SOURCE_DATABASE_NOT_CONFIRMED");
  }

  const context: unknown = data;

  if (
    !isObject(context) ||
    context.source_kind !== "single_lesson" ||
    context.booking_id !== bookingId ||
    context.trainer_id !== trainerId ||
    context.payment_intent_id !== input.paymentIntentId ||
    context.trainer_net_amount_cents !== input.amountCents ||
    context.currency !== "eur" ||
    context.allocation_consistent !== true ||
    context.stripe_verification_required !== true ||
    !isInteger(context.total_amount_cents) ||
    !isInteger(context.commission_rate_bps) ||
    !isInteger(context.commission_amount_cents) ||
    !isInteger(context.trainer_net_amount_cents) ||
    !isTimestamp(context.eligible_at)
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_DATABASE_CONTEXT_INVALID");
  }

  const common = {
    bookingId,
    trainerId,
    paymentIntentId: input.paymentIntentId,
    totalAmountCents: context.total_amount_cents,
    commissionRateBps: context.commission_rate_bps,
    commissionAmountCents: context.commission_amount_cents,
    trainerNetAmountCents: context.trainer_net_amount_cents,
    currency: "eur" as const,
  };

  let expected: ExpectedSandboxSingleTransferSource;

  if (context.payment_channel === "paymentsheet") {
    if (
      !isUuid(context.payment_attempt_id) ||
      context.checkout_session_id !== null ||
      typeof context.stored_charge_id !== "string"
    ) {
      throw new Error("TRANSFER_SINGLE_SOURCE_NATIVE_CONTEXT_INVALID");
    }

    expected = {
      ...common,
      paymentChannel: "paymentsheet",
      paymentAttemptId: context.payment_attempt_id,
      checkoutSessionId: null,
      storedChargeId: context.stored_charge_id,
    };
  } else if (context.payment_channel === "legacy_checkout") {
    if (
      context.payment_attempt_id !== null ||
      typeof context.checkout_session_id !== "string" ||
      (
        context.stored_charge_id !== null &&
        typeof context.stored_charge_id !== "string"
      )
    ) {
      throw new Error("TRANSFER_SINGLE_SOURCE_LEGACY_CONTEXT_INVALID");
    }

    expected = {
      ...common,
      paymentChannel: "legacy_checkout",
      paymentAttemptId: null,
      checkoutSessionId: context.checkout_session_id,
      storedChargeId: context.stored_charge_id,
    };
  } else {
    throw new Error("TRANSFER_SINGLE_SOURCE_CHANNEL_UNSUPPORTED");
  }

  /*
   * De bestemming ligt vast in de verwachte claimcontext.
   * Een inmiddels gewijzigde trainerkoppeling niet overnemen.
   */
  const { data: trainer, error: trainerError } = await database
    .from("trainers")
    .select(`
      id,
      user_id,
      stripe_account_id,
      stripe_account_api,
      stripe_account_livemode,
      stripe_account_closed,
      stripe_transfers_status
    `)
    .eq("id", trainerId)
    .maybeSingle();

  if (
    trainerError ||
    !trainer ||
    !isUuid(trainer.user_id) ||
    trainer.stripe_account_id !== input.destinationAccountId ||
    trainer.stripe_account_api !== "accounts_v2" ||
    trainer.stripe_account_livemode !== false ||
    trainer.stripe_account_closed !== false ||
    trainer.stripe_transfers_status !== "active"
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_DESTINATION_INVALID");
  }

  const { data: attempt, error: attemptError } = await database
    .from("trainer_connect_attempts")
    .select("id, trainer_user_id, stripe_livemode, linked_at")
    .eq("trainer_id", trainerId)
    .eq("stripe_account_id", input.destinationAccountId)
    .eq("account_api", "accounts_v2")
    .eq("status", "linked")
    .maybeSingle();

  if (
    attemptError ||
    !attempt ||
    !isUuid(attempt.id) ||
    attempt.trainer_user_id !== trainer.user_id ||
    attempt.stripe_livemode !== false ||
    !isTimestamp(attempt.linked_at)
  ) {
    throw new Error("TRANSFER_SINGLE_SOURCE_CONNECT_LINK_INVALID");
  }

  const source = await verifySandboxSingleTransferSource(
    stripe,
    expected,
  );

  const transferInspection = await inspectSandboxSourceTransfers(
    stripe,
    {
      sourceChargeId: source.chargeId,
      destinationAccountId: input.destinationAccountId,
    },
  );

  /*
   * Detecteer een gewijzigde bestemming na de Stripe-reads.
   * Dit houdt geen lock vast over netwerkverkeer.
   * Actuele Stripe-Connect-verificatie volgt apart vóór prepare.
   */
  const { data: currentTrainer, error: currentTrainerError } =
    await database
      .from("trainers")
      .select("id")
      .eq("id", trainerId)
      .eq("user_id", trainer.user_id)
      .eq("stripe_account_id", input.destinationAccountId)
      .eq("stripe_account_api", "accounts_v2")
      .eq("stripe_account_livemode", false)
      .eq("stripe_account_closed", false)
      .eq("stripe_transfers_status", "active")
      .maybeSingle();

  if (currentTrainerError || !currentTrainer) {
    throw new Error("TRANSFER_SINGLE_SOURCE_DESTINATION_CHANGED");
  }

  return {
    ...source,
    transferInspection,
  };
}