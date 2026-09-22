const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const moduleCache = new Map();

/*
 * Laad uitsluitend lokale TypeScript-helpers.
 *
 * Geen .env laden.
 * Geen Stripe-client aanmaken.
 * Geen Supabase-client aanmaken.
 * Onverwachte imports worden geweigerd.
 */
function loadTs(filename) {
  const resolved = path.resolve(filename);

  if (moduleCache.has(resolved)) {
    return moduleCache.get(resolved).exports;
  }

  const source = fs.readFileSync(resolved, "utf8");

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: resolved,
  }).outputText;

  const loadedModule = { exports: {} };
  moduleCache.set(resolved, loadedModule);

  function testRequire(name) {
    if (name === "server-only") return {};
    if (name === "node:util") return require("node:util");

    if (name.startsWith("@/lib/")) {
      return loadTs(path.join(root, name.slice(2) + ".ts"));
    }

    throw new Error(`Niet toegestane import in deze test: ${name}`);
  }

  const execute = vm.runInThisContext(
    `(function(require, module, exports) {\n${compiled}\n})`,
    { filename: resolved },
  );

  execute(testRequire, loadedModule, loadedModule.exports);

  return loadedModule.exports;
}

const { buildTrainerTransferPayload } = loadTs(
  path.join(root, "lib/stripe-trainer-transfer-payload.ts"),
);

const { separateClaimedTransferHistory } = loadTs(
  path.join(root, "lib/separate-claimed-transfer-history.ts"),
);

const { findSandboxTrainerTransfer } = loadTs(
  path.join(root, "lib/find-sandbox-trainer-transfer.ts"),
);

const TRAINER = "11111111-1111-4111-8111-111111111111";
const PURCHASE = "22222222-2222-4222-8222-222222222222";
const CURRENT_REQUEST = "33333333-3333-4333-8333-333333333333";
const CURRENT_BOOKING = "44444444-4444-4444-8444-444444444444";
const PRIOR_REQUEST = "55555555-5555-4555-8555-555555555555";
const PRIOR_BOOKING = "66666666-6666-4666-8666-666666666666";

const DESTINATION = "acct_TESTONLY";
const CHARGE = "py_TESTONLY";
const PAYMENT = "pi_TESTONLY";

const currentExpected = {
  requestId: CURRENT_REQUEST,
  bookingId: CURRENT_BOOKING,
  trainerId: TRAINER,
  packagePurchaseId: PURCHASE,
  amountCents: 1900,
  currency: "eur",
  destinationAccountId: DESTINATION,
  sourceChargeId: CHARGE,
  paymentIntentId: PAYMENT,
  stripeLivemode: false,
  fundsFlow: "separate_transfers_v1",
};

const priorExpected = {
  ...currentExpected,
  requestId: PRIOR_REQUEST,
  bookingId: PRIOR_BOOKING,
};

const currentBuilt = buildTrainerTransferPayload(currentExpected);
const priorBuilt = buildTrainerTransferPayload(priorExpected);

function makeTransfer(id, built) {
  return {
    id,
    object: "transfer",
    amount: built.payload.amount,
    currency: built.payload.currency,
    destination: built.payload.destination,
    source_transaction: built.payload.source_transaction,
    transfer_group: built.payload.transfer_group,
    metadata: { ...built.payload.metadata },
    livemode: false,
    amount_reversed: 0,
    reversed: false,
    reversals: {
      object: "list",
      data: [],
      has_more: false,
      url: `/v1/transfers/${id}/reversals`,
    },
    created: 1790022990,
  };
}

const priorTransfer = makeTransfer("tr_PRIORTEST", priorBuilt);
const currentTransfer = makeTransfer("tr_CURRENTTEST", currentBuilt);

/*
 * Gesimuleerde Stripe-interface.
 * Er bestaat bewust geen transfers.create-methode.
 * Iedere andere onverwachte API-aanroep faalt.
 *
 * Eén transfer per pagina om paginering daadwerkelijk te testen.
 */
function fakeStripe(transfers) {
  const calls = { list: 0, retrieve: 0 };

  const stripe = {
    transfers: {
      async list(params) {
        calls.list++;

        let start = 0;

        if (params.starting_after) {
          const cursor = transfers.findIndex(
            (item) => item.id === params.starting_after,
          );

          assert.notEqual(cursor, -1, "Onbekende paginacursor");
          start = cursor + 1;
        }

        const data = transfers.slice(start, start + 1);

        return {
          data: structuredClone(data),
          has_more: start + data.length < transfers.length,
        };
      },

      async retrieve(id) {
        calls.retrieve++;

        const transfer = transfers.find((item) => item.id === id);
        assert.ok(transfer, "Retrieve van onbekende transfer");

        return structuredClone(transfer);
      },
    },
  };

  return { stripe, calls };
}

function searchInput(knownTransferId = null) {
  return {
    expected: currentExpected,
    storedPayload: currentBuilt.payload,
    storedIdempotencyKey: currentBuilt.idempotencyKey,
    knownTransferId,
  };
}

