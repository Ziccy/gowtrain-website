const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.resolve(
  __dirname,
  "../lib/run-sandbox-transfer-recovery-check.ts",
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
const CHECK = "22222222-2222-4222-8222-222222222222";

const START_NEXT = "start_next_sandbox_transfer_recovery_check";
const START_ONE = "start_sandbox_transfer_recovery_check";
const FINISH = "finish_and_schedule_sandbox_transfer_recovery_check";

const recoveryResult = {
  result: "unprepared_requires_review",
  requestId: REQUEST,
};

/*
 * Iedere test krijgt een nieuwe module met uitsluitend mocks.
 * De echte procesomgeving wordt niet aan de module doorgegeven.
 */
function harness({
  steps = [],
  recovery = recoveryResult,
  recoveryError = null,
  stripeKey = "sk_test_FAKE_LOCAL_ONLY",
} = {}) {
  const events = [];
  let stepIndex = 0;
  let clientsCreated = 0;

  const database = {
    async rpc(name, args) {
      events.push({ type: "rpc", name, args });

      const step = steps[stepIndex++];

      assert.ok(step, `Onverwachte RPC: ${name}`);
      assert.equal(name, step.name);

      if (step.throws) throw step.throws;

      return {
        data: step.data,
        error: step.error ?? null,
      };
    },
  };

  const loadedModule = { exports: {} };

  function mockRequire(name) {
    if (name === "server-only") return {};

    if (name === "@supabase/supabase-js") {
      return {
        createClient(url, key, options) {
          clientsCreated++;

          assert.equal(url, "https://database.example.invalid");
          assert.equal(key, "FAKE_SERVICE_ROLE_LOCAL_ONLY");
          assert.equal(options.auth.persistSession, false);
          assert.equal(options.auth.autoRefreshToken, false);

          return database;
        },
      };
    }

    if (name === "@/lib/reconcile-sandbox-trainer-transfer") {
      return {
        async reconcileSandboxTrainerTransfer(requestId) {
          events.push({ type: "reconcile", requestId });

          assert.equal(requestId, REQUEST);

          if (recoveryError) throw recoveryError;

          return recovery;
        },
      };
    }

    throw new Error(`Niet toegestane import: ${name}`);
  }

  const context = vm.createContext({
    module: loadedModule,
    exports: loadedModule.exports,
    require: mockRequire,
    process: {
      env: {
        NEXT_PUBLIC_SUPABASE_URL:
          "https://database.example.invalid",
        SUPABASE_SERVICE_ROLE_KEY:
          "FAKE_SERVICE_ROLE_LOCAL_ONLY",
        STRIPE_SECRET_KEY: stripeKey,
      },
    },
    // Gebruik dezelfde Error-constructor voor instanceof-controles.
    Error,
    console: {
      error() {},
      info() {},
      warn() {},
      log() {},
    },
  });

  new vm.Script(compiled, { filename }).runInContext(context);

  assert.equal(clientsCreated, 1);

  return {
    api: loadedModule.exports,
    events,
    assertStepsConsumed() {
      assert.equal(stepIndex, steps.length);
    },
  };
}

function eventNames(events) {
  return events.map((event) =>
    event.type === "rpc" ? event.name : "reconcile",
  );
}

function assertCode(code) {
  return (error) => error?.message === code;
}

let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log(`GESLAAGD ${passed}: ${name}`);
}

