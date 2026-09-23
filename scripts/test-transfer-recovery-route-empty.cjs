const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});

async function main() {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("TEST GESTOPT: lokale CRON_SECRET ontbreekt.");
    process.exitCode = 1;
    return;
  }

  /*
   * Precies één aanroep, geen retry.
   * Alleen naar de speciaal gestarte lokale server.
   */
  const response = await fetch(
    "http://127.0.0.1:3011/api/cron/reconcile-trainer-transfers",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    },
  );

  console.log(`HTTP-status: ${response.status}`);

  assert.equal(response.status, 200);
  assert.ok(
    response.headers.get("cache-control")?.includes("no-store"),
  );

  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.result, "not_started");
  assert.equal(body.requestId, undefined);
  assert.equal(body.checkId, undefined);

  console.log(
    "GESLAAGD: echte lokale workerroute gaf not_started. " +
      "Geen onderzoek gestart of timeout afgehandeld volgens de response.",
  );
}

main().catch(() => {
  console.error(
    "TEST NIET BEVESTIGD. Niet opnieuw aanroepen. " +
      "Stop de testserver en controleer eerst de database. " +
      "Geen secrets of volledige foutobjecten delen.",
  );
  process.exitCode = 1;
});