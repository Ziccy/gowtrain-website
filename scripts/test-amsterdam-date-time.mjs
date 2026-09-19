import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--child")) {
  const {
    addCalendarDays,
    createAmsterdamDateFromInputs,
    getAmsterdamDateInputs,
  } = await import("../lib/amsterdam-date-time.ts");

  const cases = [
    ["2026-10-01", "18:00", "2026-10-01T16:00:00.000Z"],
    ["2026-10-08", "18:00", "2026-10-08T16:00:00.000Z"],
    ["2026-10-15", "18:00", "2026-10-15T16:00:00.000Z"],
    ["2026-10-22", "18:00", "2026-10-22T16:00:00.000Z"],
    ["2026-10-29", "18:00", "2026-10-29T17:00:00.000Z"],

    // Ook de overgang naar zomertijd controleren.
    ["2027-03-21", "18:00", "2027-03-21T17:00:00.000Z"],
    ["2027-03-28", "18:00", "2027-03-28T16:00:00.000Z"],
  ];

  for (const [date, time, expectedIso] of cases) {
    const actual = createAmsterdamDateFromInputs(date, time);

    assert.ok(actual, `Geen datum teruggegeven voor ${date} ${time}`);
    assert.equal(actual.toISOString(), expectedIso);

    const local = getAmsterdamDateInputs(actual);

    assert.equal(local.date, date);
    assert.equal(`${local.hour}:${local.minute}`, time);
  }

  assert.equal(addCalendarDays("2026-10-01", 28), "2026-10-29");
  assert.equal(addCalendarDays("2026-12-28", 7), "2027-01-04");

  // Ongeldige kalenderdatum.
  assert.equal(
    createAmsterdamDateFromInputs("2026-02-30", "18:00"),
    null,
  );

  // Niet-bestaande lokale tijd tijdens de zomertijdwisseling.
  assert.equal(
    createAmsterdamDateFromInputs("2027-03-28", "02:30"),
    null,
  );

  // Dubbelzinnige lokale tijd tijdens de wintertijdwisseling.
  assert.equal(
    createAmsterdamDateFromInputs("2026-10-25", "02:30"),
    null,
  );

  console.log(`GESLAAGD — computertijdzone: ${process.env.TZ}`);
} else {
  const scriptPath = fileURLToPath(import.meta.url);

  for (const timeZone of [
    "Europe/Amsterdam",
    "UTC",
    "America/New_York",
  ]) {
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--child"],
      {
        env: {
          ...process.env,
          TZ: timeZone,
        },
        encoding: "utf8",
      },
    );

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.error) throw result.error;

    if (result.status !== 0) {
      throw new Error(`Tijdzonetest mislukt voor ${timeZone}`);
    }
  }

  console.log("ALLE TIJDZONETESTS GESLAAGD. Geen gegevens gewijzigd.");
}