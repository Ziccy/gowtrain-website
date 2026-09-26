const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");

loadEnvConfig(process.cwd(), true);

async function main() {
  const connectionString =
    process.env.ACCOUNT_DELETION_DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL_MISSING");
  }

  let url;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL_INVALID");
  }

  /*
   * Laat SSL-queryparameters de expliciete veilige TLS-configuratie
   * hieronder niet ongemerkt overschrijven.
   */
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase().startsWith("ssl")) {
      throw new Error("SSL_QUERY_PARAMETERS_PRESENT");
    }
  }

const caFile =
  process.env.ACCOUNT_DELETION_DATABASE_CA_FILE?.trim();

if (!caFile) {
  throw new Error("DATABASE_CA_FILE_MISSING");
}

let ca;

try {
  ca = readFileSync(caFile, "utf8");
} catch {
  throw new Error("DATABASE_CA_FILE_UNREADABLE");
}

if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
  throw new Error("DATABASE_CA_FILE_INVALID");
}

const config = {
  connectionString,
  ssl: {
    ca,
    rejectUnauthorized: true,
  },
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
  application_name: "gowtrain-deletion-lock-test",
};

  const first = new Client(config);
  const second = new Client(config);

  /*
   * Willekeurige testsleutel.
   * Geen bestaand verzoek of operationele reekslock gebruiken.
   */
  const lockName = `gowtrain:deletion-lock-test:${randomUUID()}`;

  let connectionFailed = false;

  const onConnectionError = () => {
    connectionFailed = true;
  };

  first.on("error", onConnectionError);
  second.on("error", onConnectionError);

  async function acquire(client) {
    const result = await client.query(
      `select pg_try_advisory_lock(
         hashtextextended($1::text, 0::bigint)
       ) as acquired`,
      [lockName]
    );

    return result.rows[0]?.acquired === true;
  }

  async function release(client) {
    const result = await client.query(
      `select pg_advisory_unlock(
         hashtextextended($1::text, 0::bigint)
       ) as released`,
      [lockName]
    );

    return result.rows[0]?.released === true;
  }

  try {
    await first.connect();
    await second.connect();

    // Verbinding A verkrijgt de exclusieve sessielock.
    if (!(await acquire(first))) {
      throw new Error("FIRST_LOCK_NOT_ACQUIRED");
    }

    /*
     * A heeft geen open transactie. De sessielock moet
     * desondanks behouden blijven.
     */
    await first.query("select 1");

    // Verbinding B mag dezelfde lock nu niet krijgen.
    if (await acquire(second)) {
      throw new Error("CONCURRENT_LOCK_WAS_ALLOWED");
    }

    // Alleen A geeft zijn eigen lock vrij.
    if (!(await release(first))) {
      throw new Error("FIRST_LOCK_NOT_RELEASED");
    }

    // Daarna moet B de lock wel kunnen verkrijgen.
    if (!(await acquire(second))) {
      throw new Error("SECOND_LOCK_NOT_ACQUIRED");
    }

    if (!(await release(second))) {
      throw new Error("SECOND_LOCK_NOT_RELEASED");
    }

    if (connectionFailed) {
      throw new Error("CONNECTION_INTERRUPTED");
    }

    console.log(
      "GESLAAGD: TLS-verbinding, exclusieve sessielock en vrijgave gecontroleerd."
    );
    console.log(
      "Geen accountgegevens gewijzigd en geen externe API aangeroepen."
    );
  } finally {
    /*
     * Sluit beide sessies altijd.
     * Eventueel resterende sessielocks horen daarbij vrij te komen.
     */
    await Promise.allSettled([
      first.end(),
      second.end(),
    ]);
  }
}

main().catch((error) => {
  const knownMessages = new Set([
    "DATABASE_URL_MISSING",
    "DATABASE_URL_INVALID",
    "SSL_QUERY_PARAMETERS_PRESENT",
    "FIRST_LOCK_NOT_ACQUIRED",
    "CONCURRENT_LOCK_WAS_ALLOWED",
    "FIRST_LOCK_NOT_RELEASED",
    "SECOND_LOCK_NOT_ACQUIRED",
    "SECOND_LOCK_NOT_RELEASED",
    "CONNECTION_INTERRUPTED",
    "DATABASE_CA_FILE_MISSING",
"DATABASE_CA_FILE_UNREADABLE",
"DATABASE_CA_FILE_INVALID",
  ]);

  let diagnostic = "CONNECTION_OR_LOCK_TEST_FAILED";

  if (knownMessages.has(error?.message)) {
    diagnostic = error.message;
  } else if (
    typeof error?.code === "string" &&
    /^[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    diagnostic = error.code;
  }

  // Geen verbindingsstring, wachtwoord of ruwe foutdetails afdrukken.
  console.error(`TEST NIET GESLAAGD: ${diagnostic}`);
  process.exitCode = 1;
});