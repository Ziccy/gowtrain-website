const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

/*
 * Expliciete afhankelijkheidsvolgorde.
 * Nooit automatisch alle SQL-bestanden uit scripts uitvoeren.
 */
const FILES = [
  "read-sandbox-single-transfer-source-context.sql",

  "validate-completed-single-transfer-history-entry.sql",
  "validate-completed-package-transfer-history-entry.sql",

  "extend-sandbox-transfer-recovery-context.sql",
  "extend-sandbox-transfer-review-context.sql",
  "extend-sandbox-transfer-application-context.sql",

  "extend-sandbox-transfer-history-projection.sql",
  "extend-sandbox-package-claim-mixed-history.sql",

  "read-sandbox-single-trainer-transfer-history.sql",
  "validate-sandbox-single-transfer-booking-internal.sql",

  "register-sandbox-single-trainer-transfer.sql",
  "claim-sandbox-single-trainer-transfer.sql",
  "register-and-claim-sandbox-single-transfer-candidate.sql",

  "read-claimed-sandbox-single-transfer-history.sql",
  "validate-claimed-sandbox-single-transfer-history.sql",
  "prepare-sandbox-single-trainer-transfer.sql",
  "guard-single-booking-financial-fields.sql",
  "register-single-transfer-admissions.sql",
  "enforce-single-transfer-admission.sql",
  "extend-sandbox-transfer-selector-single-lessons.sql",
];

const checkSingleTransferPositiveFlow = require(
  "./check-single-transfer-positive-flow.cjs",
);

function loadMigrations() {
  return FILES.map((name) => {
    const filename = path.join(__dirname, name);
    /*
     * Alle migratietekst naar LF normaliseren, inclusief
     * meerregelige dollar-quoted vervangblokken.
     *
     * De SQL-migraties normaliseren pg_get_functiondef eveneens
     * naar LF. Exacte inhouds- en aantalcontroles blijven behouden.
     */
    const source = fs.readFileSync(filename, "utf8")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");

    /*
     * Alleen de bekende buitenste BEGIN/COMMIT verwijderen.
     * Interne PL/pgSQL BEGIN/END-blokken blijven intact.
     *
     * Dit is geen algemene SQL-parser. Gebruik uitsluitend
     * de hierboven genoemde, gecontroleerde migratiebestanden.
     */
    assert.match(
      source,
      /^\s*BEGIN\s*;/i,
      `${name}: buitenste BEGIN ontbreekt`,
    );

    assert.match(
      source,
      /COMMIT\s*;\s*$/i,
      `${name}: afsluitende COMMIT ontbreekt`,
    );

    const body = source
      .replace(/^\s*BEGIN\s*;/i, "")
      .replace(/COMMIT\s*;\s*$/i, "");

    /*
     * Extra veiligheidscontrole voor deze specifieke bestanden.
     * In hun resterende inhoud horen geen afzonderlijke
     * transactie-afsluitingen voor te komen.
     */
    assert.doesNotMatch(
      body,
      /^\s*(COMMIT|ROLLBACK|END\s+TRANSACTION|START\s+TRANSACTION)\b/im,
      `${name}: onverwachte transactie-instructie`,
    );

    return { name, body };
  });
}

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
    application_name: "single-transfer-migrations-rollback-test",
  });

  client.on("error", () => {});
  return client;
}

/*
 * Nulmeting van public-functiedefinities, eigenaren en ACL's.
 * We printen geen definities of financiële gegevens.
 *
 * Geen gelijktijdige schemawijzigingen uitvoeren tijdens deze proef.
 */
