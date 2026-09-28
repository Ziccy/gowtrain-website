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
const TOKEN = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const BOOKING = "c413bd74-8c8f-4ba5-8f03-98430c08f905";
const PURCHASE = "c02e8212-9379-4f3f-8edd-023dea74910a";
const TRAINER = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";
const DESTINATION = "acct_1UHJRCBAMjpV6Qwm";
const TRANSFER = "tr_LOCALEXECUTIONTEST";

const SELECT = "claim_next_sandbox_trainer_transfer";
const PREPARE = "prepare_sandbox_trainer_transfer";
const REVIEW = "mark_sandbox_trainer_transfer_for_review";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness(options = {}) {
  const events = [];
  const violations = [];
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 300_000).toISOString();

  const env = {
    SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED: "true",
    SANDBOX_TRAINER_TRANSFER_AUTOMATIC_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_LOCAL_ONLY",
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "LOCAL_SERVICE_ROLE",
  };

  const claim = {
    request_id: REQUEST,
    booking_id: BOOKING,
    source_package_purchase_id: PURCHASE,
    trainer_id: TRAINER,
    destination_account_id: DESTINATION,
    amount_cents: 1900,
    currency: "eur",
    stripe_payment_intent_id: "pi_LOCALTEST",
    stripe_livemode: false,
    funds_flow: "separate_transfers_v1",
    stripe_idempotency_key: `gowtrain-trainer-transfer/${REQUEST}`,
    lock_token: TOKEN,
    locked_until: lease,
    attempts: 1,
    ...options.claim,
  };

  const payload = {
    amount: 1900,
    currency: "eur",
    destination: DESTINATION,
    source_transaction: "py_LOCALTEST",
    transfer_group: `gowtrain-package/${PURCHASE}`,
    metadata: {
      gowtrain_transfer_request_id: REQUEST,
      gowtrain_booking_id: BOOKING,
    },
  };

  function guard(condition, message) {
    if (!condition) {
      violations.push(message);
      throw new Error("LOCAL_MOCK_CONTRACT_VIOLATION");
    }
  }

  class FakeStripeError extends Error {
    constructor(type) {
      super("Simulated Stripe error");
      this.type = type;
    }
  }

  class FakeStripe {
    static errors = { StripeError: FakeStripeError };

    constructor(key, settings) {
      guard(key === "sk_test_LOCAL_ONLY", "Verkeerde Stripe-key");
      guard(settings.maxNetworkRetries === 0, "SDK-retries niet uit");

      this.transfers = {
        async create(actualPayload, requestOptions) {
          events.push("create");
          guard(
            isDeepStrictEqual(plain(actualPayload), payload),
            "Createpayload wijkt af",
          );
          guard(
            requestOptions.idempotencyKey === claim.stripe_idempotency_key,
            "Idempotency-key wijkt af",
          );

          if (options.createTimeout) {
            throw new FakeStripeError("StripeConnectionError");
          }

          return { id: TRANSFER };
        },
      };
    }
  }

  const database = {
    async rpc(name, args) {
      events.push(name);

      if (name === SELECT) {
        return {
          error: null,
          data: {
            result: "claimed",
            considered: 1,
            deferred: 0,
            busy: 0,
            claim,
          },
        };
      }

      if (name === PREPARE) {
        guard(args.p_request_id === REQUEST, "Verkeerde prepareopdracht");
        guard(args.p_lock_token === TOKEN, "Verkeerd preparetoken");
        guard(
          isDeepStrictEqual(plain(args.p_payload), payload),
          "Preparepayload wijkt af",
        );

        if (options.prepareError) {
          return { data: null, error: { code: "LOCAL_PREPARE_ERROR" } };
        }

        return {
          error: null,
          data: {
            request_id: REQUEST,
            booking_id: BOOKING,
            lock_token: TOKEN,
            stripe_idempotency_key: claim.stripe_idempotency_key,
            stripe_request_payload: payload,
            first_stripe_request_at: now,
            locked_until: lease,
          },
        };
      }

      if (name === REVIEW) {
        guard(args.p_request_id === REQUEST, "Verkeerde reviewopdracht");
        guard(args.p_lock_token === TOKEN, "Verkeerd reviewtoken");
        return {
          data: options.reviewFalse ? false : true,
          error: null,
        };
      }

      guard(false, `Onverwachte RPC of tweede claim: ${name}`);
    },

    from(table) {
      const filters = {};

      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters[column] = value;
          return query;
        },
        async maybeSingle() {
          if (table === "trainer_connect_attempts") {
            events.push("connect_read");
            guard(filters.trainer_id === TRAINER, "Verkeerde trainer");
            guard(
              filters.stripe_account_id === DESTINATION,
              "Verkeerde bestemming",
            );

            return {
              error: null,
              data: {
                id: ATTEMPT,
                stripe_livemode: false,
                stripe_request_payload: {
                  identity: { country: "NL" },
                  metadata: {
                    gowtrain_trainer_id: TRAINER,
                    gowtrain_connect_attempt_id: ATTEMPT,
                  },
                },
              },
            };
          }

          if (table === "trainer_transfer_requests") {
            events.push("pre_send_read");
            guard(filters.id === REQUEST, "Verkeerde pre-sendopdracht");

            if (options.disableBeforeSend) {
              env.SANDBOX_TRAINER_TRANSFER_AUTOMATIC_ENABLED = "false";
            }

            return {
              error: null,
              data: {
                status: options.changedClaim ? "review_required" : "processing",
                lock_token: TOKEN,
                locked_until: lease,
                stripe_request_payload: payload,
                stripe_idempotency_key: claim.stripe_idempotency_key,
                first_stripe_request_at: now,
                stripe_transfer_id: null,
              },
            };
          }

          guard(false, `Onverwachte tabel: ${table}`);
        },
      };

      return query;
    },
  };

  const loadedModule = { exports: {} };

  function mockRequire(name) {
    if (name === "server-only") return {};
    if (name === "node:util") return { isDeepStrictEqual };
    if (name === "stripe") return FakeStripe;

    if (name === "@supabase/supabase-js") {
      return {
        createClient(url, key, settings) {
          guard(url === env.NEXT_PUBLIC_SUPABASE_URL, "Verkeerde database");
          guard(key === "LOCAL_SERVICE_ROLE", "Verkeerde databasekey");
          guard(settings.auth.persistSession === false, "Sessiepersistentie");
          return database;
        },
      };
    }

    if (name === "@/lib/inspect-sandbox-transfer-history") {
      return {
        async inspectClaimedSandboxTransferHistory(input) {
          events.push("history");
          guard(input.lockToken === TOKEN, "Verkeerd historietoken");
          guard(input.expected.bookingId === BOOKING, "Verkeerde historieboeking");
          guard(input.expected.purchaseId === PURCHASE, "Verkeerde aankoop");
          guard(input.expected.amountCents === 1900, "Verkeerd bedrag");

          if (options.historyError) {
            throw new Error("TRANSFER_HISTORY_TEST_REJECTED");
          }

          return {
            currentRequestId: REQUEST,
            databaseRequestCount: 3,
            completedRequestCount: 2,
            historyComparison: {
              comparisonConfirmed: true,
              currentSourceTransferredCents: 0,
              currentDestinationTransferredCents: 3800,
            },
            source: {
              purchaseId: PURCHASE,
              paymentIntentId: "pi_LOCALTEST",
              chargeId: "py_LOCALTEST",
              transferInspection: {
                destinationAccountId: DESTINATION,
              },
            },
          };
        },
      };
    }

    if (name === "@/lib/stripe-connect-v2-status") {
      return {
        async retrieveTrainerConnectV2StatusSnapshot(_stripe, input) {
          events.push("destination");
          guard(input.accountId === DESTINATION, "Verkeerd Connect-account");
          guard(input.attemptId === ATTEMPT, "Verkeerde Connect-poging");

          return {
            closed: false,
            transfersStatus: "active",
            reviewReasons: [],
          };
        },
      };
    }

    if (name === "@/lib/stripe-trainer-transfer-payload") {
      return {
        buildTrainerTransferPayload(input) {
          events.push("build_payload");
          guard(input.requestId === REQUEST, "Verkeerde payloadopdracht");
          guard(input.bookingId === BOOKING, "Verkeerde payloadboeking");
          guard(input.packagePurchaseId === PURCHASE, "Verkeerde payloadaankoop");
          guard(input.destinationAccountId === DESTINATION, "Verkeerde payloadbestemming");
          guard(input.amountCents === 1900, "Verkeerd payloadbedrag");

          return {
            payload,
            idempotencyKey: claim.stripe_idempotency_key,
          };
        },
      };
    }

    if (name === "@/lib/sync-sandbox-trainer-transfer") {
      return {
        async syncSandboxTrainerTransfer(requestId, transferId) {
          events.push("sync");
          guard(requestId === REQUEST, "Verkeerde syncopdracht");
          guard(transferId === TRANSFER, "Verkeerde synctransfer");

          if (options.syncError) {
            throw new Error("TRAINER_TRANSFER_SYNC_APPLICATION_NOT_CONFIRMED");
          }

          return {
            result: "applied",
            requestId,
            transferId,
            bookingId: BOOKING,
            appliedAt: now,
          };
        },
      };
    }

    guard(false, `Niet toegestane import: ${name}`);
  }

  const context = vm.createContext({
    module: loadedModule,
    exports: loadedModule.exports,
    require: mockRequire,
    Error,
    process: { env },
    console: { error() {}, warn() {}, log() {} },
  });

  new vm.Script(compiled, { filename }).runInContext(context);

  return {
    run: loadedModule.exports.executeNextSandboxTrainerTransfer,
    check(expectedEvents) {
      // Ook controleren als de productiefunctie een mockfout opvangt.
      assert.deepEqual(violations, []);
      assert.deepEqual(events, expectedEvents);
      assert.ok(events.filter((event) => event === "create").length <= 1);
      assert.equal(events.filter((event) => event === SELECT).length, 1);
    },
  };
}

