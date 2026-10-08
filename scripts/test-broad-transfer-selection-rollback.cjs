const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Client } = require("pg");

const BLOCKED = {
  booking: "0624e05a-66c4-4e2c-9339-505a1929fc46",
  purchase: "d328e28a-30c8-4c93-a3ea-7a66b52025b3",
  trainer: "4e9d8172-8da7-4b7e-ad80-8d7afcbc1747",
  amount: 7220,
};

const ELIGIBLE = {
  booking: "33afa185-f6e4-4bae-b9bf-7a20d1db44e1",
  purchase: "4e54c469-299a-4fa6-a61f-3f8a61bc2f57",
  trainer: "4c4a5ffc-7584-4ffb-9678-95d3a311c50e",
  destination: "acct_1UHJRCBAMjpV6Qwm",
  amount: 1900,
};

const BOOKINGS = [BLOCKED.booking, ELIGIBLE.booking];

// Ook de aankopen van de drie eerdere transfers meenemen.
const PURCHASES = [
  BLOCKED.purchase,
  ELIGIBLE.purchase,
  "0ceb3427-c520-4351-9cb4-e2fb9ea08069",
  "c02e8212-9379-4f3f-8edd-023dea74910a",
];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeClient() {
  const client = new Client({
    host: "aws-1-eu-west-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.ucrfaksziviflxvhepjk",
    password: process.env.RECOVERY_TEST_DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    query_timeout: 35_000,
    application_name: "broad-transfer-selection-rollback-test",
  });

  client.on("error", () => {});
  return client;
}

/*
 * Alleen hashes komen naar Node:
 * - alle boekingen binnen de vier betrokken aankopen;
 * - de vier aankopen;
 * - alle transferopdrachten en selectieplanningen.
 *
 * Een gelijktijdige wijziging door een andere worker kan de
 * nacontrole laten stoppen. Dat is geen reden om data te verwijderen.
 */
async function snapshot(client) {
  const { rows } = await client.query(
    `
      SELECT
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'hash', md5(to_jsonb(b)::text)
              ) ORDER BY b.id
            ),
            '[]'::jsonb
          )
          FROM public.bookings b
          WHERE b.package_purchase_id = ANY($1::uuid[])
        ) AS bookings,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'hash', md5(to_jsonb(p)::text)
              ) ORDER BY p.id
            ),
            '[]'::jsonb
          )
          FROM public.package_purchases p
          WHERE p.id = ANY($1::uuid[])
        ) AS purchases,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'hash', md5(to_jsonb(r)::text)
              ) ORDER BY r.id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_requests r
        ) AS requests,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', s.booking_id,
                'hash', md5(to_jsonb(s)::text)
              ) ORDER BY s.booking_id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_execution_schedule s
        ) AS schedules
    `,
    [PURCHASES],
  );

  return rows[0];
}

async function preflight(client) {
  const { rows: jobs } = await client.query(`
    SELECT jobid, active
    FROM cron.job
    WHERE jobid IN (3, 11, 15)
    ORDER BY jobid
  `);

  assert.deepEqual(
    jobs.map((j) => [Number(j.jobid), j.active]),
    [[3, false], [11, true], [15, false]],
  );

  /*
   * Conservatief: exact twee verschuldigde basiskandidaten.
   * Voor deze proef mogen zij nog geen opdracht/planning hebben.
   */
  const { rows } = await client.query(`
    SELECT
      b.id AS booking,
      b.package_purchase_id AS purchase,
      b.trainer_id AS trainer,
      b.trainer_net_amount_cents AS amount,
      b.trainer_payout_status,
      p.paid_at IS NOT NULL AS purchase_paid,
      EXISTS (
        SELECT 1
        FROM public.trainer_transfer_requests r
        WHERE r.booking_id = b.id
      ) AS has_request,
      EXISTS (
        SELECT 1
        FROM public.trainer_transfer_execution_schedule s
        WHERE s.booking_id = b.id
      ) AS has_schedule
    FROM public.bookings b
    JOIN public.package_purchases p ON p.id = b.package_purchase_id
    WHERE p.trainer_id = b.trainer_id
      AND p.stripe_livemode = false
      AND p.funds_flow = 'separate_transfers_v1'
      AND b.status IN ('confirmed', 'completed')
      AND b.paid_at IS NOT NULL
      AND b.trainer_payout_status IN ('pending', 'eligible')
      AND b.trainer_net_amount_cents > 0
      AND b.stripe_transfer_id IS NULL
      AND b.trainer_paid_at IS NULL
      AND isfinite(b.trainer_payout_eligible_at)
      AND b.trainer_payout_eligible_at <= clock_timestamp()
    ORDER BY b.trainer_payout_eligible_at, b.id
  `);

  assert.deepEqual(
    rows,
    [BLOCKED, ELIGIBLE].map((item) => ({
      booking: item.booking,
      purchase: item.purchase,
      trainer: item.trainer,
      amount: item.amount,
      trainer_payout_status: "pending",
      purchase_paid: true,
      has_request: false,
      has_schedule: false,
    })),
  );
}

