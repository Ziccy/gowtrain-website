const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Client } = require("pg");

const BOOKING = "c413bd74-8c8f-4ba5-8f03-98430c08f905";
const PURCHASE = "c02e8212-9379-4f3f-8edd-023dea74910a";
const TRAINER = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";

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
    application_name: "automatic-transfer-rollback-concurrency-test",
  });

  client.on("error", () => {});
  return client;
}

async function configure(client) {
  await client.query("SET statement_timeout = '10s'");
  await client.query("SET lock_timeout = '3s'");

  // Bij een afgebroken lokaal script geen langdurige open transactie.
  await client.query("SET idle_in_transaction_session_timeout = '60s'");
}

/*
 * Alleen controlesommen en beperkte statusgegevens teruggeven.
 * Geen persoonsgegevens, claimtokens of betaalpayloads afdrukken.
 */
async function snapshot(client) {
  const { rows } = await client.query(
    `
      SELECT
        (
          SELECT md5(to_jsonb(b)::text)
          FROM public.bookings b
          WHERE b.id = $1::uuid
        ) AS booking_checksum,
        (
          SELECT md5(to_jsonb(p)::text)
          FROM public.package_purchases p
          WHERE p.id = $2::uuid
        ) AS purchase_checksum,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'checksum', md5(to_jsonb(r)::text),
                'booking_checksum', md5(to_jsonb(b)::text)
              )
              ORDER BY r.id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_requests r
          JOIN public.bookings b ON b.id = r.booking_id
          WHERE r.trainer_id = $3::uuid
        ) AS requests,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'booking_id', s.booking_id,
                'checksum', md5(to_jsonb(s)::text)
              )
              ORDER BY s.booking_id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_execution_schedule s
          JOIN public.bookings b ON b.id = s.booking_id
          WHERE b.trainer_id = $3::uuid
        ) AS schedules
    `,
    [BOOKING, PURCHASE, TRAINER],
  );

  return rows[0];
}

async function preflight(client) {
  const { rows } = await client.query(
    `
      SELECT b.id, b.package_purchase_id,
             b.trainer_net_amount_cents, b.trainer_payout_status
      FROM public.bookings b
      JOIN public.package_purchases p ON p.id = b.package_purchase_id
      WHERE b.trainer_id = $1::uuid
        AND p.trainer_id = $1::uuid
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
      ORDER BY b.id
    `,
    [TRAINER],
  );

  // Conservatief stoppen als de kandidaatvoorraad is veranderd.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, BOOKING);
  assert.equal(rows[0].package_purchase_id, PURCHASE);
  assert.equal(rows[0].trainer_net_amount_cents, 1900);
  assert.equal(rows[0].trainer_payout_status, "pending");

  const state = await snapshot(client);
  assert.ok(state.booking_checksum);
  assert.ok(state.purchase_checksum);

  const { rows: safety } = await client.query(
    `
      SELECT
        EXISTS (
          SELECT 1 FROM public.trainer_transfer_requests
          WHERE booking_id = $1::uuid
        ) AS has_request,
        EXISTS (
          SELECT 1 FROM public.trainer_transfer_execution_schedule
          WHERE booking_id = $1::uuid
        ) AS has_schedule,
        EXISTS (
          SELECT 1 FROM public.trainer_transfer_requests
          WHERE trainer_id = $2::uuid
            AND stripe_livemode = false
            AND (
              status IN ('queued', 'processing', 'review_required')
              OR (status = 'succeeded' AND applied_at IS NULL)
            )
        ) AS unsettled
    `,
    [BOOKING, TRAINER],
  );

  assert.equal(safety[0].has_request, false);
  assert.equal(safety[0].has_schedule, false);
  assert.equal(safety[0].unsettled, false);

  return state;
}

async function selectCandidate(client) {
  const { rows } = await client.query(`
    SELECT public.claim_next_sandbox_trainer_transfer() AS result
  `);
  return rows[0].result;
}