function claimFixture() {
  const checkedAt = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + 300_000).toISOString();

  const priorRow = {
    request: {
      id: PRIOR_REQUEST,
      status: "succeeded",
    },
  };

  const ownRow = {
    request: {
      id: CURRENT_REQUEST,
      booking_id: CURRENT_BOOKING,
      trainer_id: TRAINER,
      source_package_purchase_id: PURCHASE,
      destination_account_id: DESTINATION,
      stripe_payment_intent_id: PAYMENT,
      amount_cents: 1900,
      currency: "eur",
      stripe_livemode: false,
      funds_flow: "separate_transfers_v1",
      status: "processing",
      attempts: 1,
      has_lock_token: true,
      locked_until: lockedUntil,
      stripe_idempotency_key: currentBuilt.idempotencyKey,
      first_stripe_request_at: null,
      stripe_request_payload: null,
      stripe_transfer_id: null,
      succeeded_at: null,
      applied_at: null,
      stripe_source_charge_id: null,
    },
    booking: {
      id: CURRENT_BOOKING,
      trainer_id: TRAINER,
      package_purchase_id: PURCHASE,
      trainer_net_amount_cents: 1900,
      currency: "eur",
      trainer_payout_status: "processing",
      stripe_transfer_id: null,
      trainer_paid_at: null,
    },
    purchase: {
      id: PURCHASE,
      trainer_id: TRAINER,
      stripe_payment_intent_id: PAYMENT,
      stripe_livemode: false,
      funds_flow: "separate_transfers_v1",
      currency: "eur",
    },
  };

  return {
    expected: {
      requestId: CURRENT_REQUEST,
      bookingId: CURRENT_BOOKING,
      purchaseId: PURCHASE,
      trainerId: TRAINER,
      destinationAccountId: DESTINATION,
      paymentIntentId: PAYMENT,
      amountCents: 1900,
    },
    claimedResponse: {
      claim_verified: true,
      request_id: CURRENT_REQUEST,
      booking_id: CURRENT_BOOKING,
      purchase_id: PURCHASE,
      destination_account_id: DESTINATION,
      checked_at: checkedAt,
      locked_until: lockedUntil,
      history: {
        purchase_id: PURCHASE,
        trainer_id: TRAINER,
        payment_intent_id: PAYMENT,
        source_charge_id: CHARGE,
        destination_account_id: DESTINATION,
        stripe_livemode: false,
        request_count: 2,
        requests: [priorRow, ownRow],
        orphan_bookings: [],
      },
    },
    inspection: {
      scanCompleted: true,
      checkedAt,
      finishedAt: checkedAt,
      scannedTransferCount: 1,
      sourceChargeId: CHARGE,
      destinationAccountId: DESTINATION,
      sourceTransferCount: 1,
      destinationTransferCount: 1,
      destinationTransfersWithoutSourceCount: 0,
      relevantTransfers: [
        {
          transferId: priorTransfer.id,
          destinationAccountId: DESTINATION,
          sourceChargeId: CHARGE,
          amountCents: 1900,
          amountReversedCents: 0,
          currency: "eur",
          fullyReversed: false,
          created: priorTransfer.created,
          transferGroup: priorTransfer.transfer_group,
          matchesSourceCharge: true,
          matchesDestination: true,
          livemode: false,
          metadata: { ...priorTransfer.metadata },
          hasReversalRecords: false,
        },
      ],
    },
  };
}

let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log(`GESLAAGD ${passed}: ${name}`);
}

async function expectSearchError(transfers, code, knownId = null) {
  const fake = fakeStripe(transfers);

  await assert.rejects(
    () => findSandboxTrainerTransfer(fake.stripe, searchInput(knownId)),
    (error) => error instanceof Error && error.message === code,
  );
}

