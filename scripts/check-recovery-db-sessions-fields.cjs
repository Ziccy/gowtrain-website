const { Client } = require("pg");

async function main() {
  const password = process.env.RECOVERY_TEST_DATABASE_PASSWORD;

  if (!password) {
    throw new Error("LOCAL_PASSWORD_MISSING");
  }

  const options = {
    host: "aws-1-eu-west-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.ucrfaksziviflxvhepjk",
    password,

    // Certificaatcontrole blijft ingeschakeld.
    ssl: { rejectUnauthorized: true },

    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    application_name: "recovery-readonly-session-check",
  };

  const clients = [new Client(options), new Client(options)];
  const connected = new Set();

  for (const client of clients) {
    client.on("error", () => {});
  }

  try {
    // Beide verbindingen blijven tegelijkertijd open.
    for (const client of clients) {
      await client.connect();
      connected.add(client);

      await client.query("BEGIN TRANSACTION READ ONLY");
    }

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
          if (connected.has(client)) {
            await client.query("ROLLBACK");
          }
        } finally {
          await client.end();
        }
      }),
    );
  }
}

main().catch((error) => {
  // Geen verbindingsgegevens of vrije foutteksten afdrukken.
  const candidate = error?.code || error?.message;
  const safeCode =
    typeof candidate === "string" &&
    /^[A-Z0-9_]{1,80}$/.test(candidate)
      ? candidate
      : "CONNECTION_CHECK_FAILED";

  console.error(`VERBINDINGSCONTROLE MISLUKT: ${safeCode}`);
  process.exitCode = 1;
});