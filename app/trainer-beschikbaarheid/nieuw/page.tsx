"use client";

import type { FormEvent } from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import {
  addCalendarDays,
  getAmsterdamDateInputs,
} from "@/lib/amsterdam-date-time";
import { supabase } from "@/lib/supabase-browser";

/* TYPES */

type Sport = "padel" | "tennis";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: string;
  city: string | null;
};

type AccountContext = {
  userId: string;
  trainer: TrainerAccount;
};

type Venue = {
  id: string;
  name: string;
  address_line: string | null;
  postal_code: string | null;
  city: string;
  sports: Sport[];
};

type CreateResult = {
  id: string;
  created: number;
  skipped: number;
  summary: string;
};

/* CONSTANTEN */

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

/* HELPERS */

function todayAmsterdam() {
  return getAmsterdamDateInputs(new Date()).date;
}

function weekdayLabel(value: number) {
  return WEEKDAYS.find((day) => day.value === value)?.label ?? "Onbekend";
}

function formatDate(value: string) {
  if (!value || addCalendarDays(value, 0) !== value) {
    return "Kies een datum";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
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

function minutesFromTime(hour: string, minute: string) {
  return Number(hour) * 60 + Number(minute);
}

function formatMinutes(value: number) {
  return (
    `${String(Math.floor(value / 60)).padStart(2, "0")}:` +
    String(value % 60).padStart(2, "0")
  );
}

function firstMatchingDate(
  effectiveFrom: string,
  weekday: number,
): string | null {
  if (
    addCalendarDays(effectiveFrom, 0) !== effectiveFrom ||
    !WEEKDAYS.some((day) => day.value === weekday)
  ) {
    return null;
  }

  // UTC uitsluitend voor kalenderrekenen, niet voor lestijden.
  const date = new Date(`${effectiveFrom}T12:00:00Z`);
  const currentWeekday = date.getUTCDay() || 7;
  const daysAhead = (weekday - currentWeekday + 7) % 7;

  return addCalendarDays(effectiveFrom, daysAhead);
}

function venueLabel(venue: Venue) {
  return `${venue.city} — ${venue.name}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

async function getCurrentTrainer(): Promise<AccountContext> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error(
      "Je sessie kon niet worden gecontroleerd. Log zo nodig opnieuw in.",
    );
  }

  const { data, error } = await supabase
    .from("trainers")
    .select("id, is_active, approval_status, city")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Geen trainerprofiel gevonden.");

  return {
    userId: user.id,
    trainer: data as TrainerAccount,
  };
}

/* PAGINA */

export default function NieuwVastMomentPage() {
  const router = useRouter();

  const [account, setAccount] = useState<AccountContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);

  const [today, setToday] = useState("");
  const [startDate, setStartDate] = useState("");
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
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venueError, setVenueError] = useState("");
  const [venueRetry, setVenueRetry] = useState(0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);

  const mounted = useRef(true);
  const saveLock = useRef(false);
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const venueContainerRef = useRef<HTMLDivElement | null>(null);

  const trainerActive =
    account?.trainer.is_active === true &&
    account.trainer.approval_status === "approved";

  const frozen = saving || uncertain || result !== null;
  const formDisabled = frozen || !trainerActive;

  const startTime = `${startHour}:${startMinute}`;
  const endTime = `${endHour}:${endMinute}`;
  const startMinutes = minutesFromTime(startHour, startMinute);
  const endMinutes = minutesFromTime(endHour, endMinute);
  const blockMinutes = Math.max(0, endMinutes - startMinutes);
  const slotsPerBlock = Math.floor(blockMinutes / duration);
  const remainderMinutes = blockMinutes - slotsPerBlock * duration;
  const priceCents = parsePrice(price);

  const firstDate = firstMatchingDate(startDate, weekday);
  const horizonEnd = today ? addCalendarDays(today, 55) : null;
  const beyondHorizon = Boolean(
    firstDate && horizonEnd && firstDate > horizonEnd,
  );

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === venueId) ?? null,
    [venues, venueId],
  );

  const filteredVenues = useMemo(() => {
    const query = venueSearch.trim().toLocaleLowerCase("nl-NL");
    const trainerCity =
      account?.trainer.city?.trim().toLocaleLowerCase("nl-NL") ?? "";

    function inCity(venue: Venue) {
      return Boolean(trainerCity) &&
        venue.city.trim().toLocaleLowerCase("nl-NL") === trainerCity;
    }

    return venues
      .filter((venue) =>
        [
          venue.name,
          venue.city,
          venue.address_line,
          venue.postal_code,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("nl-NL")
          .includes(query),
      )
      .sort(
        (a, b) =>
          Number(inCity(b)) - Number(inCity(a)) ||
          a.city.localeCompare(b.city, "nl") ||
          a.name.localeCompare(b.name, "nl"),
      );
  }, [venues, venueSearch, account?.trainer.city]);

  const blockPreview = useMemo(
    () =>
      Array.from({ length: slotsPerBlock }, (_, index) => ({
        start: formatMinutes(startMinutes + index * duration),
        end: formatMinutes(startMinutes + (index + 1) * duration),
      })),
    [slotsPerBlock, startMinutes, duration],
  );

  useEffect(() => {
    mounted.current = true;

    const current = todayAmsterdam();
    setToday(current);
    setStartDate(current);

    const timer = window.setInterval(() => {
      setToday(todayAmsterdam());
    }, 60_000);

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

      try {
        const current = await getCurrentTrainer();

        if (active) setAccount(current);
      } catch (error) {
        console.error("Trainerprofiel laden mislukt:", error);

        if (active) {
          setAccount(null);
          setLoadError(
            "Je trainerprofiel kon niet worden geladen. Controleer je verbinding en of je met het juiste traineraccount bent ingelogd.",
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
  }, [profileRetry]);

  useEffect(() => {
    let active = true;

    async function load() {
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

    void load();

    return () => {
      active = false;
    };
  }, [sport, venueRetry]);

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
    if (!error && !result) return;

    feedbackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    feedbackRef.current?.focus();
  }, [error, result]);

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

  function clearError() {
    setError("");
  }

  function changeSport(value: Sport) {
    if (frozen || sport === value) return;

    clearError();
    setVenueId("");
    setVenueSearch("");
    setVenueOpen(false);
    setVenues([]);
    setVenuesLoading(true);
    setSport(value);
  }

  function resetForm() {
    if (saveLock.current || uncertain) return;

    setResult(null);
    setError("");
    setStartDate(todayAmsterdam());
    setWeekday(1);
    setStartHour("18");
    setStartMinute("00");
    setEndHour("21");
    setEndMinute("00");
    setDuration(60);
    setParticipants(1);
    setPrice("");
    setVenueId("");
    setVenueSearch("");
    setVenueOpen(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saveLock.current || result || uncertain) return;

    clearError();

    if (!account || !trainerActive) {
      setError("Je trainerprofiel moet actief en goedgekeurd zijn.");
      return;
    }

    const currentDate = todayAmsterdam();

    if (
      !startDate ||
      addCalendarDays(startDate, 0) !== startDate ||
      startDate < currentDate
    ) {
      setError("Kies een geldige ingangsdatum vanaf vandaag in Nederlandse tijd.");
      return;
    }

    if (
      !WEEKDAYS.some((day) => day.value === weekday) ||
      !HOURS.includes(startHour) ||
      !HOURS.includes(endHour) ||
      !MINUTES.includes(startMinute) ||
      !MINUTES.includes(endMinute) ||
      !DURATIONS.includes(duration) ||
      !PARTICIPANTS.includes(participants) ||
      !["padel", "tennis"].includes(sport)
    ) {
      setError("Controleer weekdag, tijden, sport, lesduur en groepsgrootte.");
      return;
    }

    if (endMinutes <= startMinutes || slotsPerBlock < 1) {
      setError("De eindtijd moet na de starttijd liggen en er moet minstens één volledige les in het tijdsblok passen.");
      return;
    }

    if (
      venuesLoading ||
      venueError ||
      !selectedVenue ||
      !selectedVenue.sports.includes(sport)
    ) {
      setError("Kies een actieve trainingslocatie voor de geselecteerde sport.");
      return;
    }

    if (priceCents === null) {
      setError("Vul een positieve prijs per les in met maximaal twee decimalen.");
      return;
    }

    // Snapshot: het formulier staat tijdens de aanvraag vast.
    const payload = {
      p_trainer_id: account.trainer.id,
      p_weekday: weekday,
      p_starts_at_time: `${startTime}:00`,
      p_ends_at_time: `${endTime}:00`,
      p_duration_minutes: duration,
      p_sport: sport,
      p_location_id: selectedVenue.id,
      p_max_participants: participants,
      p_price_cents: priceCents,
      p_weeks_ahead: 8,
      p_start_date: startDate,
    };

    const summary =
      `${sport.toUpperCase()} · elke ${weekdayLabel(weekday).toLowerCase()} ` +
      `${startTime}–${endTime} · ${venueLabel(selectedVenue)} · ` +
      `${formatMoney(priceCents)} per les · vanaf ${formatDate(startDate)}.`;

    saveLock.current = true;
    setSaving(true);

    let requestStarted = false;

    try {
      const current = await getCurrentTrainer();

      if (!mounted.current) return;

      if (
        current.userId !== account.userId ||
        current.trainer.id !== account.trainer.id
      ) {
        throw new Error(
          "Je ingelogde account is gewijzigd. Open deze pagina opnieuw.",
        );
      }

      if (
        !current.trainer.is_active ||
        current.trainer.approval_status !== "approved"
      ) {
        setAccount(current);
        throw new Error("Je trainerprofiel is niet meer actief en goedgekeurd.");
      }

      requestStarted = true;

      // De overload met expliciete ingangsdatum gebruiken.
      // De database maakt reeks, eerste versie en slots samen aan.
      const { data, error: rpcError } = await supabase.rpc(
        "create_recurring_availability_and_slots",
        payload,
      );

      if (rpcError) throw rpcError;
      if (!mounted.current) return;

      const response: unknown = Array.isArray(data)
        ? data.length === 1 ? data[0] : null
        : data;

      if (
        !isObject(response) ||
        typeof response.recurring_availability_id !== "string" ||
        !UUID_PATTERN.test(response.recurring_availability_id) ||
        !isCount(response.created_slots) ||
        !isCount(response.skipped_slots)
      ) {
        throw new Error("De server gaf geen geldig aanmaakresultaat terug.");
      }

      setVenueOpen(false);
      setResult({
        id: response.recurring_availability_id,
        created: response.created_slots,
        skipped: response.skipped_slots,
        summary,
      });
    } catch (error) {
      console.error("Vaste reeks aanmaken mislukt:", error);

      if (!mounted.current) return;

      const message = error instanceof Error
        ? error.message
        : isObject(error) && typeof error.message === "string"
          ? error.message
          : "De aanvraag kon niet worden afgerond.";

      const code =
        isObject(error) && typeof error.code === "string"
          ? error.code
          : "";

      // Expliciete PostgreSQL-afwijzingen betekenen dat deze
      // RPC-transactie niet succesvol is gecommit.
      const databaseRejected =
        code === "P0001" ||
        code === "42501" ||
        code.startsWith("22") ||
        code.startsWith("23");

      if (requestStarted && !databaseRejected) {
        setUncertain(true);
        setError(
          `${message} De reeks kan al zijn aangemaakt. Controleer eerst Vaste momenten; verstuur deze aanvraag niet opnieuw.`,
        );
      } else {
        setError(
          databaseRejected
            ? `${message} Deze aanvraag heeft geen nieuwe reeks opgeslagen.`
            : message,
        );
      }
    } finally {
      saveLock.current = false;

      if (mounted.current) setSaving(false);
    }
  }

  const buttonClass =
    "inline-flex min-h-11 items-center justify-center px-4 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-50";

  const inputClass =
    "min-h-12 w-full border-2 border-white/25 bg-[#14171A] px-3 py-3 text-white outline-none focus:border-[#D6FF3F] disabled:opacity-60";

  function option(
    label: string,
    selected: boolean,
    onClick: () => void,
  ) {
    return (
      <button
        key={label}
        type="button"
        aria-pressed={selected}
        onClick={() => {
          clearError();
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
                NIEUW VAST MOMENT.
              </h1>

              <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#B9BEC2]">
                Maak een wekelijkse reeks. Vanaf de gekozen ingangsdatum
                vullen we losse lesmomenten aan binnen een voortschrijdende
                horizon van acht weken.
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
              PROFIEL LADEN...
            </p>
          ) : loadError ? (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-5">
              <p className="text-sm leading-relaxed">{loadError}</p>
              <button
                type="button"
                onClick={() => setProfileRetry((value) => value + 1)}
                className={`${buttonClass} mt-4 bg-white text-[#14171A]`}
              >
                OPNIEUW LADEN
              </button>
            </div>
          ) : account ? (
            <>
              <div
                ref={feedbackRef}
                tabIndex={-1}
                className="mt-6 space-y-4 outline-none"
              >
                {error && (
                  <div
                    role="alert"
                    className="border-2 border-[#FF4B3E] p-5 text-sm leading-relaxed"
                  >
                    {error}
                  </div>
                )}

                {uncertain && (
                  <div className="border border-white/25 bg-[#1E2327] p-5">
                    <h2 className="font-display text-xl text-[#D6FF3F]">
                      EERST HET RESULTAAT CONTROLEREN
                    </h2>

                    <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                      Opnieuw opslaan is op dit scherm geblokkeerd.
                      Bekijk eerst of de reeks in het overzicht staat.
                      Een reeks kan bestaan terwijl er door overlap
                      nog geen nieuwe slots zijn aangemaakt.
                    </p>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => router.push("/trainer-beschikbaarheid")}
                      className={`${buttonClass} mt-4 bg-[#D6FF3F] text-[#14171A]`}
                    >
                      CONTROLEER VASTE MOMENTEN →
                    </button>

                    <p className="mt-3 text-xs leading-relaxed text-[#B9BEC2]">
                      Verschijnt de reeks niet direct? Ververs het overzicht
                      en controleer opnieuw. Maak niet blind een tweede reeks.
                    </p>
                  </div>
                )}

                {result && (
                  <div
                    role="status"
                    className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A]"
                  >
                    <h2 className="font-display text-2xl">
                      VASTE REEKS OPGESLAGEN
                    </h2>

                    <p className="mt-3 text-sm font-semibold leading-relaxed">
                      {result.summary}
                    </p>

                    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                      <li>{result.created} nieuwe slots aangemaakt.</li>
                      <li>{result.skipped} kandidaten overgeslagen.</li>
                    </ul>

                    <p className="mt-3 text-xs leading-relaxed">
                      Nul nieuwe slots kan correct zijn, bijvoorbeeld als de
                      ingangsdatum buiten de huidige horizon ligt of bestaande
                      momenten de beschikbare tijden al bezetten.
                    </p>

                    <p className="mt-3 break-all text-xs">
                      Reeks-ID: {result.id}
                    </p>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => router.push("/trainer-beschikbaarheid")}
                        className={`${buttonClass} bg-[#14171A] text-white`}
                      >
                        BEKIJK VASTE MOMENTEN →
                      </button>

                      <button
                        type="button"
                        onClick={resetForm}
                        className={`${buttonClass} border-2 border-[#14171A] text-[#14171A]`}
                      >
                        NOG EEN REEKS TOEVOEGEN
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!trainerActive && (
                <div className="mt-6 border border-[#FF4B3E] p-4 text-sm leading-relaxed">
                  Je trainerprofiel moet actief en goedgekeurd zijn om een
                  nieuwe reeks aan te maken.
                </div>
              )}

              <form onSubmit={handleSave} className="mt-6">
                <fieldset
                  disabled={formDisabled}
                  className="min-w-0 space-y-6 border-2 border-white/30 bg-[#1E2327] p-5 sm:p-6"
                >
                  <h2 className="font-display text-xl text-[#D6FF3F]">
                    JOUW WEKELIJKSE BESCHIKBAARHEID
                  </h2>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">
                      SPORT
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["padel", "tennis"] as Sport[]).map((value) =>
                        option(
                          value.toUpperCase(),
                          sport === value,
                          () => changeSport(value),
                        ),
                      )}
                    </div>
                  </fieldset>

                  <div>
                    <label
                      htmlFor="start-date"
                      className="font-display text-sm text-[#D6FF3F]"
                    >
                      INGANGSDATUM
                    </label>

                    <input
                      id="start-date"
                      type="date"
                      required
                      min={today || undefined}
                      max="2100-12-31"
                      value={startDate}
                      onChange={(event) => {
                        clearError();
                        setStartDate(event.target.value);
                      }}
                      className={`${inputClass} mt-2 [color-scheme:dark]`}
                    />

                    <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
                      Er worden geen lessen vóór deze datum gemaakt.
                      De gekozen weekdag bepaalt op welke datums het
                      tijdsblok terugkomt.
                    </p>
                  </div>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">
                      ELKE
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) =>
                        option(
                          day.short,
                          weekday === day.value,
                          () => setWeekday(day.value),
                        ),
                      )}
                    </div>
                  </fieldset>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="start-hour"
                        className="font-display text-sm text-[#D6FF3F]"
                      >
                        VAN
                      </label>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          id="start-hour"
                          value={startHour}
                          onChange={(event) => {
                            clearError();
                            setStartHour(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {HOURS.map((value) => (
                            <option key={value} value={value}>
                              {value} uur
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Startminuten"
                          value={startMinute}
                          onChange={(event) => {
                            clearError();
                            setStartMinute(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {MINUTES.map((value) => (
                            <option key={value} value={value}>
                              :{value}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="end-hour"
                        className="font-display text-sm text-[#D6FF3F]"
                      >
                        TOT
                      </label>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          id="end-hour"
                          value={endHour}
                          onChange={(event) => {
                            clearError();
                            setEndHour(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {HOURS.map((value) => (
                            <option key={value} value={value}>
                              {value} uur
                            </option>
                          ))}
                        </select>

                        <select
                          aria-label="Eindminuten"
                          value={endMinute}
                          onChange={(event) => {
                            clearError();
                            setEndMinute(event.target.value);
                          }}
                          className={inputClass}
                        >
                          {MINUTES.map((value) => (
                            <option key={value} value={value}>
                              :{value}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-[#B9BEC2]">
                    {startTime}–{endTime}, in Europe/Amsterdam.
                    Het lokale tijdstip blijft gelijk bij zomer- en wintertijd.
                    Feestdagen en vakanties worden niet automatisch overgeslagen.
                  </p>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">
                      DUUR PER LES
                    </legend>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {DURATIONS.map((value) =>
                        option(
                          `${value} min`,
                          duration === value,
                          () => setDuration(value),
                        ),
                      )}
                    </div>

                    <p className="mt-2 text-xs text-[#B9BEC2]">
                      {slotsPerBlock} volledige lessen per tijdsblok.
                      {remainderMinutes > 0
                        ? ` ${remainderMinutes} resterende minuten worden niet aangeboden.`
                        : ""}
                    </p>
                  </fieldset>

                  <div ref={venueContainerRef}>
                    <label
                      htmlFor="venue-search"
                      className="font-display text-sm text-[#D6FF3F]"
                    >
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
                      disabled={formDisabled || venuesLoading}
                      aria-expanded={venueOpen}
                      aria-controls="venue-results"
                      onFocus={() => {
                        setVenueSearch("");
                        setVenueOpen(true);
                      }}
                      onChange={(event) => {
                        clearError();
                        setVenueSearch(event.target.value);
                        setVenueOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setVenueOpen(false);
                        }
                      }}
                      placeholder={
                        venuesLoading
                          ? "Locaties laden..."
                          : "Zoek stad, club of adres"
                      }
                      className={`${inputClass} mt-2`}
                    />

                    {venueOpen && !venuesLoading && !venueError && (
                      <div
                        id="venue-results"
                        className="mt-2 max-h-64 overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A]"
                      >
                        {filteredVenues.length ? (
                          filteredVenues.map((venue) => (
                            <button
                              key={venue.id}
                              type="button"
                              onClick={() => {
                                clearError();
                                setVenueId(venue.id);
                                setVenueSearch("");
                                setVenueOpen(false);
                              }}
                              className="block w-full border-b border-white/15 px-4 py-3 text-left transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                            >
                              <span className="block font-semibold">
                                {venueLabel(venue)}
                              </span>

                              <span className="mt-1 block text-xs opacity-75">
                                {[venue.address_line, venue.postal_code]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="p-4 text-sm text-[#B9BEC2]">
                            Geen geschikte locaties gevonden.
                          </p>
                        )}
                      </div>
                    )}

                    {venueError && (
                      <div className="mt-2">
                        <p role="alert" className="text-sm text-[#FF8A80]">
                          {venueError}
                        </p>

                        <button
                          type="button"
                          onClick={() => setVenueRetry((value) => value + 1)}
                          className={`${buttonClass} mt-2 border border-white/30`}
                        >
                          LOCATIES OPNIEUW LADEN
                        </button>
                      </div>
                    )}

                    {selectedVenue && (
                      <p className="mt-2 text-xs text-[#D6FF3F]">
                        Geselecteerd: {venueLabel(selectedVenue)}
                      </p>
                    )}
                  </div>

                  <fieldset>
                    <legend className="font-display text-sm text-[#D6FF3F]">
                      MAXIMAAL AANTAL SPELERS PER LES
                    </legend>

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
                    <label
                      htmlFor="price"
                      className="font-display text-sm text-[#D6FF3F]"
                    >
                      PRIJS PER LES INCLUSIEF BAANHUUR
                    </label>

                    <div className="mt-2 flex items-center border-2 border-white/25 bg-[#14171A] focus-within:border-[#D6FF3F]">
                      <span className="px-4 font-display text-xl text-[#D6FF3F]">
                        €
                      </span>

                      <input
                        id="price"
                        type="text"
                        inputMode="decimal"
                        required
                        value={price}
                        onChange={(event) => {
                          clearError();
                          setPrice(event.target.value);
                        }}
                        placeholder="Bijv. 90,00"
                        className="min-h-12 min-w-0 flex-1 bg-transparent px-3 py-3 text-white outline-none"
                      />
                    </div>

                    <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
                      Dit bedrag geldt voor iedere losse les, niet voor het
                      volledige tijdsblok en niet per speler.
                    </p>
                  </div>

                  <div className="border border-white/20 bg-[#14171A] p-4 sm:p-5">
                    <h2 className="font-display text-sm text-[#D6FF3F]">
                      CONTROLEER JE REEKS
                    </h2>

                    <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="font-display text-2xl">
                          ELKE {weekdayLabel(weekday).toUpperCase()}
                        </p>
                        <p className="mt-1 text-sm text-[#B9BEC2]">
                          {sport.toUpperCase()} · {startTime}–{endTime}
                        </p>
                      </div>

                      <div>
                        <p className="font-display text-3xl text-[#D6FF3F]">
                          {priceCents !== null
                            ? formatMoney(priceCents)
                            : "PRIJS INVULLEN"}
                        </p>
                        <p className="text-xs text-[#B9BEC2]">
                          Per les inclusief baanhuur
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2 border-t border-white/15 pt-4 text-xs leading-relaxed text-[#B9BEC2]">
                      <p>
                        Ingangsdatum: {formatDate(startDate)}.
                      </p>

                      {firstDate && (
                        <p>
                          Eerste passende kalenderdag: {formatDate(firstDate)}.
                          Verstreken lestijden worden overgeslagen.
                        </p>
                      )}

                      <p>
                        Locatie:{" "}
                        {selectedVenue
                          ? venueLabel(selectedVenue)
                          : "Kies een locatie"}.
                      </p>

                      <p>
                        Maximaal {participants} spelers per les.
                        Boekingsdeadline bij aanmaken: 24 uur vóór de les.
                      </p>

                      {horizonEnd && (
                        <p>
                          Huidige aanvulhorizon: vandaag t/m{" "}
                          {formatDate(horizonEnd)}.
                        </p>
                      )}

                      {beyondHorizon && (
                        <p className="font-semibold text-[#D6FF3F]">
                          De eerste passende dag ligt buiten deze horizon.
                          De reeks wordt wel opgeslagen; slots worden pas
                          bij een latere aanvulling aangemaakt.
                        </p>
                      )}
                    </div>

                    {blockPreview.length > 0 && (
                      <details className="mt-4 border-t border-white/15 pt-3">
                        <summary className="cursor-pointer py-2 font-display text-sm text-[#D6FF3F]">
                          VOORGESTELDE MOMENTEN PER WEEK ({slotsPerBlock})
                        </summary>

                        <ul className="mt-2 space-y-2 text-sm">
                          {blockPreview.map((slot) => (
                            <li
                              key={slot.start}
                              className="flex flex-wrap justify-between gap-2 border-b border-white/10 py-2"
                            >
                              <span>{slot.start}–{slot.end}</span>
                              <span className="text-[#B9BEC2]">
                                {priceCents !== null
                                  ? formatMoney(priceCents)
                                  : "Prijs invullen"}
                              </span>
                            </li>
                          ))}
                        </ul>

                        <p className="mt-3 text-xs leading-relaxed text-[#B9BEC2]">
                          Dit is een voorstel. De database bepaalt welke
                          momenten daadwerkelijk kunnen worden aangemaakt.
                          Bestaande overlap wordt overgeslagen.
                        </p>
                      </details>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={
                      formDisabled ||
                      venuesLoading ||
                      Boolean(venueError) ||
                      slotsPerBlock < 1
                    }
                    className={`${buttonClass} w-full bg-[#FF4B3E] py-4 text-lg text-white hover:bg-[#D6FF3F] hover:text-[#14171A]`}
                  >
                    {saving
                      ? "REEKS OPSLAAN..."
                      : result
                        ? "REEKS IS OPGESLAGEN"
                        : "VASTE REEKS AANMAKEN →"}
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