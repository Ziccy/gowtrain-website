const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const BOOKING = "a38c7201-6f4b-4d9e-8a21-470ef58d6301";
const REQUEST = "a38c7202-6f4b-4d9e-8a21-470ef58d6302";
const TRAINER = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";
const PURCHASE = "0ceb3427-c520-4351-9cb4-e2fb9ea08069";
const REFERENCE = "38ec163f-1804-4ddc-9088-2bc2029fb122";
const PAID_BOOKING = "b7d8c195-2f03-428e-bbdb-8e7bf65f76db";

const cleanupSql = fs.readFileSync(
  path.join(__dirname, "cleanup-transfer-recovery-concurrency.sql"),
  "utf8",
);

function makeClient() {
  const client = new Client({
    host: "aws-1-eu-west-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.ucrfaksziviflxvhepjk",
    password: process.env.RECOVERY_TEST_DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    application_name: "recovery-concurrency-fixture-test",
  });

  client.on("error", () => {});
  return client;
}

async function configure(client) {
  await client.query("SET statement_timeout = '10s'");
  await client.query("SET lock_timeout = '3s'");
}

async function snapshot(client) {
  const { rows } = await client.query(
    `
      SELECT
        (
          SELECT to_jsonb(r)
          FROM public.trainer_transfer_requests r
          WHERE r.id = $1
        ) AS request,
        (
          SELECT to_jsonb(p)
          FROM public.package_purchases p
          WHERE p.id = $2
        ) AS purchase,
        (
          SELECT to_jsonb(b)
          FROM public.bookings b
          WHERE b.id = $3
        ) AS booking,
        (
          SELECT COALESCE(
            jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb
          )
          FROM public.trainer_transfer_recovery_checks c
          WHERE c.request_id = $1
        ) AS checks
    `,
    [REFERENCE, PURCHASE, PAID_BOOKING],
  );

  return rows[0];
}

async function fixtureRequest(client) {
  const { rows } = await client.query(
    `SELECT to_jsonb(r) AS value
     FROM public.trainer_transfer_requests r
     WHERE r.id = $1`,
    [REQUEST],
  );

  assert.equal(rows.length, 1);
  return rows[0].value;
}

async function fixtureCheck(client, checkId) {
  const { rows } = await client.query(
    `SELECT to_jsonb(c) AS value
     FROM public.trainer_transfer_recovery_checks c
     WHERE c.id = $1 AND c.request_id = $2`,
    [checkId, REQUEST],
  );

  assert.equal(rows.length, 1);
  return rows[0].value;
}

/*
 * Alle B-selecties draaien in een eigen transactie die wordt
 * teruggedraaid. Ook een onverwacht geselecteerde andere opdracht
 * krijgt hierdoor geen duurzaam onderzoek.
 */
async function expectNoSelection(client, kind) {
  await client.query("BEGIN");
  try {
    const sql =
      kind === "start"
        ? `SELECT public.start_next_sandbox_transfer_recovery_check()
             AS result`
        : `SELECT public.expire_next_sandbox_transfer_recovery_check()
             AS result`;

    const { rows } = await client.query(sql);
    assert.equal(rows[0].result, null);
  } finally {
    await client.query("ROLLBACK");
  }
}

