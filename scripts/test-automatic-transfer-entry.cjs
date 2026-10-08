const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { isDeepStrictEqual } = require("node:util");

const filename = path.resolve(
  __dirname,
  "../lib/execute-sandbox-trainer-transfer.ts",
);

const compiled = ts.transpileModule(
  fs.readFileSync(filename, "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  },
).outputText;

const REQUEST = "11111111-1111-4111-8111-111111111111";
const SELECT = "claim_next_sandbox_trainer_transfer";

function harness({
  execution = "false",
  automatic = "false",
  stripeKey = "sk_test_LOCAL_ONLY",
  selection = {
    result: "not_claimed",
    considered: 0,
    deferred: 0,
    busy: 0,
  },
  selectionError = null,
  selectionThrows = null,
  manualRequest = null,
} = {}) {
  const events = [];
  const violations = [];

  function unexpected(name) {
    violations.push(name);
    throw new Error("LOCAL_UNEXPECTED_CALL");
  }

  class FakeStripeError extends Error {}

  class FakeStripe {
    static errors = { StripeError: FakeStripeError };

    constructor(key, options) {
      events.push("stripe_client");

      assert.equal(key, "sk_test_LOCAL_ONLY");
      assert.equal(options.maxNetworkRetries, 0);
      assert.equal(options.timeout, 10_000);

      this.transfers = {
        create() {
          return unexpected("transfers.create");
        },
      };
    }
  }

  const database = {
    async rpc(name) {
      events.push(name);

      if (name !== SELECT) return unexpected(`rpc:${name}`);
      if (selectionThrows) throw selectionThrows;

      return {
        data: selection,
        error: selectionError,
      };
    },

    from(table) {
      events.push(`read:${table}`);

      if (table !== "trainer_transfer_requests") {
        return unexpected(`table:${table}`);
      }

      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, "id");
              assert.equal(value, REQUEST);

              return {
                async maybeSingle() {
                  return { data: manualRequest, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const loadedModule = { exports: {} };

  function mockRequire(name) {
    if (name === "server-only") return {};
    if (name === "node:util") return { isDeepStrictEqual };
    if (name === "stripe") return FakeStripe;

    if (name === "@supabase/supabase-js") {
      return {
        createClient(url, key, options) {
          events.push("database_client");
          assert.equal(url, "https://database.example.invalid");
          assert.equal(key, "LOCAL_SERVICE_ROLE");
          assert.equal(options.auth.persistSession, false);
          assert.equal(options.auth.autoRefreshToken, false);
          return database;
        },
      };
    }

    if (name === "@/lib/inspect-sandbox-transfer-history") {
      return {
        inspectClaimedSandboxTransferHistory() {
          return unexpected("history_inspection");
        },
      };
    }

    if (name === "@/lib/stripe-connect-v2-status") {
      return {
        retrieveTrainerConnectV2StatusSnapshot() {
          return unexpected("destination_verification");
        },
      };
    }

    if (name === "@/lib/stripe-trainer-transfer-payload") {
      return {
        buildTrainerTransferPayload() {
          return unexpected("payload_builder");
        },
      };
    }

    if (name === "@/lib/sync-sandbox-trainer-transfer") {
      return {
        syncSandboxTrainerTransfer() {
          return unexpected("synchronization");
        },
      };
    }

    if (name === "@/lib/inspect-claimed-single-transfer-history") {
      return {
        inspectClaimedSingleTransferHistory() {
          return unexpected("single_history_inspection");
        },
      };
    }

    if (name === "@/lib/stripe-single-lesson-transfer-payload") {
      return {
        buildSingleLessonTrainerTransferPayload() {
          return unexpected("single_payload_builder");
        },
      };
    }

    return unexpected(`import:${name}`);
  }

  const context = vm.createContext({
    module: loadedModule,
    exports: loadedModule.exports,
    require: mockRequire,
    Error,
    process: {
      env: {
        SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED: execution,
        SANDBOX_TRAINER_TRANSFER_AUTOMATIC_ENABLED: automatic,
        STRIPE_SECRET_KEY: stripeKey,
        NEXT_PUBLIC_SUPABASE_URL: "https://database.example.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "LOCAL_SERVICE_ROLE",
      },
    },
    console: {
      error() {},
      warn() {},
      log() {},
    },
  });

  new vm.Script(compiled, { filename }).runInContext(context);

  return {
    api: loadedModule.exports,
    events,
    assertEvents(expected) {
      // Onverwachte aanroepen mogen niet door productiefoutafhandeling
      // verborgen worden en zo een vals geslaagde test opleveren.
      assert.deepEqual(violations, []);
      assert.deepEqual(events, expected);
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
  await test("Algemene vlag uit blokkeert beide ingangen", async () => {
    const h = harness({ execution: "false", automatic: "true" });

    const automatic = await h.api.executeNextSandboxTrainerTransfer();
    const manual = await h.api.executeSandboxTrainerTransfer(REQUEST);

    assert.equal(automatic.result, "disabled");
    assert.equal(manual.result, "disabled");
    assert.equal(manual.requestId, REQUEST);
    h.assertEvents([]);
  });

  await test("Automatische vlag uit voorkomt selectie", async () => {
    const h = harness({ execution: "true", automatic: "false" });

    const result = await h.api.executeNextSandboxTrainerTransfer();

    assert.equal(result.result, "disabled");
    h.assertEvents([]);
  });

  await test("Ontbrekende automatische vlag betekent uit", async () => {
    const h = harness({ execution: "true", automatic: null });

    const result = await h.api.executeNextSandboxTrainerTransfer();

    assert.equal(result.result, "disabled");
    h.assertEvents([]);
  });

  await test("Niet-testkey wordt vóór clientaanmaak geweigerd", async () => {
    const h = harness({
      execution: "true",
      automatic: "true",
      stripeKey: "INVALID_LOCAL_KEY",
    });

    await assert.rejects(
      () => h.api.executeNextSandboxTrainerTransfer(),
      (error) =>
        error.message === "TRANSFER_EXECUTION_TEST_KEY_REQUIRED",
    );

    h.assertEvents([]);
  });

  await test("Geen kandidaat: één selectie, geen verdere uitvoering", async () => {
    const h = harness({
      execution: "true",
      automatic: "true",
      selection: {
        result: "not_claimed",
        considered: 2,
        deferred: 1,
        busy: 1,
      },
    });

    const result = await h.api.executeNextSandboxTrainerTransfer();

    assert.equal(result.result, "not_claimed");
    assert.equal(result.considered, 2);
    assert.equal(result.deferred, 1);
    assert.equal(result.busy, 1);
    h.assertEvents(["stripe_client", "database_client", SELECT]);
  });

  await test("Selectiefout: geen tweede selectie of losse claim", async () => {
    const h = harness({
      execution: "true",
      automatic: "true",
      selectionError: { code: "FAKE_DATABASE_ERROR" },
    });

    const result = await h.api.executeNextSandboxTrainerTransfer();

    assert.equal(result.result, "not_confirmed");
    assert.equal(result.requestId, null);
    assert.equal(result.reviewRecorded, false);
    assert.equal(
      result.diagnosticCode,
      "TRANSFER_AUTO_SELECTION_NOT_CONFIRMED",
    );
    h.assertEvents(["stripe_client", "database_client", SELECT]);
  });

  await test("Verbindingsonderbreking: geen retry of opdrachtwijziging", async () => {
    const h = harness({
      execution: "true",
      automatic: "true",
      selectionThrows: new Error("Simulated connection interruption"),
    });

    const result = await h.api.executeNextSandboxTrainerTransfer();

    assert.equal(result.result, "not_confirmed");
    assert.equal(result.requestId, null);
    assert.equal(result.reviewRecorded, false);
    assert.equal(result.stage, "automatic_selection");
    h.assertEvents(["stripe_client", "database_client", SELECT]);
  });

  await test("Ongeldige selectie-response: geen verdere uitvoering", async () => {
    for (const selection of [
      null,
      {},
      {
        result: "claimed",
        considered: 1,
        deferred: 0,
        busy: 0,
        claim: { request_id: "invalid" },
      },
    ]) {
      const h = harness({
        execution: "true",
        automatic: "true",
        selection,
      });

      const result = await h.api.executeNextSandboxTrainerTransfer();

      assert.equal(result.result, "not_confirmed");
      assert.equal(result.requestId, null);
      assert.equal(result.reviewRecorded, false);
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_AUTO_SELECTION_RESPONSE_INVALID",
      );
      h.assertEvents(["stripe_client", "database_client", SELECT]);
    }
  });

  await test("Automatische kandidaat blijft buiten handmatige scope", async () => {
    const h = harness({
      execution: "true",
      automatic: "true",
      manualRequest: {
        id: REQUEST,
        booking_id: "c413bd74-8c8f-4ba5-8f03-98430c08f905",
        source_package_purchase_id:
          "c02e8212-9379-4f3f-8edd-023dea74910a",
        trainer_id: "4c4a5ffc-7584-4ffb-9678-95d3a311c50e",
        destination_account_id: "acct_1UHJRCBAMjpV6Qwm",
        amount_cents: 1900,
        currency: "eur",
        stripe_livemode: false,
        funds_flow: "separate_transfers_v1",
      },
    });

    const result = await h.api.executeSandboxTrainerTransfer(REQUEST);

    assert.equal(result.result, "not_confirmed");
    assert.equal(
      result.diagnosticCode,
      "TRANSFER_EXECUTION_OUTSIDE_TEST_SCOPE",
    );
    assert.equal(result.reviewRecorded, false);
    h.assertEvents([
      "stripe_client",
      "database_client",
      "read:trainer_transfer_requests",
    ]);
  });

  console.log(
    `\nALLE ${passed} INGANGSTESTS GESLAAGD. ` +
      "Geen echte Stripe- of databaseaanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("TEST MISLUKT:", error);
  process.exitCode = 1;
});