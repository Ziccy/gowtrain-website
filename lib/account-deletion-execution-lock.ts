import { readFileSync } from "node:fs";
import { Client } from "pg";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AccountDeletionExecutionBusyError extends Error {
  constructor() {
    super("Voor dit verzoek is al een uitvoerder actief.");
    this.name = "AccountDeletionExecutionBusyError";
  }
}

export class AccountDeletionExecutionConnectionError extends Error {
  constructor() {
    super("De exclusieve uitvoerverbinding kon niet worden bevestigd.");
    this.name = "AccountDeletionExecutionConnectionError";
  }
}

export type AccountDeletionExecutionContext = {
  signal: AbortSignal;
  assertConnection: () => Promise<void>;
};

/**
 * Controleert de serverconfiguratie zonder een verbinding te openen.
 * De worker kan dit vóór claimen aanroepen.
 */
function databaseConfig() {
  try {
    const connectionString =
      process.env.ACCOUNT_DELETION_DATABASE_URL?.trim();

    if (!connectionString) {
      throw new Error();
    }

    const url = new URL(connectionString);

    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error();
    }

    /*
     * Laat SSL-queryparameters de expliciete TLS-configuratie
     * niet overschrijven.
     */
    for (const key of url.searchParams.keys()) {
      if (key.toLowerCase().startsWith("ssl")) {
        throw new Error();
      }
    }

    let ca = process.env.ACCOUNT_DELETION_DATABASE_CA_PEM?.trim();

    if (!ca) {
      /*
       * Windows-bestandspad uitsluitend lokaal gebruiken.
       * Op Vercel is de PEM-omgevingsvariabele verplicht.
       */
      if (process.env.NODE_ENV !== "development") {
        throw new Error();
      }

      const caFile =
        process.env.ACCOUNT_DELETION_DATABASE_CA_FILE?.trim();

      if (!caFile) {
        throw new Error();
      }

      ca = readFileSync(caFile, "utf8").trim();
    }

    if (
      !ca.includes("-----BEGIN CERTIFICATE-----") ||
      !ca.includes("-----END CERTIFICATE-----")
    ) {
      throw new Error();
    }

    return {
      connectionString,
      ssl: {
        ca,
        rejectUnauthorized: true,
      },
      connectionTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      keepAlive: true,
      application_name: "gowtrain-account-deletion",
    };
  } catch {
    /*
     * Geen connection string, bestandspad, certificaatinhoud
     * of ruwe databasefout teruggeven.
     */
    throw new AccountDeletionExecutionConnectionError();
  }
}

export function validateAccountDeletionDatabaseConfiguration(): void {
  databaseConfig();
}

/**
 * Eén exclusieve sessielock per verwijderverzoek.
 *
 * Vereist een directe verbinding of Session pooler.
 * Niet geschikt voor Transaction pooling.
 *
 * Geen reconnect, retry of automatische claimovername.
 */
export async function withAccountDeletionExecutionLock<T>(
  requestId: string,
  execute: (
    context: AccountDeletionExecutionContext
  ) => Promise<T>
): Promise<T> {
  if (!UUID_PATTERN.test(requestId)) {
    throw new Error("Ongeldig verwijderverzoek-ID.");
  }

  const client = new Client(databaseConfig());
  const controller = new AbortController();

  const lockName =
    `gowtrain:account-deletion:${requestId.toLowerCase()}`;

  let failed = false;
  let closing = false;
  let backendPid: number | null = null;

  function markConnectionLost(): void {
    if (closing) return;

    failed = true;
    controller.abort();
  }

  client.on("error", markConnectionLost);
  client.on("end", markConnectionLost);

  try {
    try {
      await client.connect();

      const result = await client.query<{
        backend_pid: number;
        acquired: boolean;
      }>(
        `select
           pg_backend_pid() as backend_pid,
           pg_try_advisory_lock(
             hashtextextended($1::text, 0::bigint)
           ) as acquired`,
        [lockName]
      );

      const row = result.rows[0];

      if (
        failed ||
        !row ||
        !Number.isInteger(row.backend_pid) ||
        typeof row.acquired !== "boolean"
      ) {
        throw new AccountDeletionExecutionConnectionError();
      }

      if (!row.acquired) {
        throw new AccountDeletionExecutionBusyError();
      }

      backendPid = row.backend_pid;
    } catch (error) {
      if (error instanceof AccountDeletionExecutionBusyError) {
        throw error;
      }

      throw new AccountDeletionExecutionConnectionError();
    }

    async function assertConnection(): Promise<void> {
      if (
        failed ||
        controller.signal.aborted ||
        backendPid === null
      ) {
        throw new AccountDeletionExecutionConnectionError();
      }

      try {
        const result = await client.query<{
          backend_pid: number;
        }>("select pg_backend_pid() as backend_pid");

        if (
          failed ||
          controller.signal.aborted ||
          result.rows[0]?.backend_pid !== backendPid
        ) {
          throw new Error();
        }
      } catch {
        markConnectionLost();
        throw new AccountDeletionExecutionConnectionError();
      }
    }

    await assertConnection();

    return await execute({
      signal: controller.signal,
      assertConnection,
    });
  } finally {
    /*
     * De dedicated verbinding nooit in een applicatiepool
     * terugplaatsen of voor een ander verzoek hergebruiken.
     */
    closing = true;
    controller.abort();

    try {
      await client.end();
    } catch {
      // Geen automatische reconnect of ruwe logging.
    }
  }
}