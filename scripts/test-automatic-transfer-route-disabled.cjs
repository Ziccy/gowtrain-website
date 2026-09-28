const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});

const URL =
  "http://127.0.0.1:3011/api/cron/execute-sandbox-trainer-transfer";

async function main() {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("TEST GESTOPT: lokale CRON_SECRET ontbreekt.");
    process.exitCode = 1;
    return;
  }

  // 1. Geen authenticatie: weigeren.
  const anonymous = await fetch(URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal(anonymous.status, 401);
  assert.ok(
    anonymous.headers.get("cache-control")?.includes("no-store"),
  );
  console.log("GESLAAGD 1: POST zonder authenticatie geeft 401.");

  // 2. Geldige authenticatie: uitvoering blijft uit.
  const disabled = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal(disabled.status, 503);
  assert.ok(
    disabled.headers.get("cache-control")?.includes("no-store"),
  );

  const body = await disabled.json();

  assert.equal(body.success, false);
  assert.equal(body.result, "disabled");
  assert.equal(body.code, "TRANSFER_AUTO_EXECUTION_DISABLED");

  console.log(
    "GESLAAGD 2: geauthenticeerde POST geeft TRANSFER_AUTO_EXECUTION_DISABLED.",
  );

  // 3. GET is geen ondersteunde uitvoeringsmethode.
  const get = await fetch(URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal(get.status, 405);
  console.log("GESLAAGD 3: GET geeft 405.");

  console.log(
    "\nALLE 3 ROUTETESTS GESLAAGD. " +
      "De geauthenticeerde POST bevestigt de uitgeschakelde tak.",
  );
}

main().catch(() => {
  // Geen headers, secrets of vrije foutobjecten afdrukken.
  console.error(
    "ROUTETEST NIET BEVESTIGD. Stop de testserver. " +
      "Controleer eerst de vlaggen en administratie; niet blind herhalen.",
  );
  process.exitCode = 1;
});