async function assertClaim(client, result) {
  assert.equal(result.result, "claimed");
  assert.equal(result.considered, 1);
  assert.equal(result.deferred, 0);
  assert.equal(result.busy, 0);

  const claim = result.claim;
  assert.ok(claim);
  assert.equal(claim.booking_id, BOOKING);
  assert.equal(claim.source_package_purchase_id, PURCHASE);
  assert.equal(claim.trainer_id, TRAINER);
  assert.equal(claim.amount_cents, 1900);
  assert.equal(claim.attempts, 1);
  assert.match(
    claim.request_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  const { rows } = await client.query(
    `
      SELECT
        r.status,
        r.attempts,
        r.first_stripe_request_at,
        r.stripe_request_payload IS NULL AS payload_absent,
        r.stripe_transfer_id,
        r.applied_at,
        b.trainer_payout_status,
        (
          r.lock_token = $2::uuid
          AND r.locked_until > clock_timestamp()
        ) AS lease_valid,
        (
          SELECT count(*)::integer
          FROM public.trainer_transfer_requests
          WHERE booking_id = $3::uuid
        ) AS request_count,
        EXISTS (
          SELECT 1
          FROM public.trainer_transfer_execution_schedule
          WHERE booking_id = $3::uuid
            AND last_error_code IS NULL
            AND consecutive_failures = 0
            AND next_check_at > clock_timestamp()
        ) AS schedule_valid
      FROM public.trainer_transfer_requests r
      JOIN public.bookings b ON b.id = r.booking_id
      WHERE r.id = $1::uuid
    `,
    [claim.request_id, claim.lock_token, BOOKING],
  );

  assert.equal(rows.length, 1);
  const row = rows[0];

  assert.equal(row.status, "processing");
  assert.equal(row.attempts, 1);
  assert.equal(row.first_stripe_request_at, null);
  assert.equal(row.payload_absent, true);
  assert.equal(row.stripe_transfer_id, null);
  assert.equal(row.applied_at, null);
  assert.equal(row.trainer_payout_status, "processing");
  assert.equal(row.lease_valid, true);
  assert.equal(row.request_count, 1);
  assert.equal(row.schedule_valid, true);
}

function safeCode(error) {
  const value = error?.code || error?.message;
  return typeof value === "string" && /^[A-Z0-9_]{1,80}$/.test(value)
    ? value
    : "AUTOMATIC_CONCURRENCY_TEST_FAILED";
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

  const a = makeClient();
  const b = makeClient();
  const connected = [];
  let before = null;
  let failure = null;

  try {
    for (const client of [a, b]) {
      await client.connect();
      connected.push(client);
      await configure(client);
    }

    before = await preflight(a);

    await a.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await b.query("BEGIN ISOLATION LEVEL READ COMMITTED");

    const pidA = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    assert.notEqual(pidA, pidB);

    // A registreert en claimt, maar commit NIET.
    const claimA = await selectCandidate(a);
    await assertClaim(a, claimA);

    console.log("GESLAAGD 1: A heeft één ongecommitteerde uitvoeringsclaim.");

    /*
     * B ziet de bestaande kandidaat nog in de oorspronkelijke toestand.
     * De nieuwe opdracht van A is onzichtbaar, maar A houdt de
     * aankooplock vast. De kandidaat-RPC gebruikt NOWAIT.
     */
    assert.deepEqual(await snapshot(b), before);

    const blocked = await selectCandidate(b);
    assert.deepEqual(blocked, {
      result: "not_claimed",
      considered: 1,
      deferred: 0,
      busy: 1,
    });

    assert.deepEqual(await snapshot(b), before);
    console.log("GESLAAGD 2: B krijgt geen claim terwijl A de lock vasthoudt.");

    await b.query("ROLLBACK");
    await a.query("ROLLBACK");

    assert.deepEqual(await snapshot(b), before);

    // Na rollback van A moet B dezelfde kandidaat kunnen claimen.
    await b.query("BEGIN ISOLATION LEVEL READ COMMITTED");

    const claimB = await selectCandidate(b);
    await assertClaim(b, claimB);

    assert.notEqual(claimB.claim.request_id, claimA.claim.request_id);
    console.log("GESLAAGD 3: na rollback van A kan B de kandidaat claimen.");

    // Binnen de eigen transactie mag B niet nogmaals claimen.
    const second = await selectCandidate(b);
    assert.deepEqual(second, {
      result: "not_claimed",
      considered: 0,
      deferred: 0,
      busy: 0,
    });

    console.log("GESLAAGD 4: geen tweede claim binnen dezelfde verwerking.");
    await b.query("ROLLBACK");
  } catch (error) {
    failure = error;
  } finally {
    /*
     * Nooit COMMIT of DELETE.
     * Ook bij een testfout beide transacties terugdraaien.
     */
    for (const client of connected) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failure = failure || new Error("ROLLBACK_NOT_CONFIRMED");
      }
    }

    if (before && connected.includes(b)) {
      try {
        const after = await snapshot(b);
        assert.deepEqual(after, before);
        console.log(
          "NACONTROLE GESLAAGD: geen testopdracht of planning achtergebleven; " +
            "kandidaat, aankoop en bestaande trainertransfers ongewijzigd.",
        );
      } catch {
        failure = failure || new Error("FINAL_STATE_NOT_CONFIRMED");
        console.error(
          "NACONTROLE NIET BEVESTIGD. Stop en controleer de database; " +
            "geen handmatige verwijderingen uitvoeren.",
        );
      }
    }

    for (const client of [a, b]) {
      try {
        await client.end();
      } catch {}
    }
  }

  if (failure) throw failure;

  console.log(
    "\nAUTOMATISCHE CONCURRENTIETEST GESLAAGD. " +
      "Alle claims teruggedraaid; geen Stripe-aanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("TEST GESTOPT: " + safeCode(error));
  process.exitCode = 1;
});