async function functionSnapshot(client) {
  const { rows: functions } = await client.query(`
    SELECT
      p.oid::text AS oid,
      p.proname AS name,
      pg_get_function_identity_arguments(p.oid) AS arguments,
      p.proowner::text AS owner,
      p.proacl::text AS acl,
      md5(pg_get_functiondef(p.oid)) AS definition_hash
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
    ORDER BY p.oid
  `);

  const { rows: triggers } = await client.query(`
    SELECT
      t.oid::text AS oid,
      c.relname AS table_name,
      t.tgname AS name,
      t.tgenabled AS enabled,
      md5(pg_get_triggerdef(t.oid)) AS definition_hash
    FROM pg_trigger AS t
    JOIN pg_class AS c ON c.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
    ORDER BY t.oid
  `);

 const { rows: admissionTable } = await client.query(`
    SELECT
      to_regclass('public.single_transfer_admissions')::text AS relation
  `);

  return { functions, triggers, admissionTable };
}

async function assertPaused(client) {
  const { rows: jobs } = await client.query(`
    SELECT jobid, active
    FROM cron.job
    WHERE jobid IN (3, 11, 15)
    ORDER BY jobid
  `);

  assert.deepEqual(
    jobs.map((row) => [Number(row.jobid), row.active]),
    [[3, false], [11, false], [15, false]],
    "TRANSFER_JOBS_MUST_BE_PAUSED",
  );

  const { rows } = await client.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM public.trainer_transfer_requests
        WHERE status = 'processing'
           OR (status = 'succeeded' AND applied_at IS NULL)
      ) AS has_processing_request,
      EXISTS (
        SELECT 1
        FROM public.trainer_transfer_recovery_checks
        WHERE status = 'running'
      ) AS has_running_recovery
  `);

  assert.equal(
    rows[0].has_processing_request,
    false,
    "PROCESSING_REQUEST_REQUIRES_CHECK",
  );

  assert.equal(
    rows[0].has_running_recovery,
    false,
    "RUNNING_RECOVERY_REQUIRES_CHECK",
  );
}

async function testSingleLessonSources(client) {
  const trainerId = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";

  const candidates = [
    {
      bookingId: "f0696131-6f54-4226-b4d6-6fe819f4a9cc",
      eligibleAt: "2026-10-06T16:00:00.000Z",
    },
    {
      bookingId: "d534e4ef-de33-4a4b-9ad8-4dfcc8f067f2",
      eligibleAt: "2026-10-06T18:00:00.000Z",
    },
  ];

  for (const candidate of candidates) {
    /*
     * Deze echte boekingen zijn inmiddels verschuldigd.
     * Alleen de broncontext lezen; hier niet registreren of claimen.
     */
    const { rows: states } = await client.query(
      `
        SELECT
          b.trainer_payout_status,
          b.stripe_transfer_id IS NULL AS no_transfer,
          b.trainer_paid_at IS NULL AS not_paid_to_trainer,
          (
            isfinite(b.trainer_payout_eligible_at)
            AND b.trainer_payout_eligible_at <= clock_timestamp()
          ) AS eligible_now,
          (
            SELECT count(*)::integer
            FROM public.trainer_transfer_requests r
            WHERE r.booking_id = b.id
          ) AS request_count,
          md5(to_jsonb(b)::text) AS booking_hash
        FROM public.bookings b
        WHERE b.id = $1::uuid
      `,
      [candidate.bookingId],
    );

    assert.equal(states.length, 1, "SINGLE_SOURCE_BOOKING_MISSING");

    const state = states[0];

    assert.equal(state.trainer_payout_status, "pending");
    assert.equal(state.no_transfer, true);
    assert.equal(state.not_paid_to_trainer, true);
    assert.equal(state.eligible_now, true);
    assert.equal(state.request_count, 0);

    const { rows } = await client.query(
      `
        SELECT public.read_sandbox_single_transfer_source_context(
          $1::uuid
        ) AS context
      `,
      [candidate.bookingId],
    );

    const source = rows[0].context;

    assert.equal(source.source_kind, "single_lesson");
    assert.equal(source.booking_id, candidate.bookingId);
    assert.equal(source.trainer_id, trainerId);
    assert.equal(source.payment_channel, "paymentsheet");
    assert.equal(source.checkout_session_id, null);

    assert.match(
      source.payment_attempt_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.match(source.payment_intent_id, /^pi_[A-Za-z0-9]+$/);
    assert.match(source.stored_charge_id, /^(ch|py)_[A-Za-z0-9]+$/);

    assert.equal(source.total_amount_cents, 8000);
    assert.equal(source.commission_rate_bps, 500);
    assert.equal(source.commission_amount_cents, 400);
    assert.equal(source.trainer_net_amount_cents, 7600);
    assert.equal(source.currency, "eur");
    assert.equal(source.allocation_consistent, true);
    assert.equal(source.stripe_verification_required, true);

    assert.equal(
      new Date(source.eligible_at).toISOString(),
      candidate.eligibleAt,
    );

    const { rows: after } = await client.query(
      `
        SELECT
          md5(to_jsonb(b)::text) AS booking_hash,
          (
            SELECT count(*)::integer
            FROM public.trainer_transfer_requests r
            WHERE r.booking_id = b.id
          ) AS request_count
        FROM public.bookings b
        WHERE b.id = $1::uuid
      `,
      [candidate.bookingId],
    );

    assert.deepEqual(after, [{
      booking_hash: state.booking_hash,
      request_count: 0,
    }]);

    console.log(
      "FUNCTIONEEL OK: verschuldigde PaymentSheet-broncontext voor " +
      candidate.bookingId +
      "; boeking ongewijzigd en niet geclaimd.",
    );
  }
}

async function testFinancialGuard(client) {
  const bookingId = "f0696131-6f54-4226-b4d6-6fe819f4a9cc";

  async function bookingHash() {
    const { rows } = await client.query(
      `
        SELECT md5(to_jsonb(b)::text) AS hash
        FROM public.bookings AS b
        WHERE b.id = $1::uuid
      `,
      [bookingId],
    );

    assert.equal(rows.length, 1, "FINANCIAL_GUARD_BOOKING_MISSING");
    return rows[0].hash;
  }

  const before = await bookingHash();

  /*
   * De som blijft gelijk, zodat de bestaande somconstraint
   * niet de reden van afwijzing is.
   *
   * De nieuwe BEFORE-trigger moet de wijziging weigeren.
   * Ook als dat onverwacht niet gebeurt, draaien we eerst
   * terug naar het savepoint voordat we de test laten falen.
   */
  await client.query("SAVEPOINT financial_guard_rejection");

  let rejection = null;

  try {
    await client.query(
      `
        UPDATE public.bookings
        SET
          commission_amount_cents = commission_amount_cents + 1,
          trainer_net_amount_cents = trainer_net_amount_cents - 1
        WHERE id = $1::uuid
      `,
      [bookingId],
    );
  } catch (error) {
    rejection = {
      code: error.code,
      message: error.message,
    };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT financial_guard_rejection");
    await client.query("RELEASE SAVEPOINT financial_guard_rejection");
  }

  assert.deepEqual(rejection, {
    code: "23514",
    message: "SINGLE_BOOKING_FINANCIAL_FIELDS_IMMUTABLE",
  }, "FINANCIAL_GUARD_REJECTION_NOT_CONFIRMED");

  assert.equal(await bookingHash(), before);

  console.log(
    "FUNCTIONEEL OK: gewijzigde verdeling geweigerd door financiële trigger.",
  );

  /*
   * Exact dezelfde bedragen opnieuw aanbieden mag wel.
   * Geen statuskolommen in SET opnemen: geen betaal- of
   * annuleringsmailtrigger activeren.
   */
  await client.query("SAVEPOINT financial_guard_unchanged");

  let unchangedConfirmed = false;

  try {
    const result = await client.query(
      `
        UPDATE public.bookings
        SET
          commission_amount_cents = commission_amount_cents,
          trainer_net_amount_cents = trainer_net_amount_cents
        WHERE id = $1::uuid
      `,
      [bookingId],
    );

    assert.equal(result.rowCount, 1);
    assert.equal(await bookingHash(), before);
    unchangedConfirmed = true;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT financial_guard_unchanged");
    await client.query("RELEASE SAVEPOINT financial_guard_unchanged");
  }

  assert.equal(unchangedConfirmed, true);
  assert.equal(await bookingHash(), before);

  console.log(
    "FUNCTIONEEL OK: ongewijzigde verdeling toegestaan; boeking ongewijzigd.",
  );
}

async function testTransferAdmissions(client) {
  const expectedBookings = [
    "d534e4ef-de33-4a4b-9ad8-4dfcc8f067f2",
    "f0696131-6f54-4226-b4d6-6fe819f4a9cc",
  ];

  const { rows } = await client.query(`
    SELECT
      booking_id,
      trainer_id,
      total_price_cents,
      currency,
      commission_rate_bps,
      commission_amount_cents,
      trainer_net_amount_cents,
      evidence_kind
    FROM public.single_transfer_admissions
    ORDER BY booking_id
  `);

  assert.deepEqual(
    rows,
    expectedBookings.map((bookingId) => ({
      booking_id: bookingId,
      trainer_id: "4c4a5ffc-7584-4ffb-9678-95d3a311c50e",
      total_price_cents: 8000,
      currency: "eur",
      commission_rate_bps: 500,
      commission_amount_cents: 400,
      trainer_net_amount_cents: 7600,
      evidence_kind: "existing_booking_reviewed",
    })),
    "REVIEWED_ADMISSIONS_MISMATCH",
  );

  const { rows: security } = await client.query(`
    SELECT
      c.relrowsecurity AS rls_enabled,
      has_table_privilege(
        'service_role',
        'public.single_transfer_admissions',
        'SELECT'
      ) AS service_can_read,
      has_table_privilege(
        'service_role',
        'public.single_transfer_admissions',
        'INSERT, UPDATE, DELETE, TRUNCATE'
      ) AS service_can_write,
      has_table_privilege(
        'anon',
        'public.single_transfer_admissions',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
      ) AS anon_has_access,
      has_table_privilege(
        'authenticated',
        'public.single_transfer_admissions',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'
      ) AS authenticated_has_access
    FROM pg_class AS c
    WHERE c.oid = 'public.single_transfer_admissions'::regclass
  `);

  assert.deepEqual(security, [{
    rls_enabled: true,
    service_can_read: true,
    service_can_write: false,
    anon_has_access: false,
    authenticated_has_access: false,
  }]);

  console.log(
    "FUNCTIONEEL OK: exact twee beoordeelde toelatingen; " +
    "RLS en tabelrechten gecontroleerd.",
  );

  /*
   * Bekende bestaande PaymentSheet-boeking van trainer B.
   * Geen toelating toevoegen en geen boekingsgegevens wijzigen.
   *
   * De bronreader moet vóór verdere bron-/Connect-controles
   * weigeren wegens ontbrekende toelating.
   */
  const unreviewedBooking = "737b8604-a01a-4e7f-a770-9b13b82d8577";

  const { rows: fixture } = await client.query(
    `
      SELECT
        b.package_purchase_id IS NULL AS single_booking,
        NOT EXISTS (
          SELECT 1
          FROM public.single_transfer_admissions AS a
          WHERE a.booking_id = b.id
        ) AS admission_absent
      FROM public.bookings AS b
      WHERE b.id = $1::uuid
    `,
    [unreviewedBooking],
  );

  assert.deepEqual(fixture, [{
    single_booking: true,
    admission_absent: true,
  }], "UNREVIEWED_ADMISSION_FIXTURE_CHANGED");

  await client.query("SAVEPOINT missing_transfer_admission");
  let rejection = null;

  try {
    await client.query(
      `
        SELECT public.read_sandbox_single_transfer_source_context(
          $1::uuid
        )
      `,
      [unreviewedBooking],
    );
  } catch (error) {
    rejection = {
      code: error.code,
      message: error.message,
    };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT missing_transfer_admission");
    await client.query("RELEASE SAVEPOINT missing_transfer_admission");
  }

  assert.deepEqual(rejection, {
    code: "P0001",
    message: "TRANSFER_SINGLE_ADMISSION_REQUIRED",
  }, "MISSING_ADMISSION_NOT_REJECTED");

  console.log(
    "FUNCTIONEEL OK: onbeoordeelde bestaande losse boeking geweigerd.",
  );
}

async function testAdmissionProtectionAndExecutionRights(client) {
  const bookingId = "f0696131-6f54-4226-b4d6-6fe819f4a9cc";

  async function admissionHash() {
    const { rows } = await client.query(
      `
        SELECT md5(to_jsonb(a)::text) AS hash
        FROM public.single_transfer_admissions AS a
        WHERE a.booking_id = $1::uuid
      `,
      [bookingId],
    );

    assert.equal(rows.length, 1, "ADMISSION_FIXTURE_MISSING");
    return rows[0].hash;
  }

  const before = await admissionHash();

  /*
   * Test beide verboden acties afzonderlijk.
   * Zelfs wanneer een actie onverwacht wordt toegestaan,
   * eerst terugdraaien voordat de assertion faalt.
   */
  for (const action of [
    {
      name: "wijzigen",
      sql: `
        UPDATE public.single_transfer_admissions
        SET recorded_at = recorded_at + interval '1 second'
        WHERE booking_id = $1::uuid
      `,
    },
    {
      name: "verwijderen",
      sql: `
        DELETE FROM public.single_transfer_admissions
        WHERE booking_id = $1::uuid
      `,
    },
  ]) {
    await client.query("SAVEPOINT admission_protection");

    let rejection = null;

    try {
      await client.query(action.sql, [bookingId]);
    } catch (error) {
      rejection = {
        code: error.code,
        message: error.message,
      };
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT admission_protection");
      await client.query("RELEASE SAVEPOINT admission_protection");
    }

    assert.deepEqual(rejection, {
      code: "23514",
      message: "TRANSFER_SINGLE_ADMISSION_IMMUTABLE",
    }, "ADMISSION_PROTECTION_NOT_CONFIRMED");

    assert.equal(await admissionHash(), before);

    console.log(
      `FUNCTIONEEL OK: toelating ${action.name} geweigerd; rij ongewijzigd.`,
    );
  }

  /*
   * Controleer effectieve uitvoerrechten, inclusief rechten
   * die eventueel via PUBLIC of rol-lidmaatschap zijn verkregen.
   *
   * Alleen de selector en prepare zijn publieke backendingangen.
   * Losse registratie-/claimfuncties blijven intern.
   */
  const functions = [
    {
      signature: "public.claim_next_sandbox_trainer_transfer()",
      serviceAllowed: true,
    },
    {
      signature:
        "public.prepare_sandbox_single_trainer_transfer(uuid,uuid,jsonb,jsonb,jsonb)",
      serviceAllowed: true,
    },
    {
      signature:
        "public.register_sandbox_single_trainer_transfer(uuid)",
      serviceAllowed: false,
    },
    {
      signature:
        "public.claim_sandbox_single_trainer_transfer(uuid,integer)",
      serviceAllowed: false,
    },
    {
      signature:
        "public.register_and_claim_sandbox_single_transfer_candidate(uuid)",
      serviceAllowed: false,
    },
  ];

  for (const item of functions) {
    const { rows } = await client.query(
      `
        SELECT
          has_function_privilege(
            'anon', $1::text, 'EXECUTE'
          ) AS anon_execute,
          has_function_privilege(
            'authenticated', $1::text, 'EXECUTE'
          ) AS authenticated_execute,
          has_function_privilege(
            'service_role', $1::text, 'EXECUTE'
          ) AS service_execute
      `,
      [item.signature],
    );

    assert.deepEqual(rows, [{
      anon_execute: false,
      authenticated_execute: false,
      service_execute: item.serviceAllowed,
    }], "TRANSFER_EXECUTION_RIGHTS_MISMATCH");
  }

  console.log(
    "FUNCTIONEEL OK: selector-/preparerechten en interne claimgrenzen.",
  );
}

function safeCode(error) {
  const code = error?.code || error?.message;

  return typeof code === "string" && /^[A-Z0-9_]{1,100}$/.test(code)
    ? code
    : "MIGRATION_ROLLBACK_TEST_FAILED";
}

async function main() {
  /*
   * Bestanden eerst lokaal controleren, vóór databaseverbinding.
   */
  const migrations = loadMigrations();

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
    await client.query(
      "SET idle_in_transaction_session_timeout = '60s'",
    );

    stage = "PREFLIGHT";
    await assertPaused(client);
    before = await functionSnapshot(client);

    assert.equal(
      before.admissionTable[0].relation,
      null,
      "ADMISSIONS_ALREADY_INSTALLED_REQUIRES_REVIEW",
    );

    stage = "BEGIN";
    await client.query("BEGIN");
    transactionStarted = true;

    for (const migration of migrations) {
      stage = migration.name;
      await client.query(migration.body);
      console.log("INSTALLATIE BINNEN TESTTRANSACTIE OK: " + migration.name);
    }

    stage = "CHECK_INSTALLED_FUNCTIONS";

    const { rows } = await client.query(`
      SELECT
        to_regprocedure(
          'public.register_and_claim_sandbox_single_transfer_candidate(uuid)'
        ) IS NOT NULL AS candidate_present,
        to_regprocedure(
          'public.prepare_sandbox_single_trainer_transfer(uuid,uuid,jsonb,jsonb,jsonb)'
        ) IS NOT NULL AS prepare_present,
        to_regprocedure(
          'public.validate_claimed_sandbox_single_transfer_history(uuid,uuid,text,jsonb)'
        ) IS NOT NULL AS history_present
    `);

    assert.deepEqual(rows[0], {
      candidate_present: true,
      prepare_present: true,
      history_present: true,
    });

    console.log(
      `OK: alle ${migrations.length} migraties binnen de testtransactie geïnstalleerd.`,
    );

    stage = "FUNCTIONAL_TRANSFER_ADMISSIONS";
    await testTransferAdmissions(client);

    stage = "FUNCTIONAL_ADMISSION_PROTECTION_AND_RIGHTS";
    await testAdmissionProtectionAndExecutionRights(client);

    stage = "FUNCTIONAL_DUE_SINGLE_SOURCES";
    await testSingleLessonSources(client);

    console.log(
      "OK: verschuldigde echte losse-lesbroncontexten alleen-lezen gecontroleerd.",
    );

    stage = "FUNCTIONAL_FINANCIAL_GUARD";
    await testFinancialGuard(client);

    stage = "FUNCTIONAL_POSITIVE_SINGLE_FLOW";
    await checkSingleTransferPositiveFlow(client);
  } catch (error) {
    failure = error;
    console.error("GESTOPT BIJ: " + stage);
    console.error("FOUTCODE: " + safeCode(error));
  } finally {
    let rollbackConfirmed = !transactionStarted;

    if (connected && transactionStarted) {
      try {
        await client.query("ROLLBACK");
        rollbackConfirmed = true;
        console.log("OK: ROLLBACK bevestigd.");
      } catch {
        failure = failure || new Error("ROLLBACK_NOT_CONFIRMED");
        console.error(
          "STOP: rollback niet bevestigd. Eerst database controleren.",
        );
      }
    }

    if (connected && before && rollbackConfirmed) {
      try {
        const after = await functionSnapshot(client);
        assert.deepEqual(after, before);

        console.log(
          "OK: functiedefinities, eigenaren, uitvoerrechten en triggers " +
          "exact gelijk aan de nulmeting.",
        );
      } catch {
        failure = failure || new Error("FINAL_STATE_NOT_CONFIRMED");
        console.error(
          "STOP: nacontrole niet bevestigd. " +
          "Geen functies verwijderen of migraties opnieuw uitvoeren.",
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
    "SQL-INSTALLATIEPROEF GESLAAGD EN TERUGGEDRAAID. " +
    "Functiegedrag is hiermee nog niet volledig getest. " +
    "Geen Stripe-aanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("TEST GESTOPT: " + safeCode(error));
  process.exitCode = 1;
});