function safeCode(error) {
  const value = error?.code || error?.message;
  return typeof value === "string" &&
    /^[A-Z0-9_]{1,80}$/.test(value)
    ? value
    : "CONCURRENCY_TEST_FAILED";
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

  const a = makeClient();
  const b = makeClient();
  let cleanupNeeded = false;
  let before;
  let failure = null;

  try {
    await a.connect();
    await b.connect();
    await configure(a);
    await configure(b);

    /*
     * Korte setuptransactie.
     * Tabel-locks worden vóór de concurrencytest vrijgegeven.
     */
    await a.query("BEGIN");

    await a.query(`
      LOCK TABLE public.trainer_transfer_requests
      IN SHARE ROW EXCLUSIVE MODE NOWAIT
    `);
    await a.query(`
      LOCK TABLE public.trainer_transfer_recovery_checks
      IN SHARE ROW EXCLUSIVE MODE NOWAIT
    `);

    const { rows: safety } = await a.query(
      `
        SELECT
          EXISTS (
            SELECT 1
            FROM public.trainer_transfer_requests
            WHERE id = $1
          ) OR EXISTS (
            SELECT 1 FROM public.bookings WHERE id = $2
          ) OR EXISTS (
            SELECT 1
            FROM public.trainer_transfer_recovery_checks
            WHERE request_id = $1
          ) AS collision,

          EXISTS (
            SELECT 1
            FROM public.trainer_transfer_requests r
            WHERE r.stripe_livemode = false
              AND r.funds_flow = 'separate_transfers_v1'
              AND r.source_package_purchase_id IS NOT NULL
              AND (
                r.status IN ('queued', 'processing', 'review_required')
                OR (r.status = 'succeeded' AND r.applied_at IS NULL)
              )
          ) AS unsettled,

          EXISTS (
            SELECT 1
            FROM public.trainer_transfer_recovery_checks c
            JOIN public.trainer_transfer_requests r ON r.id = c.request_id
            WHERE r.stripe_livemode = false
              AND r.funds_flow = 'separate_transfers_v1'
              AND r.source_package_purchase_id IS NOT NULL
              AND c.status = 'running'
          ) AS running
      `,
      [REQUEST, BOOKING],
    );

    assert.equal(safety[0].collision, false);
    assert.equal(safety[0].unsettled, false);
    assert.equal(safety[0].running, false);

    before = await snapshot(a);

    assert.ok(before.request);
    assert.ok(before.purchase);
    assert.ok(before.booking);

    assert.equal(before.request.status, "succeeded");
    assert.equal(before.request.stripe_livemode, false);
    assert.equal(before.request.funds_flow, "separate_transfers_v1");
    assert.equal(before.request.source_package_purchase_id, PURCHASE);
    assert.equal(before.request.booking_id, PAID_BOOKING);
    assert.equal(before.request.trainer_id, TRAINER);
    assert.equal(
      before.request.stripe_transfer_id,
      "tr_3UHkrGBAMjPSbTYm0YqurCIW",
    );
    assert.ok(before.request.succeeded_at);
    assert.ok(before.request.applied_at);

    assert.equal(before.purchase.stripe_livemode, false);
    assert.equal(before.purchase.funds_flow, "separate_transfers_v1");
    assert.equal(before.purchase.trainer_id, TRAINER);
    assert.equal(
      before.purchase.stripe_payment_intent_id,
      before.request.stripe_payment_intent_id,
    );

    assert.equal(before.booking.package_purchase_id, PURCHASE);
    assert.equal(before.booking.trainer_payout_status, "paid");
    assert.equal(
      before.booking.stripe_transfer_id,
      before.request.stripe_transfer_id,
    );

    /*
     * Vanaf hier altijd opruiming proberen, ook wanneer de
     * COMMIT-response straks onzeker is.
     * Vooraf bestaande fixtures worden nooit overgenomen.
     */
    cleanupNeeded = true;

    await a.query(
      `
        INSERT INTO public.bookings (
          id, trainer_id, player_name, player_email, status,
          package_purchase_id, participant_count,
          total_price_cents, currency, commission_rate_bps,
          commission_amount_cents, trainer_net_amount_cents,
          trainer_payout_status
        )
        VALUES (
          $1, $2,
          'RECOVERY_CONCURRENCY_FIXTURE',
          'recovery-concurrency@example.invalid',
          'payment_pending', $3, 1,
          2000, 'eur', 500, 100, 1900, 'processing'
        )
      `,
      [BOOKING, TRAINER, PURCHASE],
    );

    await a.query(
      `
        INSERT INTO public.trainer_transfer_requests (
          id, booking_id, trainer_id, source_package_purchase_id,
          amount_cents, currency, destination_account_id,
          stripe_payment_intent_id, stripe_livemode, funds_flow,
          eligible_at, status, stripe_idempotency_key,
          next_reconciliation_at
        )
        VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1900, 'eur',
          'acct_RECOVERYCONCURRENCYTEST',
          'pi_RECOVERYCONCURRENCYTEST',
          false, 'separate_transfers_v1',
          clock_timestamp(), 'review_required',
          'gowtrain-trainer-transfer/' || ($1::uuid)::text,
          clock_timestamp() - interval '1 hour'
        )
      `,
      [REQUEST, BOOKING, TRAINER, PURCHASE],
    );

    await a.query("COMMIT");

    console.log("SETUP: uitsluitend de herkenbare fixture gecommit.");

    const requestBefore = await fixtureRequest(a);

    /*
     * A start en houdt de transactie/rijlock open.
     * B moet in een andere backend de fixture kunnen lezen,
     * maar de gelockte kandidaat overslaan.
     */
    await a.query("BEGIN");
    await b.query("BEGIN");

    const pidA = (await a.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const pidB = (await b.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    assert.notEqual(pidA, pidB);

    await b.query("ROLLBACK");

    const start = await a.query(`
      SELECT public.start_next_sandbox_transfer_recovery_check()
      AS result
    `);

    const started = start.rows[0].result;
    assert.ok(started);
    assert.equal(started.request_id, REQUEST);
    assert.match(
      started.check_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const checkId = started.check_id;

    // Fixture is zichtbaar in B: geen test op een onzichtbare insert.
    assert.deepEqual(await fixtureRequest(b), requestBefore);

    await expectNoSelection(b, "start");
    console.log("GESLAAGD 1: B slaat de door A gelockte kandidaat over.");

    await a.query("COMMIT");

    const running = await fixtureCheck(b, checkId);
    assert.equal(running.status, "running");

    await expectNoSelection(b, "start");

    const count = await b.query(
      `SELECT count(*)::integer AS count
       FROM public.trainer_transfer_recovery_checks
       WHERE request_id = $1`,
      [REQUEST],
    );
    assert.equal(count.rows[0].count, 1);
    assert.deepEqual(await fixtureRequest(b), requestBefore);

    console.log("GESLAAGD 2: na commit geen dubbele onderzoeksstart.");

    /*
     * Alleen het eigen fixtureonderzoek ouder maken.
     * Deze wijziging committen zodat B het oude onderzoek kan zien.
     */
    await a.query("BEGIN");

    await a.query(
      `SELECT id FROM public.trainer_transfer_requests
       WHERE id = $1 FOR UPDATE`,
      [REQUEST],
    );

    const aged = await a.query(
      `UPDATE public.trainer_transfer_recovery_checks
       SET started_at = clock_timestamp() - interval '16 minutes'
       WHERE id = $1 AND request_id = $2 AND status = 'running'`,
      [checkId, REQUEST],
    );
    assert.equal(aged.rowCount, 1);
    await a.query("COMMIT");

    await a.query("BEGIN");

    const expiry = await a.query(`
      SELECT public.expire_next_sandbox_transfer_recovery_check()
      AS result
    `);

    assert.deepEqual(expiry.rows[0].result, {
      request_id: REQUEST,
      check_id: checkId,
      result: "expired",
    });

    /*
     * B ziet nog de gecommitteerde running-versie,
     * maar moet de opdrachtlock van A respecteren.
     */
    assert.equal((await fixtureCheck(b, checkId)).status, "running");

    await expectNoSelection(b, "expire");
    console.log("GESLAAGD 3: B slaat de gelockte timeoutkandidaat over.");

    await a.query("COMMIT");

    const expired = await fixtureCheck(b, checkId);
    assert.equal(expired.status, "failed");
    assert.equal(
      expired.error_code,
      "TRANSFER_RECOVERY_CHECK_TIMED_OUT",
    );

    await expectNoSelection(b, "expire");
    await expectNoSelection(b, "start");

    const scheduled = await fixtureRequest(b);

    assert.equal(
      scheduled.reconciliation_last_error,
      "TRANSFER_RECOVERY_CHECK_TIMED_OUT",
    );

    const timing = await b.query(
      `SELECT next_reconciliation_at > clock_timestamp() AS future
       FROM public.trainer_transfer_requests WHERE id = $1`,
      [REQUEST],
    );
    assert.equal(timing.rows[0].future, true);

    console.log(
      "GESLAAGD 4: timeout niet herhaald; vervolgplanning gerespecteerd.",
    );

    // Late afsluiting mag niets overschrijven.
    const late = await b.query(
      `SELECT public.finish_and_schedule_sandbox_transfer_recovery_check(
        $1, 'unprepared_requires_review', NULL, NULL
      ) AS result`,
      [checkId],
    );

    assert.equal(late.rows[0].result, false);
    assert.deepEqual(await fixtureCheck(b, checkId), expired);
    assert.deepEqual(await fixtureRequest(b), scheduled);
    assert.deepEqual(await snapshot(b), before);

    console.log("GESLAAGD 5: late afsluiting geweigerd; referenties intact.");
  } catch (error) {
    failure = error;
  } finally {
    /*
     * Eerst beide testsessies beëindigen zodat hun transacties
     * niet de aparte opruimverbinding blokkeren.
     */
    for (const client of [a, b]) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Bij een verbroken verbinding sluit end de client af.
      }
      try {
        await client.end();
      } catch {
        // Zelfstandige cleanup hieronder blijft noodzakelijk.
      }
    }

    if (cleanupNeeded) {
      const cleaner = makeClient();

      try {
        await cleaner.connect();
        await configure(cleaner);

        const response = await cleaner.query(cleanupSql);
        const results = Array.isArray(response) ? response : [response];
        const last = results[results.length - 1].rows[0];

        assert.equal(last.fixture_booking_absent, true);
        assert.equal(last.fixture_request_absent, true);
        assert.equal(last.fixture_checks_absent, true);

        assert.deepEqual(await snapshot(cleaner), before);

        console.log(
          "OPRUIMING GESLAAGD: alle fixtures afwezig; " +
            "bestaande opdracht, aankoop, boeking en historie ongewijzigd.",
        );
      } catch (error) {
        console.error(
          "OPRUIMING/NACONTROLE NIET BEVESTIGD: " + safeCode(error),
        );
        console.error(
          "Stop. Gebruik het zelfstandige opruimscript in Supabase " +
            "en controleer de drie afwezigheidsresultaten.",
        );
        failure = failure || new Error("CLEANUP_NOT_CONFIRMED");
      } finally {
        try {
          await cleaner.end();
        } catch {}
      }
    }
  }

  if (failure) throw failure;

  console.log(
    "\nCONCURRENTIETEST GESLAAGD. Geen Stripe-aanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  // Geen foutobjecten met querywaarden of verbindingsgegevens loggen.
  console.error("TEST GESTOPT: " + safeCode(error));
  process.exitCode = 1;
});