async function verifySelection(client, result) {
  assert.equal(result.result, "claimed");
  assert.equal(result.considered, 2);
  assert.equal(result.deferred, 1);
  assert.equal(result.busy, 0);

  const claim = result.claim;
  assert.ok(claim);
  assert.equal(claim.booking_id, ELIGIBLE.booking);
  assert.equal(claim.source_package_purchase_id, ELIGIBLE.purchase);
  assert.equal(claim.trainer_id, ELIGIBLE.trainer);
  assert.equal(claim.destination_account_id, ELIGIBLE.destination);
  assert.equal(claim.amount_cents, ELIGIBLE.amount);
  assert.equal(claim.currency, "eur");
  assert.equal(claim.stripe_livemode, false);
  assert.equal(claim.funds_flow, "separate_transfers_v1");
  assert.equal(claim.attempts, 1);
  assert.match(claim.request_id, UUID);
  assert.match(claim.lock_token, UUID);
  assert.equal(
    claim.stripe_idempotency_key,
    "gowtrain-trainer-transfer/" + claim.request_id,
  );

  const { rows: requests } = await client.query(
    `
      SELECT
        r.id,
        r.booking_id,
        r.trainer_id,
        r.source_package_purchase_id,
        r.destination_account_id,
        r.amount_cents,
        r.status,
        r.attempts,
        r.first_stripe_request_at,
        r.stripe_request_payload IS NULL AS payload_absent,
        r.stripe_transfer_id,
        r.succeeded_at,
        r.applied_at,
        (
          r.lock_token = $2::uuid
          AND isfinite(r.locked_until)
          AND r.locked_until > clock_timestamp()
        ) AS lease_valid
      FROM public.trainer_transfer_requests r
      WHERE r.booking_id = ANY($1::uuid[])
      ORDER BY r.id
    `,
    [BOOKINGS, claim.lock_token],
  );

  assert.deepEqual(requests, [{
    id: claim.request_id,
    booking_id: ELIGIBLE.booking,
    trainer_id: ELIGIBLE.trainer,
    source_package_purchase_id: ELIGIBLE.purchase,
    destination_account_id: ELIGIBLE.destination,
    amount_cents: ELIGIBLE.amount,
    status: "processing",
    attempts: 1,
    first_stripe_request_at: null,
    payload_absent: true,
    stripe_transfer_id: null,
    succeeded_at: null,
    applied_at: null,
    lease_valid: true,
  }]);

  const { rows: bookings } = await client.query(
    `
      SELECT id, trainer_payout_status,
             stripe_transfer_id, trainer_paid_at
      FROM public.bookings
      WHERE id = ANY($1::uuid[])
      ORDER BY id
    `,
    [BOOKINGS],
  );

  assert.deepEqual(bookings, [
    {
      id: BLOCKED.booking,
      trainer_payout_status: "pending",
      stripe_transfer_id: null,
      trainer_paid_at: null,
    },
    {
      id: ELIGIBLE.booking,
      trainer_payout_status: "processing",
      stripe_transfer_id: null,
      trainer_paid_at: null,
    },
  ]);

  const { rows: schedules } = await client.query(
    `
      SELECT
        booking_id,
        last_error_code,
        consecutive_failures,
        (
          last_checked_at IS NOT NULL
          AND isfinite(last_checked_at)
          AND last_checked_at <= clock_timestamp()
          AND next_check_at = last_checked_at + interval '15 minutes'
          AND next_check_at > clock_timestamp()
        ) AS timing_valid
      FROM public.trainer_transfer_execution_schedule
      WHERE booking_id = ANY($1::uuid[])
      ORDER BY booking_id
    `,
    [BOOKINGS],
  );

  assert.deepEqual(schedules, [
    {
      booking_id: BLOCKED.booking,
      last_error_code: "TRANSFER_PURCHASE_REFUND_REQUIRES_REVIEW",
      consecutive_failures: 1,
      timing_valid: true,
    },
    {
      booking_id: ELIGIBLE.booking,
      last_error_code: null,
      consecutive_failures: 0,
      timing_valid: true,
    },
  ]);
}

