import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  verifySandboxPackageTransferSource,
  type ExpectedSandboxPackageTransferSource,
  type VerifiedSandboxPackageTransferSource,
} from "@/lib/verify-sandbox-package-transfer-source";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
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

/*
 * Alleen voor vertrouwde backendaanroepers.
 *
 * Geen publieke route of gebruikersautorisatie in deze helper.
 * Een toekomstige route moet zelf toegang controleren.
 *
 * Leest de oorspronkelijke databasecontext en controleert
 * daarna Checkout, Payment Intent, charge, refunds en disputes.
 *
 * Geen databasewrites.
 * Geen accountkoppeling wijzigen.
 * Geen registratie, claim, prepare of Stripe-transfer.
 */
export async function inspectSandboxPackageTransferSource(
  purchaseId: string,
): Promise<VerifiedSandboxPackageTransferSource> {
  if (!isUuid(purchaseId)) {
    throw new Error("TRANSFER_SOURCE_PURCHASE_ID_INVALID");
  }

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("TRANSFER_SOURCE_TEST_KEY_REQUIRED");
  }

  const { data, error } = await supabaseAdmin.rpc(
    "read_sandbox_package_transfer_source_context",
    {
      p_purchase_id: purchaseId,
    },
  );

  if (error) {
    console.error("Pakketbroncontext niet bevestigd:", {
      purchaseId,
      databaseCode: error.code,
      message: error.message,
    });

    throw new Error("TRANSFER_SOURCE_DATABASE_CONTEXT_NOT_CONFIRMED");
  }

  const context: unknown = data;

  if (
    !isObject(context) ||
    context.purchase_id !== purchaseId ||
    context.allocation_verified !== true ||
    context.stripe_livemode !== false ||
    context.funds_flow !== "separate_transfers_v1" ||
    context.currency !== "eur" ||
    !isUuid(context.checkout_attempt_id) ||
    !isUuid(context.package_id) ||
    !isUuid(context.player_id) ||
    !isUuid(context.trainer_id) ||
    typeof context.checkout_session_id !== "string" ||
    !context.checkout_session_id.startsWith("cs_test_") ||
    typeof context.payment_intent_id !== "string" ||
    !context.payment_intent_id.startsWith("pi_") ||
    typeof context.total_amount_cents !== "number" ||
    !Number.isSafeInteger(context.total_amount_cents) ||
    context.total_amount_cents <= 0 ||
    typeof context.lesson_count !== "number" ||
    !Number.isSafeInteger(context.lesson_count) ||
    context.lesson_count <= 0
  ) {
    throw new Error("TRANSFER_SOURCE_DATABASE_CONTEXT_INVALID");
  }

  const expected: ExpectedSandboxPackageTransferSource = {
    purchaseId,
    checkoutAttemptId: context.checkout_attempt_id,
    packageId: context.package_id,
    playerId: context.player_id,
    trainerId: context.trainer_id,
    checkoutSessionId: context.checkout_session_id,
    paymentIntentId: context.payment_intent_id,
    totalAmountCents: context.total_amount_cents,
    currency: "eur",
  };

  return await verifySandboxPackageTransferSource(stripe, expected);
}