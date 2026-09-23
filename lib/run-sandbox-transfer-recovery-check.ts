import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  reconcileSandboxTrainerTransfer,
  type SandboxTrainerTransferRecoveryResult,
} from "@/lib/reconcile-sandbox-trainer-transfer";

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
  const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    throw new Error("TRANSFER_RECOVERY_TEST_KEY_REQUIRED");
  }
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  /*
   * Alleen eigen diagnostische codes bewaren.
   * Geen vrije Stripe-foutteksten, persoonsgegevens of secrets.
   */
  if (
    /^(TRANSFER_|TRAINER_TRANSFER_)[A-Z0-9_]+$/.test(message) &&
    message.length <= 150
  ) {
    return message;
  }

  return "TRANSFER_RECOVERY_CHECK_FAILED";
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

type RecoveryOutcome =
  | "applied"
  | "already_applied"
  | "not_found_requires_review"
  | "unprepared_requires_review"
  | "lease_still_active"
  | "not_recovery_candidate";

type StartedSandboxRecoveryResult =
  | {
      result: "recorded";
      requestId: string;
      checkId: string;
      recovery: SandboxTrainerTransferRecoveryResult;
    }
  | {
      result: "investigation_failed";
      requestId: string;
      checkId: string;
      diagnosticCode: string;
      failureRecorded: boolean;
    }
  | {
      result: "completion_not_confirmed";
      requestId: string;
      checkId: string;
      recovery: SandboxTrainerTransferRecoveryResult;
    };

export type RecordedSandboxRecoveryResult =
  | {
      result: "not_started";
      requestId: string;
    }
  | StartedSandboxRecoveryResult;

export type NextSandboxRecoveryResult =
  | {
      result: "not_started";
    }
  | StartedSandboxRecoveryResult;

async function finishCheck(input: {
  checkId: string;
  outcome: RecoveryOutcome | null;
  transferId: string | null;
  errorCode: string | null;
}): Promise<boolean> {
  try {
    /*
     * Onderzoeksafsluiting en eventuele vervolgplanning worden
     * binnen één databasetransactie vastgelegd.
     *
     * Een late afsluiting geeft false en wijzigt geen planning.
     * Een volledig toegepaste opdracht blijft ongewijzigd.
     */
    const { data, error } = await database.rpc(
      "finish_and_schedule_sandbox_transfer_recovery_check",
      {
        p_check_id: input.checkId,
        p_outcome: input.outcome,
        p_transfer_id: input.transferId,
        p_error_code: input.errorCode,
      },
    );

    if (error || data !== true) {
      console.error("Afsluiting transferonderzoek niet bevestigd:", {
        checkId: input.checkId,
        databaseCode: error?.code,
        outcome: input.outcome,
      });

      return false;
    }

    return true;
  } catch {
    console.error("Verbinding bij afsluiten transferonderzoek onderbroken:", {
      checkId: input.checkId,
    });

    return false;
  }
}

/*
 * Alleen intern aanroepen met de bevestigde response van een
 * start-RPC uit deze module. Niet exporteren naar routes.
 *
 * Geen tweede start, uitvoeringsclaim, prepare of transfers.create.
 *
 * Een onderzoekstimeout trekt een eventueel nog lopende Stripe-read
 * of synchronisatie niet in. De afsluit-RPC weigert late afsluitingen.
 */
async function runStartedRecoveryCheck(
  requestId: string,
  checkId: string,
): Promise<StartedSandboxRecoveryResult> {
  let recovery: SandboxTrainerTransferRecoveryResult;

  try {
    recovery = await reconcileSandboxTrainerTransfer(requestId);
  } catch (error: unknown) {
    const code = diagnosticCode(error);

    console.error("Geregistreerd transferonderzoek mislukt:", {
      requestId,
      checkId,
      diagnosticCode: code,
    });

    const failureRecorded = await finishCheck({
      checkId,
      outcome: null,
      transferId: null,
      errorCode: code,
    });

    return {
      result: "investigation_failed",
      requestId,
      checkId,
      diagnosticCode: code,
      failureRecorded,
    };
  }

  let outcome: RecoveryOutcome;
  let transferId: string | null = null;

  switch (recovery.result) {
    case "synchronized":
      outcome = recovery.synchronization.result;
      transferId = recovery.synchronization.transferId;
      break;

    case "not_found_requires_review":
    case "unprepared_requires_review":
    case "lease_still_active":
    case "not_recovery_candidate":
      outcome = recovery.result;
      break;
  }

  /*
   * Het onderzoeksresultaat kan inmiddels financieel zijn toegepast.
   * Een fout bij deze afsluiting betekent dus NIET dat de
   * transfer of de synchronisatie is mislukt.
   */
  const completionRecorded = await finishCheck({
    checkId,
    outcome,
    transferId,
    errorCode: null,
  });

  if (!completionRecorded) {
    return {
      result: "completion_not_confirmed",
      requestId,
      checkId,
      recovery,
    };
  }

  return {
    result: "recorded",
    requestId,
    checkId,
    recovery,
  };
}