const BEFORE_PREPARE = [
  SELECT,
  "history",
  "connect_read",
  "destination",
  "build_payload",
];

const BEFORE_CREATE = [
  ...BEFORE_PREPARE,
  PREPARE,
  "pre_send_read",
];

let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log(`GESLAAGD ${passed}: ${name}`);
}

async function main() {
  await test("Bevestigde automatische claim: één create, geen tweede claim", async () => {
    const h = harness();
    const result = await h.run();

    console.log("MOCKTEST-DIAGNOSE:", {
      result: result.result,
      stage: result.stage,
      diagnosticCode: result.diagnosticCode,
      reviewRecorded: result.reviewRecorded,
    });

    // Toon ook eventuele schending van het mockcontract of
    // een afwijkende aanroepvolgorde, vóór de resultaatassertie.
    h.check([...BEFORE_CREATE, "create", "sync"]);

    assert.equal(result.result, "synchronized");
    assert.equal(result.requestId, REQUEST);
    assert.equal(result.transferId, TRANSFER);
    assert.equal(result.applicationResult, "applied");
    h.check([...BEFORE_CREATE, "create", "sync"]);
  });

  await test("Andere bestemming geweigerd vóór Stripe-onderzoek", async () => {
    const h = harness({
      claim: { destination_account_id: "acct_OUTSIDE_SCOPE" },
    });
    const result = await h.run();

    assert.equal(result.result, "not_confirmed");
    assert.equal(
      result.diagnosticCode,
      "TRANSFER_EXECUTION_CLAIM_CONTEXT_MISMATCH",
    );
    assert.equal(result.reviewRecorded, true);
    h.check([SELECT, REVIEW]);
  });

  await test("Geweigerde historie: geen prepare of create", async () => {
    const h = harness({ historyError: true });
    const result = await h.run();

    assert.equal(result.result, "not_confirmed");
    assert.equal(result.stage, "inspect_claimed_history");
    h.check([SELECT, "history", REVIEW]);
  });

  await test("Onzekere prepare: geen payload teruglezen of verzenden", async () => {
    const h = harness({ prepareError: true });
    const result = await h.run();

    assert.equal(
      result.diagnosticCode,
      "TRANSFER_EXECUTION_PREPARE_NOT_CONFIRMED",
    );
    assert.equal(result.transferId, null);
    h.check([...BEFORE_PREPARE, PREPARE, REVIEW]);
  });

  await test("Gewijzigde claim bij pre-send: geen create", async () => {
    const h = harness({ changedClaim: true });
    const result = await h.run();

    assert.equal(
      result.diagnosticCode,
      "TRANSFER_EXECUTION_PRE_SEND_CHECK_FAILED",
    );
    h.check([...BEFORE_CREATE, REVIEW]);
  });

  await test("Lokale vlagcheck vóór verzending wordt gerespecteerd", async () => {
    const h = harness({ disableBeforeSend: true });
    const result = await h.run();

    assert.equal(
      result.diagnosticCode,
      "TRANSFER_EXECUTION_DISABLED_AFTER_PREPARATION",
    );
    h.check([...BEFORE_CREATE, REVIEW]);
  });

  await test("Stripe-timeout: één create, geen retry of sync", async () => {
    const h = harness({ createTimeout: true });
    const result = await h.run();

    assert.equal(result.result, "not_confirmed");
    assert.equal(result.stage, "stripe_create");
    assert.equal(
      result.diagnosticCode,
      "TRANSFER_EXECUTION_STRIPE_CONNECTION_ERROR",
    );
    assert.equal(result.transferId, null);
    h.check([...BEFORE_CREATE, "create", REVIEW]);
  });

  await test("Syncfout na create: transfer-ID behouden, niet herverzenden", async () => {
    const h = harness({ syncError: true, reviewFalse: true });
    const result = await h.run();

    assert.equal(result.result, "not_confirmed");
    assert.equal(result.stage, "synchronize");
    assert.equal(result.transferId, TRANSFER);
    assert.equal(result.reviewRecorded, false);
    h.check([...BEFORE_CREATE, "create", "sync", REVIEW]);
  });

  console.log(
    `\nALLE ${passed} UITVOERINGSTESTS GESLAAGD. ` +
      "Geen echte Stripe- of databaseaanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("TEST MISLUKT:", error);
  process.exitCode = 1;
});