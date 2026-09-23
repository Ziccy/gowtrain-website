const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});

async function main() {
  const origin = process.env.RECOVERY_TEST_SITE_ORIGIN;
  const secret = process.env.CRON_SECRET;

  if (!origin || !secret) {
    throw new Error("Configuratie ontbreekt");
  }

  const site = new URL(origin);

  assert.equal(site.protocol, "https:");
  assert.equal(site.username, "");
  assert.equal(site.password, "");
  assert.equal(site.pathname, "/");
  assert.equal(site.search, "");
  assert.equal(site.hash, "");

  const url = new URL(
    "/api/cron/reconcile-trainer-transfers",
    site,
  );

  // Eerst zonder authenticatie.
  const anonymous = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  console.log(`Zonder authenticatie: HTTP ${anonymous.status}`);
  assert.equal(anonymous.status, 401);

  // Precies één geauthenticeerde aanroep; geen retry.
  const authenticated = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  console.log(`Met authenticatie: HTTP ${authenticated.status}`);
  assert.equal(authenticated.status, 503);
  assert.ok(
    authenticated.headers.get("cache-control")?.includes("no-store"),
  );

  const body = await authenticated.json();
  assert.equal(body.success, false);
  assert.equal(body.code, "TRANSFER_RECOVERY_DISABLED");

  console.log(
    "GESLAAGD: gedeployde route weigert anonieme toegang " +
      "en blijft met authenticatie uitgeschakeld.",
  );
}

main().catch(() => {
  console.error(
    "DEPLOYCONTROLE NIET BEVESTIGD. Niet automatisch herhalen. " +
      "Deel alleen deze melding en de getoonde HTTP-statussen, geen secrets.",
  );
  process.exitCode = 1;
});