const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  if (process.env.CONFIRM_SINGLE_TRANSFER_INSTALL !== "INSTALL_F07737E") {
    throw new Error("INSTALL_CONFIRMATION_REQUIRED");
  }

  if (!process.env.RECOVERY_TEST_DATABASE_PASSWORD) {
    throw new Error("DATABASE_PASSWORD_MISSING");
  }

  if (
    !process.env.NODE_EXTRA_CA_CERTS ||
    !fs.existsSync(process.env.NODE_EXTRA_CA_CERTS)
  ) {
    throw new Error("CA_CERTIFICATE_MISSING");
  }

  const sql = fs.readFileSync(
    path.join(__dirname, "install-single-transfers-f07737e.sql"),
    "utf8",
  )
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");

  assert.ok(
    sql.includes(
      "-- Broncommit: f07737ece50563c69dd1dfbead6da32b8edc673e",
    ),
    "INSTALL_SOURCE_COMMIT_MISMATCH",
  );

  assert.equal(
    (sql.match(/^-- MIGRATIE: /gm) || []).length,
    20,
    "INSTALL_MIGRATION_COUNT_MISMATCH",
  );

  assert.equal(
    (sql.match(/^\s*BEGIN;\s*$/gm) || []).length,
    1,
    "INSTALL_TRANSACTION_BEGIN_MISMATCH",
  );

  assert.equal(
    (sql.match(/^\s*COMMIT;\s*$/gm) || []).length,
    1,
    "INSTALL_TRANSACTION_COMMIT_MISMATCH",
  );

  assert.match(sql, /COMMIT;\s*$/);

  const client = new Client({
    host: "aws-1-eu-west-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.ucrfaksziviflxvhepjk",
    password: process.env.RECOVERY_TEST_DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    application_name: "single-transfer-install-f07737e",
  });

  client.on("error", () => {});

  let connected = false;
  let submitted = false;
  let commitConfirmed = false;

  try {
    await client.connect();
    connected = true;

    await client.query("SET idle_in_transaction_session_timeout = '60s'");

    console.log(
      "START: 20 migraties installeren in één transactie. " +
      "Dit is GEEN rollbacktest.",
    );

    submitted = true;

    // Het bestand bevat preflight, BEGIN en de definitieve COMMIT.
    const result = await client.query(sql);
    const results = Array.isArray(result) ? result : [result];

    assert.equal(
      results[results.length - 1].command,
      "COMMIT",
      "INSTALL_COMMIT_RESPONSE_NOT_CONFIRMED",
    );

    commitConfirmed = true;
    console.log("COMMIT BEVESTIGD: database-uitbreiding geïnstalleerd.");

    const { rows } = await client.query(`
      SELECT
        clock_timestamp() AS database_now,
        (
          SELECT count(*)::integer
          FROM public.single_transfer_admissions
          WHERE evidence_kind = 'existing_booking_reviewed'
        ) AS reviewed_admission_count,
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'booking_id', booking_id,
              'total_price_cents', total_price_cents,
              'commission_amount_cents', commission_amount_cents,
              'trainer_net_amount_cents', trainer_net_amount_cents,
              'evidence_kind', evidence_kind
            ) ORDER BY booking_id
          )
          FROM public.single_transfer_admissions
        ) AS admissions,
        (
          SELECT relrowsecurity
          FROM pg_class
          WHERE oid = 'public.single_transfer_admissions'::regclass
        ) AS admission_rls_enabled,
        has_function_privilege(
          'service_role',
          'public.prepare_sandbox_single_trainer_transfer(uuid,uuid,jsonb,jsonb,jsonb)',
          'EXECUTE'
        ) AS single_prepare_service_execute,
        has_function_privilege(
          'service_role',
          'public.register_and_claim_sandbox_single_transfer_candidate(uuid)',
          'EXECUTE'
        ) AS single_candidate_service_execute,
        (
          SELECT jsonb_agg(
            jsonb_build_object('jobid', jobid, 'active', active)
            ORDER BY jobid
          )
          FROM cron.job
          WHERE jobid IN (3, 11, 15)
        ) AS cron_jobs
    `);

    console.log("NACONTROLE:");
    console.log(JSON.stringify(rows[0], null, 2));

    assert.equal(rows[0].reviewed_admission_count, 2);
    assert.equal(rows[0].admission_rls_enabled, true);
    assert.equal(rows[0].single_prepare_service_execute, true);
    assert.equal(rows[0].single_candidate_service_execute, false);

    assert.deepEqual(
      rows[0].cron_jobs.map((job) => [Number(job.jobid), job.active]),
      [[3, false], [11, false], [15, false]],
    );

    console.log(
      "INSTALLATIE EN NACONTROLE GESLAAGD. " +
      "Geen Stripe-aanroepen uitgevoerd. Uitvoering blijft uit.",
    );
  } catch (error) {
    const code =
      typeof error?.code === "string" &&
      /^[A-Z0-9_]{1,80}$/.test(error.code)
        ? error.code
        : "INSTALL_NOT_CONFIRMED";

    console.error("INSTALLATIE GESTOPT: " + code);

    if (commitConfirmed) {
      console.error(
        "COMMIT WAS BEVESTIGD. De installatie is blijvend; " +
        "alleen de nacontrole is niet volledig bevestigd.",
      );
    } else if (submitted) {
      if (connected) {
        try {
          await client.query("ROLLBACK");
          console.error("ROLLBACK-verzoek beantwoord.");
        } catch {
          console.error("ROLLBACK niet bevestigd.");
        }
      }

      console.error(
        "Niet opnieuw installeren. Controleer eerst de database. " +
        "Een ROLLBACK-antwoord bewijst niet dat een eerdere COMMIT " +
        "bij verbindingsverlies niet is uitgevoerd.",
      );
    }

    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

main().catch(() => {
  console.error(
    "GESTOPT VÓÓR INSTALLATIE: controleer bevestiging, bestand, " +
    "wachtwoordvariabele en CA-certificaat.",
  );
  process.exitCode = 1;
});