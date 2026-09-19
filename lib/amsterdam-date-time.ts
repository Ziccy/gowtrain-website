const TIME_ZONE = "Europe/Amsterdam";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function readParts(value: Date) {
  const parts = partsFormatter.formatToParts(value);

  const number = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    second: number("second"),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function getAmsterdamDateInputs(value: Date): {
  date: string;
  hour: string;
  minute: string;
} {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Ongeldige datum.");
  }

  const parts = readParts(value);

  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    hour: pad(parts.hour),
    minute: pad(parts.minute),
  };
}

function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);

  // Expliciete scope voor de huidige planningsformulieren.
  if (year < 2000 || year > 2100) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/*
 * Kalenderdagen verschuiven, niet een hoeveelheid verstreken uren.
 * UTC wordt hier uitsluitend gebruikt voor kalenderrekenen.
 */
export function addCalendarDays(
  dateValue: string,
  days: number,
): string | null {
  const date = parseCalendarDate(dateValue);

  if (!date || !Number.isSafeInteger(days)) return null;

  date.setUTCDate(date.getUTCDate() + days);

  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 2000 ||
    date.getUTCFullYear() > 2100
  ) {
    return null;
  }

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-");
}

/*
 * Interpreteert datum + tijd als Amsterdamse lokale tijd.
 * De tijdzone van de browser wordt niet gebruikt.
 */
export function createAmsterdamDateFromInputs(
  dateValue: string,
  timeValue: string,
): Date | null {
  const calendarDate = parseCalendarDate(dateValue);

  if (!calendarDate || !/^\d{2}:\d{2}$/.test(timeValue)) {
    return null;
  }

  const [hour, minute] = timeValue.split(":").map(Number);

  if (hour > 23 || minute > 59) return null;

  const localAsUtc = Date.UTC(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth(),
    calendarDate.getUTCDate(),
    hour,
    minute,
    0,
  );

  /*
   * Verzamel de Amsterdamse offsets rond deze datum.
   * Ook beide zijden van een zomer-/wintertijdwisseling meenemen.
   */
  const offsets = new Set<number>();

  for (const hours of [-36, 0, 36]) {
    const sampleMs = localAsUtc + hours * 60 * 60 * 1000;
    const parts = readParts(new Date(sampleMs));

    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );

    offsets.add(representedAsUtc - sampleMs);
  }

  const matches = new Set<number>();

  for (const offset of offsets) {
    const candidateMs = localAsUtc - offset;
    const parts = readParts(new Date(candidateMs));

    if (
      parts.year === calendarDate.getUTCFullYear() &&
      parts.month === calendarDate.getUTCMonth() + 1 &&
      parts.day === calendarDate.getUTCDate() &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === 0
    ) {
      matches.add(candidateMs);
    }
  }

  // Geen match: niet-bestaande tijd. Twee matches: dubbelzinnige tijd.
  if (matches.size !== 1) return null;

  return new Date([...matches][0]);
}

export function formatAmsterdamDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(value)
    .toUpperCase();
}