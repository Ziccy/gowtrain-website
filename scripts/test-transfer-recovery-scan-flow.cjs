const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

const REQUEST = "11111111-1111-4111-8111-111111111111";
const CHECK = "22222222-2222-4222-8222-222222222222";
const BOOKING = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "44444444-4444-4444-8444-444444444444";
const TRAINER = "55555555-5555-4555-8555-555555555555";
const TRANSFER = "tr_LOCALTEST";

const START_NEXT = "start_next_sandbox_transfer_recovery_check";
const START_ONE = "start_sandbox_transfer_recovery_check";
const RECORD = "record_sandbox_transfer_recovery_scan";
const FINISH = "finish_and_schedule_sandbox_transfer_recovery_check";

const TIME = "2026-09-23T10:00:00.000Z";

const preparedRequest = {
  id: REQUEST,
  booking_id: BOOKING,
  trainer_id: TRAINER,
  source_package_purchase_id: PURCHASE,
  amount_cents: 1900,
  currency: "eur",
  destination_account_id: "acct_LOCALTEST",
  stripe_payment_intent_id: "pi_LOCALTEST",
  stripe_livemode: false,
  funds_flow: "separate_transfers_v1",
  stripe_source_charge_id: "py_LOCALTEST",
  source_verified_at: TIME,
  status: "review_required",
  stripe_idempotency_key: `gowtrain-trainer-transfer/${REQUEST}`,
  stripe_request_payload: { localTest: true },
  first_stripe_request_at: TIME,
  stripe_transfer_id: null,
  succeeded_at: null,
  applied_at: null,
};

const otherTransfer = {
  transferId: "tr_OTHERLOCALTEST",
  destinationAccountId: "acct_OTHERLOCALTEST",
  amountCents: 1900,
  currency: "eur",
  amountReversedCents: 0,
  fullyReversed: false,
  metadataRequestId: null,
  metadataBookingId: null,
};

function makeSearch(found = true) {
  return {
    result: found ? "verified_match" : "not_found_requires_review",
    scannedTransferCount: found ? 2 : 1,
    checkedAt: TIME,
    finishedAt: TIME,
    otherSourceTransfers: [
      {
        ...otherTransfer,
        // Mag niet naar de opslag-RPC worden doorgestuurd.
        unexpectedRawField: "MUST_NOT_BE_STORED",
      },
    ],
    ...(found ? { verified: { transferId: TRANSFER } } : {}),
  };
}

