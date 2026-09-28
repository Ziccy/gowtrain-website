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

const SELECT = "claim_next_sandbox_trainer_transfer";
const MANUAL_CLAIM = "claim_sandbox_trainer_transfer";
const PREPARE = "prepare_sandbox_trainer_transfer";
const REVIEW = "mark_sandbox_trainer_transfer_for_review";

const BASE_FIXTURE = {
  REQUEST: "11111111-1111-4111-8111-111111111111",
  TOKEN: "22222222-2222-4222-8222-222222222222",
  ATTEMPT: "33333333-3333-4333-8333-333333333333",
  BOOKING: "c413bd74-8c8f-4ba5-8f03-98430c08f905",
  PURCHASE: "c02e8212-9379-4f3f-8edd-023dea74910a",
  TRAINER: "4c4a5ffc-7584-4ffb-9678-95d3a311c50e",
  DESTINATION: "acct_1UHJRCBAMjpV6Qwm",
  TRANSFER: "tr_LOCALEXECUTIONTEST",
  PAYMENT: "pi_LOCALTEST",
  CHARGE: "py_LOCALTEST",
  AMOUNT: 1900,
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness(options = {}) {
  /*
   * De fixture bepaalt de verwachte context.
   * options.claim kan daar bewust van afwijken.
   * Verwachtingen worden dus niet uit de ontvangen claim afgeleid.
   */
  const {
    REQUEST,
    TOKEN,
    ATTEMPT,
    BOOKING,
    PURCHASE,
    TRAINER,
    DESTINATION,
    TRANSFER,
    PAYMENT,
    CHARGE,
    AMOUNT,
  } = {
    ...BASE_FIXTURE,
    ...options.fixture,
  };

  const events = [];
  const violations = [];

  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 300_000).toISOString();
  const idempotencyKey = `gowtrain-trainer-transfer/${REQUEST}`;

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
    amount_cents: AMOUNT,
    currency: "eur",
    stripe_payment_intent_id: PAYMENT,
    stripe_livemode: false,
    funds_flow: "separate_transfers_v1",
    stripe_idempotency_key: idempotencyKey,
    lock_token: TOKEN,
    locked_until: lease,
    attempts: 1,
    ...options.claim,
  };

  const payload = {
    amount: AMOUNT,
    currency: "eur",
    destination: DESTINATION,
    source_transaction: CHARGE,
    transfer_group: `gowtrain-package/${PURCHASE}`,
    metadata: {
      gowtrain_transfer_request_id: REQUEST,
      gowtrain_booking_id: BOOKING,
      gowtrain_trainer_id: TRAINER,
      gowtrain_package_purchase_id: PURCHASE,
      gowtrain_payment_intent_id: PAYMENT,
      gowtrain_funds_flow: "separate_transfers_v1",
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
      guard(settings.timeout === 10_000, "Onverwachte Stripe-timeout");

      this.transfers = {
        async create(actualPayload, requestOptions) {
          events.push("create");

          guard(
            isDeepStrictEqual(plain(actualPayload), payload),
            "Createpayload wijkt af",
          );
          guard(
            requestOptions.idempotencyKey === idempotencyKey,
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

      if (name === MANUAL_CLAIM) {
        guard(options.manual === true, "Onverwachte handmatige claim");
        guard(args.p_request_id === REQUEST, "Verkeerde claimopdracht");
        guard(args.p_lease_seconds === 300, "Verkeerde leaseduur");

        return { error: null, data: claim };
      }

      if (name === SELECT) {
        guard(!options.manual, "Selector gebruikt vanuit handmatige ingang");

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
        guard(
          args.p_source.purchaseId === PURCHASE,
          "Verkeerde prepareaankoop",
        );
        guard(
          args.p_source.paymentIntentId === PAYMENT,
          "Verkeerde preparebetaling",
        );
        guard(
          args.p_source.chargeId === CHARGE,
          "Verkeerde preparebron",
        );
        guard(
          args.p_destination.accountId === DESTINATION,
          "Verkeerde preparebestemming",
        );
        guard(
          args.p_destination.trainerId === TRAINER,
          "Verkeerde preparetrainer",
        );

        if (options.prepareError) {
          return {
            data: null,
            error: { code: "LOCAL_PREPARE_ERROR" },
          };
        }

        return {
          error: null,
          data: {
            request_id: REQUEST,
            booking_id: BOOKING,
            lock_token: TOKEN,
            stripe_idempotency_key: idempotencyKey,
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
            guard(filters.account_api === "accounts_v2", "Verkeerde account-API");
            guard(filters.status === "linked", "Verkeerde Connect-status");

            return {
              error: null,
              data: {
                id: ATTEMPT,
                stripe_livemode: false,
                stripe_request_payload: {
                  identity: { country: "NL" },
                  metadata: {
                    gowtrain_trainer_id: options.wrongConnectTrainer
                      ? "99999999-9999-4999-8999-999999999999"
                      : TRAINER,
                    gowtrain_connect_attempt_id: ATTEMPT,
                  },
                },
              },
            };
          }

          if (table === "trainer_transfer_requests") {
            if (
              options.manual &&
              !events.includes(MANUAL_CLAIM)
            ) {
              events.push("manual_request_read");
              guard(filters.id === REQUEST, "Verkeerde handmatige lookup");

              /*
               * Onafhankelijke database-uitgangstoestand.
               * Niet de eventueel gemanipuleerde claim teruggeven.
               */
              return {
                error: null,
                data: {
                  id: REQUEST,
                  booking_id: BOOKING,
                  source_package_purchase_id: PURCHASE,
                  trainer_id: TRAINER,
                  destination_account_id: DESTINATION,
                  amount_cents: AMOUNT,
                  currency: "eur",
                  stripe_livemode: false,
                  funds_flow: "separate_transfers_v1",
                },
              };
            }

            events.push("pre_send_read");
            guard(filters.id === REQUEST, "Verkeerde pre-sendopdracht");

            if (options.disableBeforeSend) {
              env.SANDBOX_TRAINER_TRANSFER_AUTOMATIC_ENABLED = "false";
            }

            return {
              error: null,
              data: {
                status: options.changedClaim
                  ? "review_required"
                  : "processing",
                lock_token: TOKEN,
                locked_until: lease,
                stripe_request_payload: payload,
                stripe_idempotency_key: idempotencyKey,
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
          guard(
            url === "https://database.example.invalid",
            "Verkeerde database",
          );
          guard(key === "LOCAL_SERVICE_ROLE", "Verkeerde databasekey");
          guard(
            settings.auth.persistSession === false,
            "Sessiepersistentie",
          );
          guard(
            settings.auth.autoRefreshToken === false,
            "Automatische tokenrefresh",
          );

          return database;
        },
      };
    }

    if (name === "@/lib/inspect-sandbox-transfer-history") {
      return {
        async inspectClaimedSandboxTransferHistory(input) {
          events.push("history");

          guard(input.lockToken === TOKEN, "Verkeerd historietoken");
          guard(input.expected.requestId === REQUEST, "Verkeerde historieopdracht");
          guard(input.expected.bookingId === BOOKING, "Verkeerde historieboeking");
          guard(input.expected.purchaseId === PURCHASE, "Verkeerde aankoop");
          guard(input.expected.amountCents === AMOUNT, "Verkeerd bedrag");
          guard(input.expected.trainerId === TRAINER, "Verkeerde historietrainer");
          guard(
            input.expected.destinationAccountId === DESTINATION,
            "Verkeerde historiebestemming",
          );
          guard(
            input.expected.paymentIntentId === PAYMENT,
            "Verkeerde historiebetaling",
          );

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
              paymentIntentId: PAYMENT,
              chargeId: CHARGE,
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
          guard(input.trainerId === TRAINER, "Verkeerde Connect-trainer");
          guard(input.attemptId === ATTEMPT, "Verkeerde Connect-poging");
          guard(input.country === "NL", "Verkeerd Connect-land");

          return {
            accountId: DESTINATION,
            trainerId: TRAINER,
            attemptId: ATTEMPT,
            livemode: false,
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
          guard(input.trainerId === TRAINER, "Verkeerde payloadtrainer");
          guard(input.destinationAccountId === DESTINATION, "Verkeerde payloadbestemming");
          guard(input.amountCents === AMOUNT, "Verkeerd payloadbedrag");
          guard(input.paymentIntentId === PAYMENT, "Verkeerde payloadbetaling");
          guard(input.sourceChargeId === CHARGE, "Verkeerde payloadbron");
          guard(input.currency === "eur", "Verkeerde payloadvaluta");
          guard(input.stripeLivemode === false, "Geen sandboxpayload");
          guard(
            input.fundsFlow === "separate_transfers_v1",
            "Verkeerde geldstroom",
          );

          return {
            payload,
            idempotencyKey,
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
            throw new Error(
              "TRAINER_TRANSFER_SYNC_APPLICATION_NOT_CONFIRMED",
            );
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
    console: {
      error() {},
      warn() {},
      log() {},
    },
  });

  new vm.Script(compiled, { filename }).runInContext(context);

  return {
    run() {
      return options.manual
        ? loadedModule.exports.executeSandboxTrainerTransfer(REQUEST)
        : loadedModule.exports.executeNextSandboxTrainerTransfer();
    },

    check(expectedEvents) {
      /*
       * Ook controleren wanneer productiecode een fout uit
       * een mock heeft opgevangen.
       */
      assert.deepEqual(violations, []);
      assert.deepEqual(events, expectedEvents);

      assert.ok(
        events.filter((event) => event === "create").length <= 1,
      );

      assert.equal(
        events.filter((event) => event === SELECT).length,
        options.manual ? 0 : 1,
      );

      assert.equal(
        events.filter((event) => event === MANUAL_CLAIM).length,
        options.manual ? 1 : 0,
      );
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
  await test(
    "Bevestigde automatische claim: één create, geen tweede claim",
    async () => {
      const h = harness();
      const result = await h.run();

      h.check([...BEFORE_CREATE, "create", "sync"]);
      assert.equal(result.result, "synchronized");
      assert.equal(result.requestId, BASE_FIXTURE.REQUEST);
      assert.equal(result.transferId, BASE_FIXTURE.TRANSFER);
      assert.equal(result.applicationResult, "applied");
    },
  );

  await test(
    "Tweede trainer gebruikt uitsluitend eigen context",
    async () => {
      /*
       * Volledig synthetische fixture.
       * Geen goedkeuring van de echte €72,20-kandidaat.
       */
      const fixture = {
        REQUEST: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        TOKEN: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ATTEMPT: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        BOOKING: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        PURCHASE: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        TRAINER: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        DESTINATION: "acct_SECONDTRAINERTEST",
        TRANSFER: "tr_SECONDTRAINERTEST",
        PAYMENT: "pi_SECONDTRAINERTEST",
        CHARGE: "py_SECONDTRAINERTEST",
        AMOUNT: 5700,
      };

      const h = harness({ fixture });
      const result = await h.run();

      h.check([...BEFORE_CREATE, "create", "sync"]);
      assert.equal(result.result, "synchronized");
      assert.equal(result.requestId, fixture.REQUEST);
      assert.equal(result.transferId, fixture.TRANSFER);
      assert.equal(result.applicationResult, "applied");
    },
  );

  await test(
    "Ongeldige bestemmingsreferentie geweigerd vóór onderzoek",
    async () => {
      const h = harness({
        claim: { destination_account_id: "geen-account-id" },
      });

      const result = await h.run();

      h.check([SELECT, REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_EXECUTION_CLAIM_CONTEXT_MISMATCH",
      );
      assert.equal(result.reviewRecorded, true);
    },
  );

  await test(
    "Ongeldige trainerreferentie geweigerd vóór onderzoek",
    async () => {
      const h = harness({
        claim: { trainer_id: "geen-uuid" },
      });

      const result = await h.run();

      h.check([SELECT, REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_EXECUTION_CLAIM_CONTEXT_MISMATCH",
      );
      assert.equal(result.reviewRecorded, true);
    },
  );

  await test(
    "Connect-payload van andere trainer weigeren",
    async () => {
      const h = harness({ wrongConnectTrainer: true });
      const result = await h.run();

      h.check([SELECT, "history", "connect_read", REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_EXECUTION_CONNECT_PAYLOAD_INVALID",
      );
    },
  );

  await test(
    "Handmatige claim blijft beperkt tot vaste trainer en bestemming",
    async () => {
      const manualFixture = {
        BOOKING: "1be93a44-2570-475c-a061-ea574b638258",
        PURCHASE: "0ceb3427-c520-4351-9cb4-e2fb9ea08069",
      };

      for (const changedClaim of [
        {
          trainer_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        },
        {
          destination_account_id: "acct_OTHERVALIDTEST",
        },
      ]) {
        const h = harness({
          manual: true,
          fixture: manualFixture,
          claim: changedClaim,
        });

        const result = await h.run();

        h.check([
          "manual_request_read",
          MANUAL_CLAIM,
          REVIEW,
        ]);

        assert.equal(result.result, "not_confirmed");
        assert.equal(
          result.diagnosticCode,
          "TRANSFER_EXECUTION_OUTSIDE_TEST_SCOPE",
        );
        assert.equal(result.reviewRecorded, true);
      }
    },
  );

  await test(
    "Geweigerde historie: geen prepare of create",
    async () => {
      const h = harness({ historyError: true });
      const result = await h.run();

      h.check([SELECT, "history", REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(result.stage, "inspect_claimed_history");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_HISTORY_TEST_REJECTED",
      );
    },
  );

  await test(
    "Onzekere prepare: geen payload teruglezen of verzenden",
    async () => {
      const h = harness({ prepareError: true });
      const result = await h.run();

      h.check([...BEFORE_PREPARE, PREPARE, REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_EXECUTION_PREPARE_NOT_CONFIRMED",
      );
      assert.equal(result.transferId, null);
    },
  );

  await test(
    "Gewijzigde claim bij pre-send: geen create",
    async () => {
      const h = harness({ changedClaim: true });
      const result = await h.run();

      h.check([...BEFORE_CREATE, REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_EXECUTION_PRE_SEND_CHECK_FAILED",
      );
    },
  );

  await test(
    "Lokale vlagcheck vóór verzending wordt gerespecteerd",
    async () => {
      const h = harness({ disableBeforeSend: true });
      const result = await h.run();

      h.check([...BEFORE_CREATE, REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_EXECUTION_DISABLED_AFTER_PREPARATION",
      );
    },
  );

  await test(
    "Stripe-timeout: één create, geen retry of sync",
    async () => {
      const h = harness({ createTimeout: true });
      const result = await h.run();

      h.check([...BEFORE_CREATE, "create", REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(result.stage, "stripe_create");
      assert.equal(
        result.diagnosticCode,
        "TRANSFER_EXECUTION_STRIPE_CONNECTION_ERROR",
      );
      assert.equal(result.transferId, null);
    },
  );

  await test(
    "Syncfout na create: transfer-ID behouden, niet herverzenden",
    async () => {
      const h = harness({
        syncError: true,
        reviewFalse: true,
      });

      const result = await h.run();

      h.check([...BEFORE_CREATE, "create", "sync", REVIEW]);
      assert.equal(result.result, "not_confirmed");
      assert.equal(result.stage, "synchronize");
      assert.equal(
        result.diagnosticCode,
        "TRAINER_TRANSFER_SYNC_APPLICATION_NOT_CONFIRMED",
      );
      assert.equal(result.transferId, BASE_FIXTURE.TRANSFER);
      assert.equal(result.reviewRecorded, false);
    },
  );

  console.log(
    `\nALLE ${passed} UITVOERINGSTESTS GESLAAGD. ` +
      "Geen echte Stripe- of databaseaanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("TEST MISLUKT:", error);
  process.exitCode = 1;
});