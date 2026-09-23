import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  runNextSandboxTransferRecoveryCheck,
  type NextSandboxRecoveryResult,
} from "@/lib/run-sandbox-transfer-recovery-check";

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

function requireSandboxStripeKey(): void {
  const key = requiredEnv("STRIPE_SECRET_KEY");

  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("TRANSFER_RECOVERY_TEST_KEY_REQUIRED");
  }
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

export type SandboxTransferRecoveryWorkerResult =
  | NextSandboxRecoveryResult
  | {
      result: "timeout_processed";
      requestId: string;
      checkId: string;
    };

/*
 * Eén begrensde workerstap.
 *
 * Alleen voor vertrouwde server-side aanroepers.
 * De toekomstige route moet authenticatie en een afzonderlijke
 * herstelworker-inschakeling controleren vóór deze aanroep.
 *
 * Eerst maximaal één timeout afhandelen.
 * Alleen bij NULL daarna maximaal één herstelonderzoek uitvoeren.
 *
 * Geen transfers.create, prepare, reset of herverzending.
 * Geen lus of automatische retry binnen deze aanroep.
 */
export async function runSandboxTransferRecoveryWorker():
  Promise<SandboxTransferRecoveryWorkerResult> {
  // Ook de timeoutregistratie alleen via dit sandboxworkerpad.
  requireSandboxStripeKey();

  let expired: unknown;

  try {
    const { data, error } = await database.rpc(
      "expire_next_sandbox_transfer_recovery_check",
    );

    if (error) {
      console.error("Timeoutafhandeling transferonderzoek niet bevestigd:", {
        databaseCode: error.code,
      });

      throw new Error("TRANSFER_RECOVERY_TIMEOUT_NOT_CONFIRMED");
    }

    expired = data;
  } catch {
    /*
     * Timeoutregistratie en planning kunnen al gecommit zijn.
     * Niet herhalen en niet doorgaan naar een nieuwe selectie.
     */
    throw new Error("TRANSFER_RECOVERY_TIMEOUT_NOT_CONFIRMED");
  }

  if (expired === null) {
    /*
     * Geen timeout afgehandeld door deze aanroep.
     * Een gelockt onderzoek kan zijn overgeslagen.
     *
     * De startselector controleert zelf de opdrachtlease,
     * planning en afwezigheid van een running onderzoek.
     */
    return runNextSandboxTransferRecoveryCheck();
  }

  if (
    !isObject(expired) ||
    expired.result !== "expired" ||
    !isUuid(expired.request_id) ||
    !isUuid(expired.check_id)
  ) {
    throw new Error("TRANSFER_RECOVERY_TIMEOUT_RESPONSE_INVALID");
  }

  /*
   * Na een timeout geen nieuw onderzoek in dezelfde workerstap.
   * Een timeout annuleert geen eerdere Stripe-read of synchronisatie.
   */
  return {
    result: "timeout_processed",
    requestId: expired.request_id.toLowerCase(),
    checkId: expired.check_id.toLowerCase(),
  };
}