// Normaliseer objecten uit verschillende VM-contexten voor vergelijking.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness({
  request = preparedRequest,
  search = makeSearch(),
  searchError = null,
  scanResponse = true,
  scanError = null,
  scanThrows = null,
  syncError = null,
  finishResponse = true,
  explicit = false,
} = {}) {
  const events = [];
  const violations = [];
  const savedScans = [];
  const cache = new Map();

  function guard(condition, message) {
    if (!condition) {
      violations.push(message);
      throw new Error("LOCAL_MOCK_CONTRACT_VIOLATION");
    }
  }

  const database = {
    from(table) {
      guard(table === "trainer_transfer_requests", "Onverwachte tabel");

      return {
        select() {
          return {
            eq(column, value) {
              guard(column === "id", "Onverwacht filter");
              guard(value === REQUEST, "Onverwachte opdracht");

              return {
                async maybeSingle() {
                  events.push({ name: "read" });
                  return {
                    data: structuredClone(request),
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },

    async rpc(name, args) {
      events.push({ name, args });

      if (name === START_NEXT) {
        guard(!explicit, "Verkeerde startfunctie");
        return {
          data: { request_id: REQUEST, check_id: CHECK },
          error: null,
        };
      }

      if (name === START_ONE) {
        guard(explicit, "Verkeerde startfunctie");
        guard(args.p_request_id === REQUEST, "Verkeerde startopdracht");
        return { data: CHECK, error: null };
      }

      if (name === RECORD) {
        guard(args.p_check_id === CHECK, "Verkeerd scanonderzoek");

        if (scanThrows) throw scanThrows;
        if (scanError) return { data: null, error: scanError };

        if (scanResponse === true) {
          savedScans.push(plain(args));
        }

        return { data: scanResponse, error: null };
      }

      if (name === FINISH) {
        guard(args.p_check_id === CHECK, "Verkeerd afgesloten onderzoek");
        return { data: finishResponse, error: null };
      }

      guard(false, `Onverwachte RPC: ${name}`);
    },
  };

  /*
   * Constructor zonder API-methoden.
   * De echte zoek- en sync-afhankelijkheden worden hieronder
   * expliciet vervangen; echte Stripe-aanroepen zijn niet beschikbaar.
   */
  class FakeStripe {
    constructor(key, options) {
      guard(key === "sk_test_LOCAL_ONLY", "Onverwachte Stripe-key");
      guard(options.maxNetworkRetries === 0, "Onverwachte retries");
    }
  }

  function loadActual(name) {
    guard(
      [
        "run-sandbox-transfer-recovery-check",
        "reconcile-sandbox-trainer-transfer",
      ].includes(name),
      "Onverwachte lokale module",
    );

    if (cache.has(name)) return cache.get(name).exports;

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
    cache.set(name, loadedModule);

    function mockRequire(importName) {
      if (importName === "server-only") return {};
      if (importName === "stripe") return FakeStripe;

      if (importName === "@supabase/supabase-js") {
        return {
          createClient(url, key, options) {
            guard(
              url === "https://database.example.invalid",
              "Onverwachte database-URL",
            );
            guard(key === "LOCAL_SERVICE_ROLE", "Onverwachte databasekey");
            guard(options.auth.persistSession === false, "Sessiepersistentie");
            guard(
              options.auth.autoRefreshToken === false,
              "Automatische tokenrefresh",
            );
            return database;
          },
        };
      }

      if (importName === "@/lib/reconcile-sandbox-trainer-transfer") {
        return loadActual("reconcile-sandbox-trainer-transfer");
      }

      if (importName === "@/lib/find-sandbox-trainer-transfer") {
        return {
          async findSandboxTrainerTransfer(_stripe, input) {
            events.push({ name: "search" });
            guard(
              input.expected.requestId === REQUEST,
              "Verkeerde zoekopdracht",
            );

            if (searchError) throw searchError;
            return structuredClone(search);
          },
        };
      }

      if (importName === "@/lib/sync-sandbox-trainer-transfer") {
        return {
          async syncSandboxTrainerTransfer(requestId, transferId) {
            events.push({ name: "sync" });

            guard(requestId === REQUEST, "Verkeerde syncopdracht");
            guard(transferId === TRANSFER, "Verkeerde synctransfer");
            guard(savedScans.length === 1, "Sync vóór bevestigde scanopslag");

            if (syncError) throw syncError;

            return {
              result: "already_applied",
              requestId: REQUEST,
              bookingId: BOOKING,
              transferId: TRANSFER,
              appliedAt: TIME,
            };
          },
        };
      }

      guard(false, `Niet toegestane import: ${importName}`);
    }

    const context = vm.createContext({
      module: loadedModule,
      exports: loadedModule.exports,
      require: mockRequire,
      process: {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://database.example.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "LOCAL_SERVICE_ROLE",
          STRIPE_SECRET_KEY: "sk_test_LOCAL_ONLY",
        },
      },
      Error,
      console: {
        error() {},
        info() {},
        warn() {},
        log() {},
      },
    });

    new vm.Script(compiled, { filename }).runInContext(context);
    return loadedModule.exports;
  }

  const api = loadActual("run-sandbox-transfer-recovery-check");

  return {
    events,
    savedScans,
    async run() {
      return explicit
        ? api.runSandboxTransferRecoveryCheck(REQUEST)
        : api.runNextSandboxTransferRecoveryCheck();
    },
    assertOrder(expected) {
      assert.deepEqual(violations, []);
      assert.deepEqual(
        events.map((event) => event.name),
        expected,
      );
    },
    finishArgs() {
      const calls = events.filter((event) => event.name === FINISH);
      assert.equal(calls.length, 1);
      return calls[0].args;
    },
  };
}

let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log(`GESLAAGD ${passed}: ${name}`);
}

async function main() {
  await test("Echte functies: start → scanopslag → sync → afsluiting", async () => {
    const h = harness();
    const result = await h.run();

    assert.equal(result.result, "recorded");
    assert.equal(result.recovery.synchronization.result, "already_applied");

    h.assertOrder([START_NEXT, "read", "search", RECORD, "sync", FINISH]);

    assert.deepEqual(h.savedScans, [{
      p_check_id: CHECK,
      p_checked_at: TIME,
      p_finished_at: TIME,
      p_scanned_transfer_count: 2,
      p_search_outcome: "verified_match",
      p_own_transfer_id: TRANSFER,
      p_other_source_transfers: [otherTransfer],
    }]);

    assert.equal(h.finishArgs().p_outcome, "already_applied");
    assert.equal(h.finishArgs().p_transfer_id, TRANSFER);
  });

  await test("Expliciete controle gebruikt dezelfde scanopslag", async () => {
    const h = harness({ explicit: true });
    const result = await h.run();

    assert.equal(result.result, "recorded");
    h.assertOrder([START_ONE, "read", "search", RECORD, "sync", FINISH]);
    assert.equal(h.savedScans[0].p_check_id, CHECK);
  });

  await test("Geen eigen transfer: scan bewaren, geen sync", async () => {
    const h = harness({ search: makeSearch(false) });
    const result = await h.run();

    assert.equal(result.result, "recorded");
    assert.equal(result.recovery.result, "not_found_requires_review");

    h.assertOrder([START_NEXT, "read", "search", RECORD, FINISH]);
    assert.equal(h.savedScans[0].p_own_transfer_id, null);
    assert.equal(
      h.savedScans[0].p_search_outcome,
      "not_found_requires_review",
    );
    assert.equal(h.finishArgs().p_outcome, "not_found_requires_review");
  });

  const failures = [
    {
      name: "Databasefout bij scanopslag",
      options: { scanError: { code: "FAKE_DATABASE_ERROR" } },
      code: "TRANSFER_RECOVERY_SCAN_NOT_CONFIRMED",
    },
    {
      name: "Verbindingsfout bij scanopslag",
      options: { scanThrows: new Error("Simulated connection failure") },
      code: "TRANSFER_RECOVERY_SCAN_NOT_CONFIRMED",
    },
    {
      name: "Geweigerde scanopslag",
      options: { scanResponse: false },
      code: "TRANSFER_RECOVERY_SCAN_REJECTED",
    },
    {
      name: "Ongeldige opslagresponse",
      options: { scanResponse: null },
      code: "TRANSFER_RECOVERY_SCAN_RESPONSE_INVALID",
    },
  ];

  for (const scenario of failures) {
    await test(`${scenario.name}: geen sync of retry`, async () => {
      const h = harness(scenario.options);
      const result = await h.run();

      assert.equal(result.result, "investigation_failed");
      assert.equal(result.diagnosticCode, scenario.code);
      assert.equal(result.failureRecorded, true);

      h.assertOrder([START_NEXT, "read", "search", RECORD, FINISH]);
      assert.equal(h.savedScans.length, 0);
      assert.equal(h.finishArgs().p_outcome, null);
      assert.equal(h.finishArgs().p_error_code, scenario.code);
    });
  }

  await test("Syncfout na opslag: geen tweede scan of herverzending", async () => {
    const h = harness({
      syncError: new Error("TRAINER_TRANSFER_SYNC_APPLICATION_NOT_CONFIRMED"),
    });

    const result = await h.run();

    assert.equal(result.result, "investigation_failed");
    assert.equal(
      result.diagnosticCode,
      "TRAINER_TRANSFER_SYNC_APPLICATION_NOT_CONFIRMED",
    );

    h.assertOrder([START_NEXT, "read", "search", RECORD, "sync", FINISH]);
    assert.equal(h.savedScans.length, 1);
    assert.equal(h.finishArgs().p_transfer_id, null);
  });

  await test("Onvoorbereide opdracht: geen zoekscan of scanopslag", async () => {
    const h = harness({
      request: {
        ...preparedRequest,
        first_stripe_request_at: null,
        stripe_request_payload: null,
        stripe_source_charge_id: null,
        source_verified_at: null,
      },
    });

    const result = await h.run();

    assert.equal(result.result, "recorded");
    assert.equal(result.recovery.result, "unprepared_requires_review");
    h.assertOrder([START_NEXT, "read", FINISH]);
    assert.equal(h.savedScans.length, 0);
  });

  await test("Afgebroken zoekscan: geen voltooide scan opslaan", async () => {
    const h = harness({
      searchError: new Error("TRANSFER_SEARCH_LIMIT_REACHED"),
    });

    const result = await h.run();

    assert.equal(result.result, "investigation_failed");
    assert.equal(result.diagnosticCode, "TRANSFER_SEARCH_LIMIT_REACHED");
    h.assertOrder([START_NEXT, "read", "search", FINISH]);
    assert.equal(h.savedScans.length, 0);
  });

  await test("Afsluiting niet bevestigd: scan niet opnieuw opslaan", async () => {
    const h = harness({ finishResponse: false });
    const result = await h.run();

    assert.equal(result.result, "completion_not_confirmed");
    h.assertOrder([START_NEXT, "read", "search", RECORD, "sync", FINISH]);
    assert.equal(h.savedScans.length, 1);
  });

  console.log(
    `\nALLE ${passed} SCANFLOWTESTS GESLAAGD. ` +
      "Geen echte Stripe- of databaseaanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("\nTEST MISLUKT:", error);
  process.exitCode = 1;
});