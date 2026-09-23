const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.resolve(
  __dirname,
  "../lib/run-sandbox-transfer-recovery-worker.ts",
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

const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHECK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXPIRE = "expire_next_sandbox_transfer_recovery_check";

function harness({
  timeoutData = null,
  timeoutError = null,
  timeoutThrows = null,
  nextResult = { result: "not_started" },
  nextThrows = null,
  stripeKey = "sk_test_FAKE_LOCAL_ONLY",
} = {}) {
  const events = [];
  let clientsCreated = 0;

  const database = {
    async rpc(name, args) {
      events.push({ type: "rpc", name, args });

      if (timeoutThrows) throw timeoutThrows;

      return {
        data: timeoutData,
        error: timeoutError,
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

    if (name === "@/lib/run-sandbox-transfer-recovery-check") {
      return {
        async runNextSandboxTransferRecoveryCheck() {
          events.push({ type: "next" });

          if (nextThrows) throw nextThrows;

          return nextResult;
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
    run: loadedModule.exports.runSandboxTransferRecoveryWorker,
    events,
  };
}

function assertEvents(h, expected) {
  assert.deepEqual(
    h.events.map((event) =>
      event.type === "rpc" ? event.name : event.type,
    ),
    expected,
  );

  for (const event of h.events) {
    if (event.type === "rpc") {
      assert.equal(event.name, EXPIRE);
      assert.equal(event.args, undefined);
    }
  }
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
  await test("Geen timeout: precies één volgende onderzoeksstap", async () => {
    const expected = { result: "not_started" };
    const h = harness({ nextResult: expected });

    const result = await h.run();

    assert.strictEqual(result, expected);
    assertEvents(h, [EXPIRE, "next"]);
  });

  await test("Afgehandelde timeout: geen nieuw onderzoek", async () => {
    const h = harness({
      timeoutData: {
        result: "expired",
        request_id: REQUEST.toUpperCase(),
        check_id: CHECK.toUpperCase(),
      },
    });

    const result = await h.run();

    assert.equal(result.result, "timeout_processed");
    assert.equal(result.requestId, REQUEST);
    assert.equal(result.checkId, CHECK);
    assertEvents(h, [EXPIRE]);
  });

  await test("Databasefout bij timeout: stoppen zonder retry", async () => {
    const h = harness({
      timeoutError: { code: "FAKE_DATABASE_ERROR" },
    });

    await assert.rejects(
      () => h.run(),
      assertCode("TRANSFER_RECOVERY_TIMEOUT_NOT_CONFIRMED"),
    );

    assertEvents(h, [EXPIRE]);
  });

  await test("Verbindingsfout bij timeout: geen nieuwe selectie", async () => {
    const h = harness({
      timeoutThrows: new Error("Gesimuleerde verbindingsonderbreking"),
    });

    await assert.rejects(
      () => h.run(),
      assertCode("TRANSFER_RECOVERY_TIMEOUT_NOT_CONFIRMED"),
    );

    assertEvents(h, [EXPIRE]);
  });

  await test("Ongeldige timeoutresponses: geen nieuw onderzoek", async () => {
    const invalidResponses = [
      false,
      [],
      {},
      { result: "expired", request_id: REQUEST },
      {
        result: "expired",
        request_id: REQUEST,
        check_id: "ongeldig",
      },
      {
        result: "unexpected",
        request_id: REQUEST,
        check_id: CHECK,
      },
    ];

    for (const timeoutData of invalidResponses) {
      const h = harness({ timeoutData });

      await assert.rejects(
        () => h.run(),
        assertCode("TRANSFER_RECOVERY_TIMEOUT_RESPONSE_INVALID"),
      );

      assertEvents(h, [EXPIRE]);
    }
  });

  await test("Niet-testkey: geen RPC of onderzoeksstap", async () => {
    const h = harness({
      stripeKey: "FAKE_NON_TEST_KEY",
    });

    await assert.rejects(
      () => h.run(),
      assertCode("TRANSFER_RECOVERY_TEST_KEY_REQUIRED"),
    );

    assertEvents(h, []);
  });

  await test("Onderzoeksresultaten worden ongewijzigd doorgegeven", async () => {
    const recovery = {
      result: "unprepared_requires_review",
      requestId: REQUEST,
    };

    const results = [
      {
        result: "recorded",
        requestId: REQUEST,
        checkId: CHECK,
        recovery,
      },
      {
        result: "investigation_failed",
        requestId: REQUEST,
        checkId: CHECK,
        diagnosticCode: "TRANSFER_RECOVERY_CHECK_FAILED",
        failureRecorded: false,
      },
      {
        result: "completion_not_confirmed",
        requestId: REQUEST,
        checkId: CHECK,
        recovery,
      },
    ];

    for (const expected of results) {
      const h = harness({ nextResult: expected });

      const result = await h.run();

      assert.strictEqual(result, expected);
      assertEvents(h, [EXPIRE, "next"]);
    }
  });

  await test("Fout bij onderzoeksstart: doorgeven zonder retry", async () => {
    const h = harness({
      nextThrows: new Error(
        "TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED",
      ),
    });

    await assert.rejects(
      () => h.run(),
      assertCode("TRANSFER_RECOVERY_CHECK_START_NOT_CONFIRMED"),
    );

    assertEvents(h, [EXPIRE, "next"]);
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