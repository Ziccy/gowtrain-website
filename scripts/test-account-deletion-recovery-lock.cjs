const { loadEnvConfig } = require("@next/env");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

loadEnvConfig(process.cwd(), true);

const EXPECTED_MESSAGE =
  "Voor dit verzoek is een andere uitvoerder actief. Herstel niet uitgevoerd.";

async function main() {
  const connectionString =
    process.env.ACCOUNT_DELETION_DATABASE_URL?.trim();

  const caFile =
    process.env.ACCOUNT_DELETION_DATABASE_CA_FILE?.trim();

  if (!connectionString || !caFile) {
    throw new Error("LOCK_CONFIGURATION_MISSING");
  }

  let url;
  let ca;

  try {
    url = new URL(connectionString);
    ca = readFileSync(caFile, "utf8");
  } catch {
    throw new Error("LOCK_CONFIGURATION_INVALID");
  }

  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !ca.includes("-----BEGIN CERTIFICATE-----")
  ) {
    throw new Error("LOCK_CONFIGURATION_INVALID");
  }

  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase().startsWith("ssl")) {
      throw new Error("SSL_QUERY_PARAMETERS_PRESENT");
    }
  }

  const config = {
    connectionString,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    application_name: "gowtrain-recovery-lock-test",
  };

  const worker = new Client(config);
  const recovery = new Client(config);

  let connectionFailed = false;

  const onConnectionError = () => {
    connectionFailed = true;
  };

  worker.on("error", onConnectionError);
  recovery.on("error", onConnectionError);

  // Geen bestaand verzoek gebruiken.
  const requestId = randomUUID();
  const lockName = `gowtrain:account-deletion:${requestId}`;

  try {
    await worker.connect();
    await recovery.connect();

    /*
     * Alleen een bestaande adminidentiteit zoeken.
     * Geen naam, e-mailadres of gebruikers-ID afdrukken.
     */
    const adminResult = await recovery.query(`
      select id
      from public.profiles
      where role = 'admin'
      order by id
      limit 1
    `);

    const adminId = adminResult.rows[0]?.id;

    if (!adminId) {
      throw new Error("NO_ADMIN_TEST_IDENTITY");
    }

    // Simuleer de sessielock van de worker.
    const acquired = await worker.query(
      `select pg_try_advisory_lock(
         hashtextextended($1::text, 0::bigint)
       ) as acquired`,
      [lockName]
    );

    if (acquired.rows[0]?.acquired !== true) {
      throw new Error("WORKER_LOCK_NOT_ACQUIRED");
    }

    const tests = [
      {
        name: "Administratief wachtrijherstel",
        sql: `
          select public.admin_reconcile_completed_deletion_queue(
            $1::uuid,
            statement_timestamp()
          )
        `,
      },
      {
        name: "Herstel na Auth-verwijdering",
        sql: `
          select public.admin_recover_deletion_after_auth(
            $1::uuid,
            statement_timestamp()
          )
        `,
      },
    ];

    for (const test of tests) {
      await recovery.query("begin");

      try {
        await recovery.query(`
          set local lock_timeout = '3s'
        `);

        /*
         * Alleen voor deze database-integratietest:
         * simuleer de geauthenticeerde admincontext.
         * Dit is geen echte login of nieuw uitgegeven token.
         */
        await recovery.query(
          `select
             set_config('request.jwt.claims', $1, true),
             set_config('request.jwt.claim.sub', $2, true)`,
          [
            JSON.stringify({
              sub: adminId,
              role: "authenticated",
            }),
            adminId,
          ]
        );

        await recovery.query("set local role authenticated");

        let blockedAsExpected = false;

        try {
          await recovery.query(test.sql, [requestId]);
        } catch (error) {
          blockedAsExpected =
            error.code === "55P03" &&
            error.message === EXPECTED_MESSAGE;

          if (!blockedAsExpected) {
            throw new Error("UNEXPECTED_RECOVERY_RESULT");
          }
        }

        if (!blockedAsExpected) {
          throw new Error("RECOVERY_NOT_BLOCKED");
        }
      } finally {
        await recovery.query("rollback");
      }

      console.log(`GESLAAGD: ${test.name} weigert bij actieve workerlock.`);
    }

    if (connectionFailed) {
      throw new Error("CONNECTION_INTERRUPTED");
    }

    const released = await worker.query(
      `select pg_advisory_unlock(
         hashtextextended($1::text, 0::bigint)
       ) as released`,
      [lockName]
    );

    if (released.rows[0]?.released !== true) {
      throw new Error("WORKER_LOCK_NOT_RELEASED");
    }

    console.log(
      "GESLAAGD: beide herstelacties gebruiken dezelfde verzoeklock als de worker."
    );
    console.log(
      "Geen accountgegevens gewijzigd en geen externe API aangeroepen."
    );
  } finally {
    await Promise.allSettled([
      worker.end(),
      recovery.end(),
    ]);
  }
}

main().catch((error) => {
  const knownMessages = new Set([
    "LOCK_CONFIGURATION_MISSING",
    "LOCK_CONFIGURATION_INVALID",
    "SSL_QUERY_PARAMETERS_PRESENT",
    "NO_ADMIN_TEST_IDENTITY",
    "WORKER_LOCK_NOT_ACQUIRED",
    "UNEXPECTED_RECOVERY_RESULT",
    "RECOVERY_NOT_BLOCKED",
    "CONNECTION_INTERRUPTED",
    "WORKER_LOCK_NOT_RELEASED",
  ]);

  let diagnostic = "RECOVERY_LOCK_TEST_FAILED";

  if (knownMessages.has(error?.message)) {
    diagnostic = error.message;
  } else if (
    typeof error?.code === "string" &&
    /^[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    diagnostic = error.code;
  }

  // Geen connection string, account-ID of ruwe foutdetails tonen.
  console.error(`TEST NIET GESLAAGD: ${diagnostic}`);
  process.exitCode = 1;
});