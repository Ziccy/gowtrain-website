const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");

/*
 * Alleen lokale configuratie laden voor CRON_SECRET.
 * Geen secrets afdrukken.
 * Geen Stripe- of databaseclient importeren.
 */
loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});

const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error(
    "TEST GESTOPT: CRON_SECRET ontbreekt in de lokale configuratie.",
  );
  process.exit(1);
}

const url =
  "http://127.0.0.1:3000/api/cron/reconcile-trainer-transfers";

async function check(method, authenticated) {
  const response = await fetch(url, {
    method,
    headers: authenticated
      ? { Authorization: `Bearer ${secret}` }
      : {},
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal(
    response.status,
    authenticated ? 503 : 401,
    `${method}: onverwachte HTTP-status ${response.status}`,
  );

  assert.ok(
    response.headers.get("cache-control")?.includes("no-store"),
    `${method}: Cache-Control no-store ontbreekt`,
  );

  const body = await response.json();

  if (authenticated) {
    assert.equal(body.success, false);
    assert.equal(body.code, "TRANSFER_RECOVERY_DISABLED");
  } else {
    assert.equal(body.error, "Niet geautoriseerd.");
  }

  console.log(
    `GESLAAGD: ${method} ${
      authenticated
        ? "met authenticatie → herstel uitgeschakeld"
        : "zonder authenticatie → geweigerd"
    }`,
  );
}

async function main() {
  await check("GET", false);
  await check("POST", false);
  await check("GET", true);
  await check("POST", true);

  console.log(
    "\nALLE 4 ROUTETESTS GESLAAGD. " +
      "Geauthenticeerde aanroepen geven TRANSFER_RECOVERY_DISABLED.",
  );
}

main().catch(() => {
  // Geen requestheaders, configuratie of vrije foutobjecten loggen.
  console.error(
    "ROUTETEST MISLUKT. Controleer de lokale server, " +
      "beide uitgeschakelde vlaggen en de lokale CRON_SECRET-configuratie. " +
      "Deel geen geheime waarden.",
  );
  process.exitCode = 1;
});