const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { Client } = require("pg");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});

const ROOT = path.resolve(__dirname, "..");

const REQUEST = "38ec163f-1804-4ddc-9088-2bc2029fb122";
const BOOKING = "b7d8c195-2f03-428e-bbdb-8e7bf65f76db";
const PURCHASE = "0ceb3427-c520-4351-9cb4-e2fb9ea08069";
const TRANSFER = "tr_3UHkrGBAMjPSbTYm0YqurCIW";

const BASELINE = {
  request: "f57936707544183183276fc8819b8e61",
  booking: "8de25aad781ae294944ddc7cdde29cfc",
  purchase: "887472467b2775725bac1d14a7df8ca3",
};

/*
 * Echte lokale TypeScript-modules laden.
 * GEEN Stripe- of Supabase-mocks.
 *
 * Alleen de server-only marker wordt voor deze expliciete
 * server-side CLI-test overgeslagen. Applicatiecode blijft intact.
 * Onverwachte imports stoppen de test.
 */
const allowedModules = new Set([
  "run-sandbox-transfer-recovery-check",
  "reconcile-sandbox-trainer-transfer",
  "find-sandbox-trainer-transfer",
  "sync-sandbox-trainer-transfer",
  "verify-sandbox-trainer-transfer",
  "stripe-trainer-transfer-payload",
]);

const moduleCache = new Map();

