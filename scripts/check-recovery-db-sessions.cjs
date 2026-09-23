const { Client } = require("pg");

async function main() {
  const connectionString = process.env.RECOVERY_TEST_DATABASE_URL;

  if (!connectionString) {
    throw new Error("LOCAL_CONNECTION_MISSING");
  }

  const parsed = new URL(connectionString);

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("LOCAL_CONNECTION_INVALID");
  }

  /*
   * TLS hieronder expliciet configureren.
   * Geen URI-opties toestaan die deze instelling kunnen vervangen.
   */
  for (const key of parsed.searchParams.keys()) {
    if (key.toLowerCase().startsWith("ssl")) {
      throw new Error("LOCAL_SSL_URI_OPTIONS_PRESENT");
    }
  }

  const options = {
    connectionString,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    application_name: "recovery-readonly-session-check",
  };

  const clients = [new Client(options), new Client(options)];

  // Voorkom dat onverwachte verbindingsfouten details afdrukken.
  for (const client of clients) {
    client.on("error", () => {});
  }

  try {
    await Promise.all(clients.map((client) => client.connect()));

    await Promise.all(
      clients.map((client) =>
        client.query("BEGIN TRANSACTION READ ONLY"),
      ),
    );

    const results = await Promise.all(
      clients.map((client) =>
        client.query(`
          SELECT
            pg_backend_pid() AS pid,
            current_database() AS database_name,
            current_user AS role_name
        `),
      ),
    );

    const a = results[0].rows[0];
    const b = results[1].rows[0];

    if (a.pid === b.pid) {
      throw new Error("LOCAL_SESSIONS_NOT_DISTINCT");
    }

    if (
      a.database_name !== b.database_name ||
      a.role_name !== b.role_name
    ) {
      throw new Error("LOCAL_SESSION_CONTEXT_MISMATCH");
    }

    console.log(
      "GESLAAGD: twee afzonderlijke databasesessies, " +
        "dezelfde database en rol. Alleen leesqueries uitgevoerd.",
    );
  } finally {
    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          await client.query("ROLLBACK");
        } finally {
          await client.end();
        }
      }),
    );
  }
}

main().catch((error) => {
  const candidate = error?.code || error?.message;
  const safeCode =
    typeof candidate === "string" &&
    /^[A-Z0-9_]{1,80}$/.test(candidate)
      ? candidate
      : "CONNECTION_CHECK_FAILED";

  console.error(`VERBINDINGSCONTROLE MISLUKT: ${safeCode}`);
  process.exitCode = 1;
});