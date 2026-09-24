"use client";

import type { FormEvent } from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";
import {
  addCalendarDays,
  getAmsterdamDateInputs,
} from "@/lib/amsterdam-date-time";

type Sport = "padel" | "tennis";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: string;
};

type Pattern = {
  id: string;
  trainer_id: string;
  is_active: boolean;
  updated_at: string;
};

type Version = {
  recurring_availability_id: string;
  effective_from: string;
  weekday: number;
  starts_at_time: string;
  ends_at_time: string;
  duration_minutes: number;
  sport: Sport;
  location_id: string;
  max_participants: number;
  price_cents: number;
  currency: string;
  level: string | null;
  booking_deadline_hours: number;
  recorded_at: string;
};

type Venue = {
  id: string;
  name: string;
  address_line: string | null;
  postal_code: string | null;
  city: string;
  sports: Sport[];
};

type LoadedPage = {
  userId: string;
  trainer: TrainerAccount;
  pattern: Pattern;
  versions: Version[];
};

type SaveResult = {
  effectiveFrom: string;
  cancelled: number;
  created: number;
  skipped: number;
  wasPaused: boolean;
};

const WEEKDAYS = [
  { value: 1, short: "MA", label: "Maandag" },
  { value: 2, short: "DI", label: "Dinsdag" },
  { value: 3, short: "WO", label: "Woensdag" },
  { value: 4, short: "DO", label: "Donderdag" },
  { value: 5, short: "VR", label: "Vrijdag" },
  { value: 6, short: "ZA", label: "Zaterdag" },
  { value: 7, short: "ZO", label: "Zondag" },
];

const DURATIONS = [30, 60, 90, 120];
const PARTICIPANTS = [1, 2, 3, 4];
const HOURS = Array.from(
  { length: 17 },
  (_, index) => String(index + 7).padStart(2, "0"),
);
const MINUTES = ["00", "15", "30", "45"];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VERSION_SELECT = `
  recurring_availability_id,
  effective_from,
  weekday,
  starts_at_time,
  ends_at_time,
  duration_minutes,
  sport,
  location_id,
  max_participants,
  price_cents,
  currency,
  level,
  booking_deadline_hours,
  recorded_at
`;

function todayAmsterdam() {
  return getAmsterdamDateInputs(new Date()).date;
}