function loadLocalModule(name) {
  if (!allowedModules.has(name)) {
    throw new Error("LOCAL_IMPORT_NOT_ALLOWED");
  }

  if (moduleCache.has(name)) {
    return moduleCache.get(name).exports;
  }

  const filename = path.join(ROOT, "lib", `${name}.ts`);
  const source = fs.readFileSync(filename, "utf8");

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;

  const loadedModule = { exports: {} };
  moduleCache.set(name, loadedModule);

  function localRequire(importName) {
    if (importName === "server-only") return {};

    if (
      importName === "stripe" ||
      importName === "@supabase/supabase-js" ||
      importName === "node:util"
    ) {
      return require(importName);
    }

    if (importName.startsWith("@/lib/")) {
      return loadLocalModule(importName.slice("@/lib/".length));
    }

    throw new Error("LOCAL_IMPORT_NOT_ALLOWED");
  }

  const execute = vm.runInThisContext(
    `(function(require, module, exports) {\n${compiled}\n})`,
    { filename },
  );

  execute(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

async function readState(client) {
  const { rows } = await client.query(
    `
      SELECT
        clock_timestamp() AS checked_at,

        (
          SELECT md5(to_jsonb(r)::text)
          FROM public.trainer_transfer_requests r
          WHERE r.id = $1::uuid
        ) AS request_checksum,

        (
          SELECT md5(to_jsonb(b)::text)
          FROM public.bookings b
          WHERE b.id = $2::uuid
        ) AS booking_checksum,

        (
          SELECT md5(to_jsonb(p)::text)
          FROM public.package_purchases p
          WHERE p.id = $3::uuid
        ) AS purchase_checksum,

        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'status', c.status,
                'outcome', c.outcome,
                'stripe_transfer_id', c.stripe_transfer_id,
                'error_code', c.error_code,
                'finished_at', c.finished_at,
                'row_checksum', md5(to_jsonb(c)::text)
              )
              ORDER BY c.id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_recovery_checks c
          WHERE c.request_id = $1::uuid
        ) AS checks,

        (
          SELECT COALESCE(
            jsonb_agg(
              to_jsonb(s) || jsonb_build_object(
                'row_checksum', md5(to_jsonb(s)::text)
              )
              ORDER BY s.check_id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_recovery_scans s
          JOIN public.trainer_transfer_recovery_checks c
            ON c.id = s.check_id
          WHERE c.request_id = $1::uuid
        ) AS scans
    `,
    [REQUEST, BOOKING, PURCHASE],
  );

  assert.equal(rows.length, 1);
  return rows[0];
}

function assertFinancialBaseline(state) {
  assert.equal(state.request_checksum, BASELINE.request);
  assert.equal(state.booking_checksum, BASELINE.booking);
  assert.equal(state.purchase_checksum, BASELINE.purchase);
}

function safeCode(error) {
  const value = error?.code || error?.message;

  return typeof value === "string" &&
    /^[A-Z0-9_]{1,100}$/.test(value)
    ? value
    : "RUNTIME_TEST_NOT_CONFIRMED";
}

async function main() {
  if (
    process.env.SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED !== "false" ||
    process.env.SANDBOX_TRAINER_TRANSFER_RECOVERY_ENABLED !== "false"
  ) {
    throw new Error("LOCAL_FLAGS_MUST_BE_FALSE");
  }

  if (!process.env.RECOVERY_TEST_DATABASE_PASSWORD) {
    throw new Error("LOCAL_PASSWORD_MISSING");
  }

  if (
    !process.env.NODE_EXTRA_CA_CERTS ||
    !fs.existsSync(process.env.NODE_EXTRA_CA_CERTS)
  ) {
    throw new Error("LOCAL_CA_CERTIFICATE_MISSING");
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (
    !stripeKey ||
    (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_"))
  ) {
    throw new Error("LOCAL_STRIPE_TEST_KEY_REQUIRED");
  }

  // Voorkom dat REST-helper en PostgreSQL-controle andere projecten gebruiken.
  const supabaseUrl = new URL(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "",
  );

  if (
    supabaseUrl.origin !==
      "https://ucrfaksziviflxvhepjk.supabase.co" ||
    supabaseUrl.username ||
    supabaseUrl.password ||
    supabaseUrl.search ||
    supabaseUrl.hash ||
    !["", "/"].includes(supabaseUrl.pathname)
  ) {
    throw new Error("LOCAL_SUPABASE_PROJECT_MISMATCH");
  }

  /*
   * Modules eerst laden, vóór een onderzoek kan worden gestart.
   * Een onverwachte import stopt dus vóór de helperaanroep.
   */
  const { runSandboxTransferRecoveryCheck } = loadLocalModule(
    "run-sandbox-transfer-recovery-check",
  );

  assert.equal(typeof runSandboxTransferRecoveryCheck, "function");

  const client = new Client({
    host: "aws-1-eu-west-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.ucrfaksziviflxvhepjk",
    password: process.env.RECOVERY_TEST_DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    application_name: "existing-transfer-recovery-runtime-test",
  });

  client.on("error", () => {});

  let invoked = false;

  try {
    await client.connect();

    // Deze verbinding wordt uitsluitend voor controle gebruikt.
    await client.query("SET default_transaction_read_only = on");
    await client.query("SET statement_timeout = '10s'");

    const before = await readState(client);
    assertFinancialBaseline(before);

    /*
     * Eenmalige test tegen de bevestigde actuele nulmeting.
     * Na een geslaagde uitvoering weigert deze voorcontrole
     * een volgende uitvoering.
     */
    assert.equal(before.checks.length, 1);
    assert.equal(before.scans.length, 0);

    const existing = before.checks[0];

    assert.equal(
      existing.id,
      "780033e4-d1d3-420d-9af0-cf565c67b3d9",
    );
    assert.equal(existing.status, "finished");
    assert.equal(existing.outcome, "already_applied");
    assert.equal(existing.stripe_transfer_id, TRANSFER);
    assert.equal(existing.error_code, null);
    assert.ok(existing.finished_at);
    assert.equal(
      existing.row_checksum,
      "6537ae44a0c242058c6d40b1fab22687",
    );

    console.log(
      "VOORCONTROLE GESLAAGD: financiële controlesommen gelijk; " +
        "één verwacht bestaand onderzoek intact; nul scans.",
    );

    /*
     * Precies één echte helperaanroep.
     * De helper gebruikt service_role voor onderzoeksregistratie
     * en de bestaande gecontroleerde synchronisatie-RPC.
     *
     * De worker-/uitvoeringsvlaggen blijven false.
     * Dit is de expliciete controle, niet de automatische worker.
     */
    invoked = true;

    const result = await runSandboxTransferRecoveryCheck(REQUEST);

    assert.equal(result.result, "recorded");
    assert.equal(result.requestId, REQUEST);
    assert.equal(result.recovery.result, "synchronized");
    assert.equal(
      result.recovery.synchronization.result,
      "already_applied",
    );
    assert.equal(
      result.recovery.synchronization.transferId,
      TRANSFER,
    );

    const after = await readState(client);
    assertFinancialBaseline(after);

    // Alle bestaande onderzoeken exact behouden.
    for (const existing of before.checks) {
      const preserved = after.checks.find(
        (item) => item.id === existing.id,
      );
      assert.deepEqual(preserved, existing);
    }

    // Ook eventuele bestaande scans zouden exact behouden moeten blijven.
    for (const existing of before.scans) {
      const preserved = after.scans.find(
        (item) => item.check_id === existing.check_id,
      );
      assert.deepEqual(preserved, existing);
    }

    const oldCheckIds = new Set(before.checks.map((item) => item.id));
    const newChecks = after.checks.filter(
      (item) => !oldCheckIds.has(item.id),
    );

    assert.equal(after.checks.length, before.checks.length + 1);
    assert.equal(newChecks.length, 1);

    const check = newChecks[0];
    assert.equal(check.id, result.checkId);
    assert.equal(check.status, "finished");
    assert.equal(check.outcome, "already_applied");
    assert.equal(check.stripe_transfer_id, TRANSFER);
    assert.equal(check.error_code, null);
    assert.ok(check.finished_at);

    const oldScanIds = new Set(
      before.scans.map((item) => item.check_id),
    );
    const newScans = after.scans.filter(
      (item) => !oldScanIds.has(item.check_id),
    );

    assert.equal(after.scans.length, before.scans.length + 1);
    assert.equal(newScans.length, 1);

    const scan = newScans[0];

    assert.equal(scan.check_id, result.checkId);
    assert.equal(scan.search_outcome, "verified_match");
    assert.equal(scan.own_transfer_id, TRANSFER);
    assert.equal(scan.history_approval_granted, false);

    assert.ok(Number.isSafeInteger(scan.scanned_transfer_count));
    assert.ok(scan.scanned_transfer_count >= 1);
    assert.equal(
      scan.scanned_transfer_count,
      result.recovery.scannedTransferCount,
    );

    // PostgreSQL en JavaScript mogen tijdstempels anders formatteren.
    const scanStart = Date.parse(scan.checked_at);
    const scanEnd = Date.parse(scan.finished_at);
    const recordedAt = Date.parse(scan.recorded_at);
    const checkFinishedAt = Date.parse(check.finished_at);

    assert.ok(Number.isFinite(scanStart));
    assert.ok(Number.isFinite(scanEnd));
    assert.ok(Number.isFinite(recordedAt));
    assert.ok(Number.isFinite(checkFinishedAt));

    assert.equal(scanStart, Date.parse(result.recovery.checkedAt));
    assert.equal(scanEnd, Date.parse(result.recovery.finishedAt));
    assert.ok(scanEnd >= scanStart);

    // Beide tijden komen van de databaseklok.
    assert.ok(recordedAt <= checkFinishedAt);

    assert.ok(Array.isArray(scan.other_source_transfers));
    assert.deepEqual(
      scan.other_source_transfers,
      result.recovery.otherSourceTransfers,
    );
    assert.equal(result.recovery.historyApprovalGranted, false);

    console.log(
      "GESLAAGD: bestaande Stripe-transfer geverifieerd; " +
        "synchronisatie gaf already_applied.",
    );
    console.log(
      "SCANOPSLAG GESLAAGD: precies één scan bij het nieuwe onderzoek; " +
        "inhoud komt overeen met de teruggegeven zoekcontext.",
    );
    console.log(
      "HISTORIE GESLAAGD: bestaand onderzoek ongewijzigd; " +
        "precies één nieuw finished-onderzoek met already_applied.",
    );
    console.log(
      "NACONTROLE GESLAAGD: opdracht, boeking en aankoop " +
        "ongewijzigd volgens de controlesommen.",
    );
    console.log(
      "Geen nieuwe transfer aangevraagd. " +
        "Het echte onderzoek en de scan blijven bewaard.",
    );
  } catch (error) {
    if (invoked) {
      console.error(
        "HERSTELAANROEP IS GESTART. Niet opnieuw uitvoeren en " +
          "geen onderzoeksrijen verwijderen. Eerst database controleren.",
      );
    } else {
      console.error(
        "GESTOPT VOOR HERSTELAANROEP. Geen onderzoek door dit script gestart.",
      );
    }

    throw error;
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

main().catch((error) => {
  console.error("TEST NIET BEVESTIGD: " + safeCode(error));
  process.exitCode = 1;
});