function safeCode(error) {
  const code = error?.code || error?.message;
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)
    ? code
    : "BROAD_SELECTION_TEST_FAILED";
}

async function main() {
  if (
    process.env.SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED !== "false" ||
    process.env.SANDBOX_TRAINER_TRANSFER_AUTOMATIC_ENABLED !== "false"
  ) {
    throw new Error("LOCAL_EXECUTION_FLAGS_MUST_BE_FALSE");
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

  const client = makeClient();
  let connected = false;
  let transactionStarted = false;
  let before = null;
  let failure = null;
  let stage = "CONNECT";

  try {
    await client.connect();
    connected = true;

    await client.query("SET statement_timeout = '30s'");
    await client.query("SET lock_timeout = '3s'");
    await client.query("SET idle_in_transaction_session_timeout = '60s'");

    stage = "BEGIN";
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    transactionStarted = true;

    stage = "PREFLIGHT";
    await preflight(client);

    before = await snapshot(client);
    assert.equal(before.purchases.length, 4);

    console.log("OK: veilige cronstand en exact twee verwachte kandidaten.");

    stage = "SELECTOR";
    const { rows } = await client.query(`
      SELECT public.claim_next_sandbox_trainer_transfer() AS result
    `);

    stage = "VERIFY_SELECTION";
    await verifySelection(client, rows[0].result);

    console.log(
      "OK: considered=2, deferred=1, busy=0; trainer B uitgesteld; " +
      "trainer A geclaimd voor 1900 cent.",
    );
    console.log(
      "OK: alleen een ongecommitteerde databaseclaim; " +
      "geen voorbereiding of transferresultaat.",
    );
  } catch (error) {
    failure = error;
    console.error("GESTOPT BIJ: " + stage);
  } finally {
    let rollbackConfirmed = !transactionStarted;

    if (connected && transactionStarted) {
      try {
        await client.query("ROLLBACK");
        rollbackConfirmed = true;
        console.log("OK: ROLLBACK bevestigd.");
      } catch {
        failure = failure || new Error("ROLLBACK_NOT_CONFIRMED");
        console.error("STOP: ROLLBACK NIET BEVESTIGD.");
      }
    }

    if (connected && before && rollbackConfirmed) {
      try {
        const after = await snapshot(client);
        assert.deepEqual(after, before);
        console.log(
          "OK: nacontrole na rollback exact gelijk aan de nulmeting; " +
          "geen nieuwe opdracht of planning achtergebleven.",
        );
      } catch {
        failure = failure || new Error("FINAL_STATE_NOT_CONFIRMED");
        console.error(
          "STOP: NACONTROLE NIET BEVESTIGD. " +
          "Geen verwijderingen of herverzendingen uitvoeren.",
        );
      }
    }

    if (connected) {
      try {
        await client.end();
      } catch {
        failure = failure || new Error("CONNECTION_CLOSE_FAILED");
      }
    }
  }

  if (failure) throw failure;

  console.log(
    "BREDE SELECTIETEST GESLAAGD. " +
    "Alle testwrites teruggedraaid. Geen Stripe-aanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("TEST GESTOPT: " + safeCode(error));
  process.exitCode = 1;
});