function formatDate(value: string) {
  if (value === "-infinity") return "de uitgangssituatie";

  // Kalenderdatum weergeven, niet de lokale browsertijd gebruiken.
  const date = new Date(`${value}T12:00:00Z`);

  if (!Number.isFinite(date.getTime())) return "onbekende datum";

  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function weekdayLabel(value: number) {
  return WEEKDAYS.find((item) => item.value === value)?.label ?? "Onbekend";
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function parsePrice(value: string): number | null {
  const normalized = value.trim().replace(",", ".");

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;

  const cents = Math.round(Number(normalized) * 100);

  return Number.isSafeInteger(cents) &&
    cents > 0 &&
    cents <= 2147483647
    ? cents
    : null;
}

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function venueLabel(venue: Venue) {
  return `${venue.city} — ${venue.name}`;
}

function sortedVersions(versions: Version[]) {
  return [...versions].sort((a, b) => {
    if (a.effective_from === b.effective_from) return 0;
    if (a.effective_from === "-infinity") return -1;
    if (b.effective_from === "-infinity") return 1;
    return a.effective_from.localeCompare(b.effective_from);
  });
}

function minimumEffectiveDate(versions: Version[], today: string) {
  const sorted = sortedVersions(versions);
  const latest = sorted[sorted.length - 1];

  if (!latest || latest.effective_from === "-infinity") {
    return today;
  }

  return latest.effective_from > today
    ? latest.effective_from
    : today;
}

function versionsFingerprint(versions: Version[]) {
  return JSON.stringify(sortedVersions(versions));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

async function readPage(patternId: string): Promise<LoadedPage> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      "Je sessie kon niet worden gecontroleerd. Log zo nodig opnieuw in.",
    );
  }

  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("id, is_active, approval_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (trainerError) throw trainerError;
  if (!trainer) throw new Error("Geen trainerprofiel gevonden.");

  const { data: pattern, error: patternError } = await supabase
    .from("recurring_availability")
    .select("id, trainer_id, is_active, updated_at")
    .eq("id", patternId)
    .eq("trainer_id", trainer.id)
    .maybeSingle();

  if (patternError) throw patternError;
  if (!pattern) {
    throw new Error("Deze reeks bestaat niet of is niet van jouw account.");
  }

  const versions: Version[] = [];
  const pageSize = 100;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("recurring_availability_versions")
      .select(VERSION_SELECT)
      .eq("recurring_availability_id", patternId)
      .order("effective_from", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const page = (data ?? []) as Version[];
    versions.push(...page);

    if (page.length < pageSize) break;
  }

  if (!versions.length) {
    throw new Error(
      "Er zijn geen leesbare reeksversies gevonden. Wijzigen is daarom geblokkeerd.",
    );
  }

  return {
    userId: user.id,
    trainer: trainer as TrainerAccount,
    pattern: pattern as Pattern,
    versions: sortedVersions(versions),
  };
}

export default function TrainerBeschikbaarheidWijzigenPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const patternId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [baseVersion, setBaseVersion] = useState<Version | null>(null);

  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [today, setToday] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [startHour, setStartHour] = useState("18");
  const [startMinute, setStartMinute] = useState("00");
  const [endHour, setEndHour] = useState("21");
  const [endMinute, setEndMinute] = useState("00");
  const [duration, setDuration] = useState(60);
  const [sport, setSport] = useState<Sport>("padel");
  const [participants, setParticipants] = useState(1);
  const [price, setPrice] = useState("");

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [venueSearch, setVenueSearch] = useState("");
  const [venueOpen, setVenueOpen] = useState(false);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [venueError, setVenueError] = useState("");
  const [venueRetry, setVenueRetry] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SaveResult | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [retry, setRetry] = useState(0);

  const saveLock = useRef(false);
  const mounted = useRef(true);
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const venueContainerRef = useRef<HTMLDivElement | null>(null);

  const startTime = `${startHour}:${startMinute}`;
  const endTime = `${endHour}:${endMinute}`;
  const blockMinutes = timeMinutes(endTime) - timeMinutes(startTime);
  const possibleSlots = blockMinutes >= duration
    ? Math.floor(blockMinutes / duration)
    : 0;
  const remainderMinutes = possibleSlots > 0
    ? blockMinutes - possibleSlots * duration
    : 0;

  const priceCents = parsePrice(price);
  const currency = baseVersion?.currency ?? "eur";

  const trainerActive =
    loaded?.trainer.is_active === true &&
    loaded.trainer.approval_status === "approved";

  const formDisabled =
    saving || mustReload || result !== null || !trainerActive;

  const minDate = loaded
    ? minimumEffectiveDate(loaded.versions, today)
    : today;

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === venueId) ?? null,
    [venues, venueId],
  );

  const filteredVenues = useMemo(() => {
    const query = venueSearch.trim().toLocaleLowerCase("nl-NL");

    return venues.filter((venue) =>
      [venue.name, venue.city, venue.address_line, venue.postal_code]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("nl-NL")
        .includes(query),
    );
  }, [venues, venueSearch]);

  useEffect(() => {
    mounted.current = true;

    const tick = () => setToday(todayAmsterdam());
    tick();
    const timer = window.setInterval(tick, 60_000);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setLoadError("");
      setError("");
      setResult(null);
      setConfirmationOpen(false);
      setLoaded(null);
      setBaseVersion(null);

      try {
        if (!patternId || !UUID_PATTERN.test(patternId)) {
          throw new Error("Deze reekslink is ongeldig.");
        }

        const page = await readPage(patternId);
        if (!active) return;

        const latest = page.versions[page.versions.length - 1];
        const localToday = todayAmsterdam();

        setLoaded(page);
        setBaseVersion(latest);
        setToday(localToday);
        setEffectiveFrom(
          minimumEffectiveDate(page.versions, localToday),
        );

        setWeekday(latest.weekday);
        setStartHour(latest.starts_at_time.slice(0, 2));
        setStartMinute(latest.starts_at_time.slice(3, 5));
        setEndHour(latest.ends_at_time.slice(0, 2));
        setEndMinute(latest.ends_at_time.slice(3, 5));
        setDuration(latest.duration_minutes);
        setSport(latest.sport);
        setParticipants(latest.max_participants);
        setPrice((latest.price_cents / 100).toFixed(2));
        setVenueId(latest.location_id);
        setVenueSearch("");
        setVenueOpen(false);
        setMustReload(false);
      } catch (error) {
        console.error("Reeks voor bewerken laden mislukt:", error);

        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "De reeks kon niet worden geladen.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [patternId, retry]);

  useEffect(() => {
    if (!loaded) return;

    let active = true;

    async function loadVenues() {
      setVenuesLoading(true);
      setVenueError("");
      setVenues([]);

      try {
        const all: Venue[] = [];
        const pageSize = 200;

        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .from("venues")
            .select("id, name, address_line, postal_code, city, sports")
            .eq("is_active", true)
            .contains("sports", [sport])
            .order("city", { ascending: true })
            .order("name", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);

          if (error) throw error;
          if (!active) return;

          const page = (data ?? []) as Venue[];
          all.push(...page);

          if (page.length < pageSize) break;
        }

        if (active) setVenues(all);
      } catch (error) {
        console.error("Locaties laden mislukt:", error);

        if (active) {
          setVenueError("De trainingslocaties konden niet worden geladen.");
        }
      } finally {
        if (active) setVenuesLoading(false);
      }
    }

    void loadVenues();

    return () => {
      active = false;
    };
  }, [loaded, sport, venueRetry]);

  useEffect(() => {
    if (!error && !result && !confirmationOpen) return;

    feedbackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    feedbackRef.current?.focus();
  }, [error, result, confirmationOpen]);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        venueContainerRef.current &&
        !venueContainerRef.current.contains(event.target)
      ) {
        setVenueOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOutside);

    return () => {
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, []);

  useEffect(() => {
    if (!saving) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [saving]);

  function changed() {
    setError("");
    setConfirmationOpen(false);
  }

  function reload() {
    if (saveLock.current) return;
    setRetry((value) => value + 1);
  }

  function changeSport(value: Sport) {
    if (formDisabled || sport === value) return;

    changed();
    setSport(value);
    setVenueId("");
    setVenueSearch("");
    setVenueOpen(false);
    setVenues([]);
    setVenuesLoading(true);
  }

  function validate(): string | null {
    if (!loaded || !baseVersion) return "De reeks is niet geladen.";
    if (!trainerActive) return "Je trainerprofiel is niet actief en goedgekeurd.";

    const localToday = todayAmsterdam();
    const minimum = minimumEffectiveDate(loaded.versions, localToday);

    if (
      !effectiveFrom ||
      addCalendarDays(effectiveFrom, 0) !== effectiveFrom ||
      effectiveFrom < minimum
    ) {
      return `Kies een geldige ingangsdatum vanaf ${formatDate(minimum)}.`;
    }

    if (
      !WEEKDAYS.some((item) => item.value === weekday) ||
      !DURATIONS.includes(duration) ||
      !PARTICIPANTS.includes(participants) ||
      !HOURS.includes(startHour) ||
      !HOURS.includes(endHour) ||
      !MINUTES.includes(startMinute) ||
      !MINUTES.includes(endMinute)
    ) {
      return "Controleer weekdag, tijden, lesduur en aantal spelers.";
    }

    if (blockMinutes <= 0 || possibleSlots < 1) {
      return "De eindtijd moet na de starttijd liggen en de lesduur moet in het blok passen.";
    }

    if (
      venuesLoading ||
      venueError ||
      !selectedVenue ||
      !selectedVenue.sports.includes(sport)
    ) {
      return "Kies een actieve locatie voor de geselecteerde sport.";
    }

    if (priceCents === null) {
      return "Vul een positieve prijs per les in met maximaal twee decimalen.";
    }

    return null;
  }

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saveLock.current || formDisabled) return;

    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setConfirmationOpen(true);
  }

  async function save() {
    if (
      saveLock.current ||
      !confirmationOpen ||
      !loaded ||
      !baseVersion ||
      mustReload ||
      result
    ) {
      return;
    }

    const validationError = validate();

    if (validationError) {
      setConfirmationOpen(false);
      setError(validationError);
      return;
    }

    const amount = parsePrice(price);
    if (amount === null) return;

    saveLock.current = true;
    setSaving(true);
    setError("");

    let requestStarted = false;

    try {
      // Extra hercontrole vóór de mutatie.
      // De RPC blijft verantwoordelijk voor server-side autorisatie en locks.
      const fresh = await readPage(loaded.pattern.id);

      if (!mounted.current) return;

      if (
        fresh.userId !== loaded.userId ||
        fresh.trainer.id !== loaded.trainer.id
      ) {
        throw new Error("Je ingelogde account is gewijzigd.");
      }

      if (
        !fresh.trainer.is_active ||
        fresh.trainer.approval_status !== "approved"
      ) {
        throw new Error("Je trainerprofiel is niet meer actief en goedgekeurd.");
      }

      if (
        fresh.pattern.is_active !== loaded.pattern.is_active ||
        fresh.pattern.updated_at !== loaded.pattern.updated_at ||
        versionsFingerprint(fresh.versions) !==
          versionsFingerprint(loaded.versions)
      ) {
        throw new Error(
          "De reeks of een geplande versie is ondertussen gewijzigd. Laad de actuele gegevens opnieuw.",
        );
      }

      requestStarted = true;

      const { data, error: rpcError } = await supabase.rpc(
        "update_recurring_availability_from_date",
        {
          p_recurring_availability_id: loaded.pattern.id,
          p_effective_from: effectiveFrom,
          p_weekday: weekday,
          p_starts_at_time: `${startTime}:00`,
          p_ends_at_time: `${endTime}:00`,
          p_duration_minutes: duration,
          p_sport: sport,
          p_location_id: venueId,
          p_max_participants: participants,
          p_price_cents: amount,

          // Bewaar de waarden van de geladen versie.
          p_level: baseVersion.level,
          p_booking_deadline_hours: baseVersion.booking_deadline_hours,
        },
      );

      if (rpcError) throw rpcError;
      if (!mounted.current) return;

      const response: unknown = Array.isArray(data)
        ? data.length === 1 ? data[0] : null
        : data;

      if (
        !isObject(response) ||
        response.recurring_availability_id !== loaded.pattern.id ||
        !isCount(response.cancelled_slots) ||
        !isCount(response.created_slots) ||
        !isCount(response.skipped_slots)
      ) {
        throw new Error("De serverrespons kon niet worden bevestigd.");
      }

      setConfirmationOpen(false);
      setResult({
        effectiveFrom,
        cancelled: response.cancelled_slots,
        created: response.created_slots,
        skipped: response.skipped_slots,
        wasPaused: !loaded.pattern.is_active,
      });
    } catch (error) {
      console.error("Reekswijziging niet bevestigd:", error);

      if (mounted.current) {
        const message = error instanceof Error
          ? error.message
          : isObject(error) && typeof error.message === "string"
            ? error.message
            : "De wijziging kon niet worden bevestigd.";

        setConfirmationOpen(false);
        setMustReload(true);
        setError(
          `${message} ${
            requestStarted
              ? "De aanvraag kan al verwerkt zijn. Controleer eerst de opgeslagen versies; we herhalen de wijziging niet automatisch."
              : "Er is nog geen wijzigings-RPC verstuurd. Laad eerst de actuele gegevens opnieuw."
          }`,
        );
      }
    } finally {
      saveLock.current = false;

      if (mounted.current) setSaving(false);
    }
  }

  const inputClass =
    "min-h-12 w-full border-2 border-white/25 bg-[#14171A] px-3 py-3 text-white outline-none focus:border-[#D6FF3F] disabled:opacity-60";

  const buttonClass =
    "inline-flex min-h-11 items-center justify-center px-4 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-50";

  function option(label: string, selected: boolean, onClick: () => void) {
    return (
      <button
        key={label}
        type="button"
        aria-pressed={selected}
        onClick={() => {
          changed();
          onClick();
        }}
        className={`${buttonClass} border-2 ${
          selected
            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
            : "border-white/25 text-white hover:border-white"
        }`}
      >
        {label}
      </button>
    );
  }

  const futureVersions = loaded?.versions.filter(
    (version) =>
      version.effective_from !== "-infinity" &&
      version.effective_from > today,
  ) ?? [];

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-8 sm:py-12">
        <div className="mx-auto max-w-4xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-5 border-b-2 border-white/20 pb-6 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-base text-[#FF4B3E]">
                ROOSTERBEHEER
              </p>
              <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
                WIJZIG VASTE REEKS.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#B9BEC2]">
                Pas toekomstige vrije momenten aan vanaf een gekozen datum.
                Gereserveerde en geboekte lessen blijven ongewijzigd.
              </p>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => router.push("/trainer-beschikbaarheid")}
              className={`${buttonClass} shrink-0 border-2 border-white text-white hover:border-[#D6FF3F]`}
            >
              ← VASTE MOMENTEN
            </button>
          </div>

          {loading ? (
            <p className="py-12 font-display text-xl text-[#D6FF3F]">
              REEKS LADEN...
            </p>
          ) : loadError ? (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-5">
              <p>{loadError}</p>
              <button
                type="button"
                onClick={reload}
                className={`${buttonClass} mt-4 bg-white text-[#14171A]`}
              >
                OPNIEUW LADEN
              </button>
            </div>
          ) : loaded && baseVersion ? (
            <>
              <div
                ref={feedbackRef}
                tabIndex={-1}
                className="mt-6 space-y-4 outline-none"
              >
                {error && (
                  <div role="alert" className="border-2 border-[#FF4B3E] p-5 text-sm leading-relaxed">
                    {error}
                  </div>
                )}

                {mustReload && (
                  <div className="border border-white/25 p-5">
                    <p className="text-sm leading-relaxed text-[#B9BEC2]">
                      Opnieuw laden vervangt je invoer door de laatste opgeslagen
                      reeksversie. Niet-opgeslagen invoer gaat verloren.
                    </p>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={reload}
                      className={`${buttonClass} mt-3 bg-[#D6FF3F] text-[#14171A]`}
                    >
                      LAAD OPGESLAGEN VERSIES
                    </button>
                  </div>
                )}

                {result && (
                  <div role="status" className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A]">
                    <h2 className="font-display text-2xl">WIJZIGING OPGESLAGEN</h2>
                    <p className="mt-2 text-sm">
                      Nieuwe planning vanaf {formatDate(result.effectiveFrom)}.
                    </p>
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                      <li>{result.cancelled} toekomstige vrije slots ingetrokken.</li>
                      <li>{result.created} vervangende slots aangemaakt.</li>
                      <li>{result.skipped} kandidaten overgeslagen.</li>
                    </ul>
                    <p className="mt-3 text-sm leading-relaxed">
                      {result.wasPaused
                        ? "De reeks was gepauzeerd en wordt door deze bewerking niet geactiveerd. Er worden pas bij activeren nieuwe slots aangevuld."
                        : "De aanvulling is uitgevoerd voor het deel van de nieuwe planning binnen de huidige achtwekenhorizon."}
                    </p>
                    <p className="mt-2 text-xs">
                      Nul nieuwe slots kan correct zijn bij een latere ingangsdatum
                      buiten de horizon of bij bestaande conflicten.
                    </p>
                    <button
                      type="button"
                      onClick={() => router.push("/trainer-beschikbaarheid")}
                      className={`${buttonClass} mt-4 bg-[#14171A] text-white`}
                    >
                      TERUG NAAR VASTE MOMENTEN
                    </button>
                  </div>
                )}

                {confirmationOpen && !result && (
                  <section className="border-2 border-[#FF4B3E] bg-[#1E2327] p-5">
                    <h2 className="font-display text-2xl">WIJZIGING BEVESTIGEN?</h2>
                    <p className="mt-3 text-sm leading-relaxed text-[#D7D9DA]">
                      Vanaf 00:00 op {formatDate(effectiveFrom)} in
                      Europe/Amsterdam worden toekomstige vrije slots van
                      deze reeks ingetrokken en volgens de nieuwe planning
                      aangevuld. Slots vóór die datum en gereserveerde of
                      geboekte lessen blijven ongewijzigd.
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-[#D6FF3F]">
                      {loaded.pattern.is_active
                        ? "De reeks is actief: vervangende momenten worden direct binnen de achtwekenhorizon aangevuld."
                        : "De reeks is gepauzeerd: oude vrije momenten worden ingetrokken, maar nieuwe momenten worden nog niet aangemaakt."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setConfirmationOpen(false)}
                        className={`${buttonClass} border-2 border-white text-white`}
                      >
                        TOCH NIET
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void save()}
                        className={`${buttonClass} bg-[#FF4B3E] text-white`}
                      >
                        {saving ? "OPSLAAN..." : "JA, SLA WIJZIGING OP"}
                      </button>
                    </div>
                  </section>
                )}
              </div>

              {!trainerActive && (
                <p className="mt-6 border border-[#FF4B3E] p-4 text-sm">
                  Je trainerprofiel moet actief en goedgekeurd zijn om te wijzigen.
                </p>
              )}

              <div className="mt-6 border border-white/25 bg-white/[0.03] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-lg text-[#D6FF3F]">
                    GELADEN UITGANGSPUNT
                  </h2>
                  <span className="border border-white/25 px-3 py-1 font-display text-xs">
                    {loaded.pattern.is_active ? "ACTIEF" : "GEPAUZEERD"}
                  </span>
                </div>

                <p className="mt-3 text-sm">
                  {weekdayLabel(baseVersion.weekday)} ·{" "}
                  {baseVersion.starts_at_time.slice(0, 5)}–
                  {baseVersion.ends_at_time.slice(0, 5)} ·{" "}
                  {baseVersion.duration_minutes} min ·{" "}
                  {formatMoney(baseVersion.price_cents, baseVersion.currency)} per les
                </p>

                <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
                  {baseVersion.effective_from === "-infinity"
                    ? "De gemigreerde uitgangsversie is geladen."
                    : `De laatst opgeslagen versie is geladen, geldig vanaf ${formatDate(baseVersion.effective_from)}.`}
                  {" "}Een nieuwe wijziging vóór een al geplande latere versie
                  wordt niet ondersteund. Je kunt de laatste versie op dezelfde
                  ingangsdatum aanpassen of een latere datum kiezen.
                </p>

                {futureVersions.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer py-2 font-display text-sm text-[#D6FF3F]">
                      GEPLANDE VERSIES ({futureVersions.length})
                    </summary>
                    <ul className="space-y-2 text-xs text-[#B9BEC2]">
                      {futureVersions.map((version) => (
                        <li key={version.effective_from}>
                          Vanaf {formatDate(version.effective_from)}:{" "}
                          {weekdayLabel(version.weekday)}{" "}
                          {version.starts_at_time.slice(0, 5)}–
                          {version.ends_at_time.slice(0, 5)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              <form onSubmit={requestConfirmation} className="mt-6">
                <fieldset
                  disabled={formDisabled}
                  className="min-w-0 space-y-6 border-2 border-white/30 bg-[#1E2327] p-5 sm:p-6"
                >
                  <div>
                    <label htmlFor="effective-from" className="font-display text-sm text-[#D6FF3F]">
                      WIJZIGING GELDT VANAF
                    </label>
                    <input
                      id="effective-from"
                      type="date"
                      min={minDate}
                      max="2100-12-31"
                      required
                      value={effectiveFrom}
                      onChange={(event) => {
                        changed();
                        setEffectiveFrom(event.target.value);
                      }}
                      className={`${inputClass} mt-2 [color-scheme:dark]`}
                    />
                    <p className="mt-2 text-xs text-[#B9BEC2]">
                      Vanaf deze datum, inclusief die dag. Eerder dan{" "}
                      {formatDate(minDate)} is hier niet mogelijk.
                    </p>
                  </div>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">SPORT</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["padel", "tennis"] as Sport[]).map((value) =>
                        option(value.toUpperCase(), sport === value, () => changeSport(value)),
                      )}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">ELKE</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) =>
                        option(day.short, weekday === day.value, () => setWeekday(day.value)),
                      )}
                    </div>
                  </fieldset>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="start-hour" className="font-display text-sm text-[#D6FF3F]">
                        VAN
                      </label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          id="start-hour"
                          value={startHour}
                          onChange={(event) => {
                            changed();
                            setStartHour(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {HOURS.map((value) => (
                            <option key={value} value={value}>{value} uur</option>
                          ))}
                        </select>
                        <select
                          aria-label="Startminuten"
                          value={startMinute}
                          onChange={(event) => {
                            changed();
                            setStartMinute(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {MINUTES.map((value) => (
                            <option key={value} value={value}>:{value}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="end-hour" className="font-display text-sm text-[#D6FF3F]">
                        TOT
                      </label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          id="end-hour"
                          value={endHour}
                          onChange={(event) => {
                            changed();
                            setEndHour(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {HOURS.map((value) => (
                            <option key={value} value={value}>{value} uur</option>
                          ))}
                        </select>
                        <select
                          aria-label="Eindminuten"
                          value={endMinute}
                          onChange={(event) => {
                            changed();
                            setEndMinute(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {MINUTES.map((value) => (
                            <option key={value} value={value}>:{value}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-[#B9BEC2]">
                    Tijdsblok: {startTime}–{endTime}, Nederlandse tijd.
                  </p>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">DUUR PER LES</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {DURATIONS.map((value) =>
                        option(`${value} min`, duration === value, () => setDuration(value)),
                      )}
                    </div>
                    <p className="mt-2 text-xs text-[#B9BEC2]">
                      {possibleSlots} volledige lessen per tijdsblok.
                      {remainderMinutes > 0
                        ? ` ${remainderMinutes} resterende minuten worden niet aangeboden.`
                        : ""}
                    </p>
                  </fieldset>

                  <div ref={venueContainerRef}>
                    <label htmlFor="venue-search" className="font-display text-sm text-[#D6FF3F]">
                      TRAININGSLOCATIE
                    </label>

                    <input
                      id="venue-search"
                      type="search"
                      autoComplete="off"
                      value={
                        venueOpen
                          ? venueSearch
                          : selectedVenue
                            ? venueLabel(selectedVenue)
                            : venueSearch
                      }
                      disabled={venuesLoading || formDisabled}
                      aria-expanded={venueOpen}
                      aria-controls="venue-results"
                      onFocus={() => {
                        setVenueSearch("");
                        setVenueOpen(true);
                      }}
                      onChange={(event) => {
                        changed();
                        setVenueSearch(event.target.value);
                        setVenueOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setVenueOpen(false);
                      }}
                      placeholder={venuesLoading ? "Locaties laden..." : "Zoek stad of club"}
                      className={`${inputClass} mt-2`}
                    />

                    {venueOpen && !venuesLoading && !venueError && (
                      <div id="venue-results" className="mt-2 max-h-64 overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A]">
                        {filteredVenues.length ? filteredVenues.map((venue) => (
                          <button
                            key={venue.id}
                            type="button"
                            onClick={() => {
                              changed();
                              setVenueId(venue.id);
                              setVenueSearch("");
                              setVenueOpen(false);
                            }}
                            className="block w-full border-b border-white/15 px-4 py-3 text-left transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                          >
                            <span className="block font-semibold">{venueLabel(venue)}</span>
                            <span className="mt-1 block text-xs opacity-75">
                              {[venue.address_line, venue.postal_code].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                        )) : (
                          <p className="p-4 text-sm text-[#B9BEC2]">Geen locaties gevonden.</p>
                        )}
                      </div>
                    )}

                    {venueError && (
                      <div className="mt-2">
                        <p role="alert" className="text-sm text-[#FF8A80]">{venueError}</p>
                        <button
                          type="button"
                          onClick={() => setVenueRetry((value) => value + 1)}
                          className={`${buttonClass} mt-2 border border-white/30`}
                        >
                          LOCATIES OPNIEUW LADEN
                        </button>
                      </div>
                    )}

                    {!venuesLoading && !venueError && !selectedVenue && (
                      <p className="mt-2 text-xs text-[#B9BEC2]">
                        Kies een geldige locatie. Een eerder opgeslagen,
                        inactieve locatie kan niet opnieuw worden geselecteerd.
                      </p>
                    )}
                  </div>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">MAXIMAAL SPELERS</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {PARTICIPANTS.map((value) =>
                        option(
                          `${value} ${value === 1 ? "speler" : "spelers"}`,
                          participants === value,
                          () => setParticipants(value),
                        ),
                      )}
                    </div>
                  </fieldset>

                  <div>
                    <label htmlFor="price" className="font-display text-sm text-[#D6FF3F]">
                      PRIJS PER LES INCLUSIEF BAANHUUR ({currency.toUpperCase()})
                    </label>
                    <input
                      id="price"
                      type="text"
                      inputMode="decimal"
                      required
                      value={price}
                      onChange={(event) => {
                        changed();
                        setPrice(event.target.value);
                      }}
                      className={`${inputClass} mt-2`}
                    />
                  </div>

                  <div className="border border-white/20 bg-[#14171A] p-4">
                    <p className="font-display text-sm text-[#D6FF3F]">BEHOUDEN INSTELLINGEN</p>
                    <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
                      Boekingsdeadline: {baseVersion.booking_deadline_hours} uur vóór de les.
                      {" "}Niveau: {baseVersion.level || "Niet ingesteld"}.
                      {" "}Deze velden worden niet ongemerkt gewijzigd.
                    </p>
                  </div>

                  <div className="border-l-2 border-[#D6FF3F] pl-4">
                    <p className="font-display text-xl">
                      ELKE {weekdayLabel(weekday).toUpperCase()} · {startTime}–{endTime}
                    </p>
                    <p className="mt-2 text-sm text-[#B9BEC2]">
                      Vanaf {effectiveFrom ? formatDate(effectiveFrom) : "een gekozen datum"}
                      {" · "}{possibleSlots} momenten per week
                      {" · "}{duration} min per les
                    </p>
                    <p className="mt-2 font-display text-2xl text-[#D6FF3F]">
                      {priceCents !== null ? formatMoney(priceCents, currency) : "PRIJS INVULLEN"}
                      <span className="ml-2 text-sm text-[#B9BEC2]">PER LES</span>
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      formDisabled ||
                      venuesLoading ||
                      Boolean(venueError) ||
                      possibleSlots === 0
                    }
                    className={`${buttonClass} w-full bg-[#FF4B3E] py-4 text-lg text-white hover:bg-[#D6FF3F] hover:text-[#14171A]`}
                  >
                    {result ? "WIJZIGING OPGESLAGEN" : "CONTROLEER WIJZIGING →"}
                  </button>
                </fieldset>
              </form>
            </>
          ) : null}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}