/*
 * Expliciete controle van precies één bestaande opdracht.
 *
 * Alleen voor vertrouwde server-side aanroepers.
 * Een route moet zelf authenticatie en autorisatie uitvoeren.
 *
 * Deze startfunctie controleert niet of de herstelplanning
 * verschuldigd is. Gebruik voor periodieke selectie uitsluitend
 * runNextSandboxTransferRecoveryCheck.
 */
export async function runSandboxTransferRecoveryCheck(
  requestId: string,
): Promise<RecordedSandboxRecoveryResult> {
  if (!isUuid(requestId)) {
    throw new Error("TRANSFER_RECOVERY_REQUEST_ID_INVALID");
  }

  requestId = requestId.toLowerCase();

  // Testmode controleren vóór het aanmaken van een running-rij.
  requireSandboxStripeKey();

  let started: unknown;

  try {
    const { data, error } = await database.rpc(
      "start_sandbox_transfer_recovery_check",
      {
        p_request_id: requestId,
      },
    );

    if (error) {
      console.error("Startregistratie transferonderzoek niet bevestigd:", {
        requestId,
        databaseCode: error.code,
      });

      throw new Error("TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED");
    }

    started = data;
  } catch {
    /*
     * Ook bij een verbroken verbinding kan de running-rij al bestaan.
     * Geen tweede start en geen onderzoek buiten de registratie om.
     */
    throw new Error("TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED");
  }

  if (started === null) {
    return {
      result: "not_started",
      requestId,
    };
  }

  if (!isUuid(started)) {
    throw new Error("TRANSFER_RECOVERY_CHECK_START_RESPONSE_INVALID");
  }

  return runStartedRecoveryCheck(
    requestId,
    started.toLowerCase(),
  );
}

/*
 * Eén periodieke herstelcontrole.
 *
 * Alleen voor vertrouwde server-side aanroepers.
 * De toekomstige workerroute moet toegang en inschakeling controleren.
 *
 * SQL selecteert en start maximaal één verschuldigd onderzoek
 * binnen dezelfde transactie, met de databaseklok en opdrachtlock.
 *
 * Geen automatische herhaling binnen deze aanroep.
 * Geen transferregistratie, uitvoeringsclaim, prepare of herverzending.
 * Timeoutafhandeling wordt afzonderlijk aangesloten.
 */
export async function runNextSandboxTransferRecoveryCheck():
  Promise<NextSandboxRecoveryResult> {
  // Ook zonder kandidaten alleen in sandbox beschikbaar.
  requireSandboxStripeKey();

  let started: unknown;

  try {
    const { data, error } = await database.rpc(
      "start_next_sandbox_transfer_recovery_check",
    );

    if (error) {
      console.error("Periodieke onderzoeksstart niet bevestigd:", {
        databaseCode: error.code,
      });

      throw new Error("TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED");
    }

    started = data;
  } catch {
    /*
     * De selectie/start kan al gecommit zijn.
     * Niet opnieuw selecteren en geen onbekend onderzoek overnemen.
     * Een achtergebleven running-rij vereist timeoutafhandeling.
     */
    throw new Error("TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED");
  }

  if (started === null) {
    /*
     * Geen kandidaat beschikbaar voor deze aanroep.
     * Dit bewijst niet dat er nergens herstel nodig is:
     * een opdracht kan bijvoorbeeld gelockt zijn.
     */
    return {
      result: "not_started",
    };
  }

  if (
    !isObject(started) ||
    !isUuid(started.request_id) ||
    !isUuid(started.check_id)
  ) {
    throw new Error("TRANSFER_RECOVERY_CHECK_START_RESPONSE_INVALID");
  }

  /*
   * Het onderzoek is al gestart door SQL.
   * Dus NIET runSandboxTransferRecoveryCheck aanroepen.
   */
  return runStartedRecoveryCheck(
    started.request_id.toLowerCase(),
    started.check_id.toLowerCase(),
  );
}