async function main() {
  await test("Alleen de eigen claim wordt apart gezet", () => {
    const fixture = claimFixture();
    const before = structuredClone(fixture);

    const result = separateClaimedTransferHistory(fixture);

    assert.equal(result.currentRequestId, CURRENT_REQUEST);
    assert.equal(result.historyWithoutCurrentClaim.request_count, 1);
    assert.deepEqual(
      result.historyWithoutCurrentClaim.requests,
      [fixture.claimedResponse.history.requests[0]],
    );

    // De oorspronkelijke invoer mag niet worden aangepast.
    assert.deepEqual(fixture, before);
  });

  await test("Een andere onzekere opdracht blijft in de historie", () => {
    const fixture = claimFixture();

    fixture.claimedResponse.history.requests[0].request.status =
      "review_required";

    const result = separateClaimedTransferHistory(fixture);

    assert.equal(
      result.historyWithoutCurrentClaim.requests[0].request.status,
      "review_required",
    );

    /*
     * Dit test alleen behoud door de separator.
     * De gedeelde volledige historievalidatie moet deze rij weigeren.
     */
  });

  await test("Eigen claim zonder tokenindicatie wordt geweigerd", () => {
    const fixture = claimFixture();
    fixture.claimedResponse.history.requests[1].request.has_lock_token =
      false;

    assert.throws(
      () => separateClaimedTransferHistory(fixture),
      /TRANSFER_HISTORY_OWN_CLAIM_INVALID/,
    );
  });

  await test("Stripe-resultaat voor de onvoorbereide eigen claim geweigerd", () => {
    const fixture = claimFixture();

    fixture.inspection.relevantTransfers[0].metadata = {
      ...currentBuilt.payload.metadata,
    };

    assert.throws(
      () => separateClaimedTransferHistory(fixture),
      /TRANSFER_HISTORY_OWN_CLAIM_ALREADY_SEEN_AT_STRIPE/,
    );
  });

  await test("Dubbele eigen claimrij wordt geweigerd", () => {
    const fixture = claimFixture();

    fixture.claimedResponse.history.requests.push(
      structuredClone(fixture.claimedResponse.history.requests[1]),
    );
    fixture.claimedResponse.history.request_count = 3;

    assert.throws(
      () => separateClaimedTransferHistory(fixture),
      /TRANSFER_HISTORY_OWN_CLAIM_NOT_UNIQUE/,
    );
  });

  await test("Herstel vindt eigen transfer naast eerdere lestransfer", async () => {
    const fake = fakeStripe([currentTransfer, priorTransfer]);

    const result = await findSandboxTrainerTransfer(
      fake.stripe,
      searchInput(),
    );

    assert.equal(result.result, "verified_match");
    assert.equal(result.verified.transferId, currentTransfer.id);
    assert.equal(result.scannedTransferCount, 2);
    assert.equal(result.otherSourceTransfers.length, 1);
    assert.equal(
      result.otherSourceTransfers[0].transferId,
      priorTransfer.id,
    );
    assert.equal(fake.calls.list, 2);
    assert.equal(fake.calls.retrieve, 1);
  });

  await test("Bekend transfer-ID doorloopt dezelfde zoekcontrole", async () => {
    const fake = fakeStripe([currentTransfer, priorTransfer]);

    const result = await findSandboxTrainerTransfer(
      fake.stripe,
      searchInput(currentTransfer.id),
    );

    assert.equal(result.result, "verified_match");
    assert.equal(result.verified.transferId, currentTransfer.id);
    assert.equal(fake.calls.list, 2);
    assert.equal(fake.calls.retrieve, 1);
  });

  await test("Alleen eerdere lestransfer: eigen resultaat niet gevonden", async () => {
    const fake = fakeStripe([priorTransfer]);

    const result = await findSandboxTrainerTransfer(
      fake.stripe,
      searchInput(),
    );

    assert.equal(result.result, "not_found_requires_review");
    assert.equal(result.otherSourceTransfers.length, 1);
    assert.equal(fake.calls.retrieve, 0);
  });

  await test("Dubbele opdrachtreferentie wordt geweigerd", async () => {
    const duplicate = {
      ...structuredClone(currentTransfer),
      id: "tr_DUPLICATETEST",
    };

    await expectSearchError(
      [currentTransfer, duplicate, priorTransfer],
      "TRANSFER_SEARCH_MULTIPLE_MATCHES_REQUIRE_REVIEW",
    );
  });

  await test("Andere transfer voor dezelfde boeking wordt geweigerd", async () => {
    const conflict = structuredClone(priorTransfer);
    conflict.metadata.gowtrain_booking_id = CURRENT_BOOKING;

    await expectSearchError(
      [currentTransfer, conflict],
      "TRANSFER_SEARCH_BOOKING_CONFLICT_REQUIRES_REVIEW",
    );
  });

  await test("Afwijkend bedrag op gevonden transfer wordt geweigerd", async () => {
    const wrongAmount = structuredClone(currentTransfer);
    wrongAmount.amount = 1901;

    await expectSearchError(
      [wrongAmount, priorTransfer],
      "TRAINER_TRANSFER_RESULT_AMOUNT_MISMATCH",
    );
  });

  await test("Reversal van eigen transfer wordt geweigerd", async () => {
    const reversed = structuredClone(currentTransfer);
    reversed.amount_reversed = 1900;
    reversed.reversed = true;

    await expectSearchError(
      [reversed, priorTransfer],
      "TRAINER_TRANSFER_REVERSAL_REQUIRES_REVIEW",
    );
  });

  await test("Ontbrekend bekend transfer-ID wordt niet als herstel gezien", async () => {
    await expectSearchError(
      [priorTransfer],
      "TRANSFER_SEARCH_KNOWN_RESULT_MISSING",
      currentTransfer.id,
    );
  });

  console.log(
    `\nALLE ${passed} TESTS GESLAAGD. Geen Stripe- of databaseaanroepen uitgevoerd.`,
  );
}

main().catch((error) => {
  console.error("\nTEST MISLUKT:", error);
  process.exitCode = 1;
});