async function main() {
  await test("Geen kandidaat: geen onderzoek of afsluiting", async () => {
    const h = harness({
      steps: [{ name: START_NEXT, data: null }],
    });

    const result = await h.api.runNextSandboxTransferRecoveryCheck();

    assert.equal(result.result, "not_started");
    assert.deepEqual(eventNames(h.events), [START_NEXT]);
    h.assertStepsConsumed();
  });

  await test("SQL-start wordt niet nogmaals gestart", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          data: { request_id: REQUEST, check_id: CHECK },
        },
        { name: FINISH, data: true },
      ],
    });

    const result = await h.api.runNextSandboxTransferRecoveryCheck();

    assert.equal(result.result, "recorded");
    assert.equal(result.requestId, REQUEST);
    assert.equal(result.checkId, CHECK);
    assert.deepEqual(eventNames(h.events), [
      START_NEXT,
      "reconcile",
      FINISH,
    ]);

    const args = h.events[2].args;
    assert.equal(args.p_check_id, CHECK);
    assert.equal(args.p_outcome, "unprepared_requires_review");
    assert.equal(args.p_transfer_id, null);
    assert.equal(args.p_error_code, null);
    h.assertStepsConsumed();
  });

  await test("Databasefout bij start: geen onderzoek of retry", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          data: null,
          error: { code: "FAKE_DATABASE_ERROR" },
        },
      ],
    });

    await assert.rejects(
      () => h.api.runNextSandboxTransferRecoveryCheck(),
      assertCode("TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED"),
    );

    assert.deepEqual(eventNames(h.events), [START_NEXT]);
    h.assertStepsConsumed();
  });

  await test("Verbindingsfout bij start: geen onderzoek of retry", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          throws: new Error("Gesimuleerde verbindingsonderbreking"),
        },
      ],
    });

    await assert.rejects(
      () => h.api.runNextSandboxTransferRecoveryCheck(),
      assertCode("TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED"),
    );

    assert.deepEqual(eventNames(h.events), [START_NEXT]);
    h.assertStepsConsumed();
  });

  await test("Ongeldige startresponse: geen onderzoek", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          data: { request_id: REQUEST, check_id: "ongeldig" },
        },
      ],
    });

    await assert.rejects(
      () => h.api.runNextSandboxTransferRecoveryCheck(),
      assertCode("TRANSFER_RECOVERY_CHECK_START_RESPONSE_INVALID"),
    );

    assert.deepEqual(eventNames(h.events), [START_NEXT]);
    h.assertStepsConsumed();
  });

  await test("Onderzoeksfout wordt op exact het gestarte onderzoek opgeslagen", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          data: { request_id: REQUEST, check_id: CHECK },
        },
        { name: FINISH, data: true },
      ],
      recoveryError: new Error("TRANSFER_RECOVERY_TEST_FAILURE"),
    });

    const result = await h.api.runNextSandboxTransferRecoveryCheck();

    assert.equal(result.result, "investigation_failed");
    assert.equal(result.failureRecorded, true);
    assert.equal(
      result.diagnosticCode,
      "TRANSFER_RECOVERY_TEST_FAILURE",
    );

    const args = h.events[2].args;
    assert.equal(args.p_check_id, CHECK);
    assert.equal(args.p_outcome, null);
    assert.equal(args.p_transfer_id, null);
    assert.equal(args.p_error_code, "TRANSFER_RECOVERY_TEST_FAILURE");

    assert.deepEqual(eventNames(h.events), [
      START_NEXT,
      "reconcile",
      FINISH,
    ]);
    h.assertStepsConsumed();
  });

  await test("Vrije fouttekst wordt niet als diagnostiek opgeslagen", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          data: { request_id: REQUEST, check_id: CHECK },
        },
        { name: FINISH, data: false },
      ],
      recoveryError: new Error("Vrije externe fouttekst"),
    });

    const result = await h.api.runNextSandboxTransferRecoveryCheck();

    assert.equal(result.result, "investigation_failed");
    assert.equal(result.failureRecorded, false);
    assert.equal(
      result.diagnosticCode,
      "TRANSFER_RECOVERY_CHECK_FAILED",
    );
    assert.equal(
      h.events[2].args.p_error_code,
      "TRANSFER_RECOVERY_CHECK_FAILED",
    );
    h.assertStepsConsumed();
  });

  await test("Geweigerde afsluiting wordt geen bevestigd succes", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          data: { request_id: REQUEST, check_id: CHECK },
        },
        { name: FINISH, data: false },
      ],
    });

    const result = await h.api.runNextSandboxTransferRecoveryCheck();

    assert.equal(result.result, "completion_not_confirmed");
    assert.deepEqual(eventNames(h.events), [
      START_NEXT,
      "reconcile",
      FINISH,
    ]);
    h.assertStepsConsumed();
  });

  await test("Verbindingsfout bij afsluiting veroorzaakt geen herhaling", async () => {
    const h = harness({
      steps: [
        {
          name: START_NEXT,
          data: { request_id: REQUEST, check_id: CHECK },
        },
        {
          name: FINISH,
          throws: new Error("Gesimuleerde verbindingsonderbreking"),
        },
      ],
    });

    const result = await h.api.runNextSandboxTransferRecoveryCheck();

    assert.equal(result.result, "completion_not_confirmed");
    assert.deepEqual(eventNames(h.events), [
      START_NEXT,
      "reconcile",
      FINISH,
    ]);
    h.assertStepsConsumed();
  });

  await test("Niet-testkey wordt vóór iedere RPC geweigerd", async () => {
    const h = harness({
      stripeKey: "FAKE_NON_TEST_KEY",
    });

    await assert.rejects(
      () => h.api.runNextSandboxTransferRecoveryCheck(),
      assertCode("TRANSFER_RECOVERY_TEST_KEY_REQUIRED"),
    );

    assert.equal(h.events.length, 0);
    h.assertStepsConsumed();
  });

  await test("Bestaande expliciete controle blijft werken", async () => {
    const h = harness({
      steps: [
        { name: START_ONE, data: CHECK },
        { name: FINISH, data: true },
      ],
    });

    const result = await h.api.runSandboxTransferRecoveryCheck(REQUEST);

    assert.equal(result.result, "recorded");
    assert.equal(h.events[0].args.p_request_id, REQUEST);
    assert.deepEqual(eventNames(h.events), [
      START_ONE,
      "reconcile",
      FINISH,
    ]);
    h.assertStepsConsumed();
  });

  await test("Expliciete start zonder toestemming voert niets uit", async () => {
    const h = harness({
      steps: [{ name: START_ONE, data: null }],
    });

    const result = await h.api.runSandboxTransferRecoveryCheck(REQUEST);

    assert.equal(result.result, "not_started");
    assert.equal(result.requestId, REQUEST);
    assert.deepEqual(eventNames(h.events), [START_ONE]);
    h.assertStepsConsumed();
  });

  console.log(
    `\nALLE ${passed} TESTS GESLAAGD. ` +
      "Geen echte Stripe- of databaseaanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("\nTEST MISLUKT:", error);
  process.exitCode = 1;
});