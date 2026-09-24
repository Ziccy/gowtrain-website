"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type Sport = "padel" | "tennis";
type Filter = "all" | "active" | "paused";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: string;
};

type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address_line: string | null;
  postal_code: string | null;
};

type Settings = {
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
  venue: VenueSummary | null;
};

type PatternVersion = Settings & {
  recurring_availability_id: string;
  effective_from: string;
};

type Pattern = Settings & {
  id: string;
  trainer_id: string;
  is_active: boolean;
  updated_at: string;
  versions: PatternVersion[];
};

type Relation<T> = T | T[] | null;

type RawPattern = Omit<Pattern, "venue" | "versions"> & {
  venue: Relation<VenueSummary>;
};

type RawVersion = Omit<PatternVersion, "venue"> & {
  venue: Relation<VenueSummary>;
};

type PendingAction = {
  type: "state" | "delete";
  pattern: Pattern;
  targetActive: boolean;
};

const SETTINGS_SELECT = `
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
  booking_deadline_hours
`;

const FILTERS: readonly [string, Filter][] = [
  ["Alles", "all"],
  ["Actief", "active"],
  ["Gepauzeerd", "paused"],
];

function first<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${read("year")}-${read("month")}-${read("day")}`;
}

function weekdayLabel(value: number): string {
  return [
    "",
    "MAANDAG",
    "DINSDAG",
    "WOENSDAG",
    "DONDERDAG",
    "VRIJDAG",
    "ZATERDAG",
    "ZONDAG",
  ][value] || "ONBEKEND";
}

function formatTime(value: string): string {
  return value.slice(0, 5);
}

function formatDate(value: string): string {
  if (value === "-infinity") return "Uitgangssituatie";

  const date = new Date(`${value}T12:00:00Z`);

  if (!Number.isFinite(date.getTime())) return "Datum onbekend";

  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function venueLabel(venue: VenueSummary | null): string {
  return venue
    ? `${venue.city} — ${venue.name}`
    : "Locatie onbekend";
}

function currentVersion(
  pattern: Pattern,
  today: string,
): PatternVersion | null {
  const applicable = pattern.versions
    .filter(
      (version) =>
        version.effective_from === "-infinity" ||
        version.effective_from <= today,
    )
    .sort((a, b) => {
      if (a.effective_from === "-infinity") return -1;
      if (b.effective_from === "-infinity") return 1;
      return a.effective_from.localeCompare(b.effective_from);
    });

  return applicable[applicable.length - 1] ?? null;
}

function futureVersions(
  pattern: Pattern,
  today: string,
): PatternVersion[] {
  return pattern.versions
    .filter(
      (version) =>
        version.effective_from !== "-infinity" &&
        version.effective_from > today,
    )
    .sort((a, b) =>
      a.effective_from.localeCompare(b.effective_from),
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

async function getCurrentTrainer() {
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
    .select("id, is_active, approval_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Geen trainerprofiel gevonden.");

  return {
    userId: user.id,
    trainer: data as TrainerAccount,
  };
}

export default function TrainerBeschikbaarheidPage() {
  const router = useRouter();

  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [trainer, setTrainer] = useState<TrainerAccount | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [needsCheck, setNeedsCheck] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<PendingAction | null>(null);
  const [today, setToday] = useState(getToday);

  const mounted = useRef(true);
  const sequence = useRef(0);
  const mutationLock = useRef(false);
  const ownerUserId = useRef<string | null>(null);
  const confirmationRef = useRef<HTMLElement | null>(null);

  const busy = updatingId !== null;
  const controlsDisabled = busy || refreshing || loading;

  const trainerActive =
    trainer?.is_active === true &&
    trainer.approval_status === "approved";

  const loadPatterns = useCallback(
    async (initial = false, manualCheck = false): Promise<boolean> => {
      const current = ++sequence.current;
      const isCurrent = () =>
        mounted.current && sequence.current === current;

      if (initial) setLoading(true);
      else setRefreshing(true);

      setLoadError("");

      try {
        const account = await getCurrentTrainer();
        if (!isCurrent()) return false;

        const all: Pattern[] = [];
        const pageSize = 100;

        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .from("recurring_availability")
            .select(`
              id,
              trainer_id,
              is_active,
              updated_at,
              ${SETTINGS_SELECT},
              venue:venues!recurring_availability_location_id_fkey (
                id, name, city, address_line, postal_code
              )
            `)
            .eq("trainer_id", account.trainer.id)
            .order("weekday", { ascending: true })
            .order("starts_at_time", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);

          if (error) throw error;
          if (!isCurrent()) return false;

          const page = (data ?? []) as unknown as RawPattern[];

          all.push(
            ...page.map((pattern) => ({
              ...pattern,
              venue: first(pattern.venue),
              versions: [] as PatternVersion[],
            })),
          );

          if (page.length < pageSize) break;
        }

        const versionsByPattern = new Map<string, PatternVersion[]>();

        // Versies in batches ophalen, met paginering.
        for (let start = 0; start < all.length; start += 100) {
          const ids = all.slice(start, start + 100).map((item) => item.id);

          for (let from = 0; ; from += 200) {
            const { data, error } = await supabase
              .from("recurring_availability_versions")
              .select(`
                recurring_availability_id,
                effective_from,
                ${SETTINGS_SELECT},
                venue:venues (
                  id, name, city, address_line, postal_code
                )
              `)
              .in("recurring_availability_id", ids)
              .order("recurring_availability_id", { ascending: true })
              .order("effective_from", { ascending: true })
              .range(from, from + 199);

            if (error) throw error;
            if (!isCurrent()) return false;

            const page = (data ?? []) as unknown as RawVersion[];

            for (const version of page) {
              const list =
                versionsByPattern.get(version.recurring_availability_id) ?? [];

              list.push({
                ...version,
                venue: first(version.venue),
              });

              versionsByPattern.set(
                version.recurring_availability_id,
                list,
              );
            }

            if (page.length < 200) break;
          }
        }

        if (!isCurrent()) return false;

        ownerUserId.current = account.userId;
        setTrainer(account.trainer);
        setPatterns(
          all.map((pattern) => ({
            ...pattern,
            versions: versionsByPattern.get(pattern.id) ?? [],
          })),
        );
        setToday(getToday());

        if (manualCheck) {
          setNeedsCheck(false);
          setActionError("");
          setSuccess(
            "De actuele reeksen zijn opnieuw geladen. Controleer de status voordat je een nieuwe actie kiest.",
          );
        }

        return true;
      } catch (error) {
        console.error("Vaste momenten laden mislukt:", error);

        if (isCurrent()) {
          ownerUserId.current = null;
          setTrainer(null);
          setPatterns([]);
          setLoadError(
            "Je reeksen konden niet worden geladen. Controleer je verbinding en je trainerlogin.",
          );
        }

        return false;
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    void loadPatterns(true);

    const timer = window.setInterval(() => {
      setToday(getToday());
    }, 60_000);

    return () => {
      mounted.current = false;
      sequence.current += 1;
      window.clearInterval(timer);
    };
  }, [loadPatterns]);

  useEffect(() => {
    if (!pendingAction) return;

    confirmationRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    confirmationRef.current?.focus();
  }, [pendingAction]);

  useEffect(() => {
    if (!busy) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy]);

  const filteredPatterns = useMemo(
    () =>
      patterns.filter((pattern) => {
        if (filter === "active") return pattern.is_active;
        if (filter === "paused") return !pattern.is_active;
        return true;
      }),
    [patterns, filter],
  );

  const activeCount = patterns.filter((pattern) => pattern.is_active).length;
  const pausedCount = patterns.length - activeCount;

  function refresh() {
    if (mutationLock.current || refreshing || loading) return;

    setPendingAction(null);
    setActionError("");
    setSuccess("");
    void loadPatterns(false, true);
  }

  function openAction(pattern: Pattern, type: "state" | "delete") {
    if (controlsDisabled || needsCheck) return;

    if (
      type === "state" &&
      !pattern.is_active &&
      !trainerActive
    ) {
      return;
    }

    setActionError("");
    setSuccess("");
    setPendingAction({
      type,
      pattern,
      targetActive: !pattern.is_active,
    });
  }

  async function confirmAction() {
    if (
      !pendingAction ||
      mutationLock.current ||
      refreshing ||
      needsCheck
    ) {
      return;
    }

    const action = pendingAction;
    const expectedUserId = ownerUserId.current;

    mutationLock.current = true;
    setUpdatingId(action.pattern.id);
    setActionError("");
    setSuccess("");

    let requestStarted = false;

    try {
      const account = await getCurrentTrainer();

      if (!mounted.current) return;

      if (
        account.userId !== expectedUserId ||
        account.trainer.id !== action.pattern.trainer_id
      ) {
        throw new Error(
          "Je ingelogde account is gewijzigd. Ververs de pagina.",
        );
      }

      const { data: fresh, error: freshError } = await supabase
        .from("recurring_availability")
        .select("id, is_active, updated_at")
        .eq("id", action.pattern.id)
        .eq("trainer_id", account.trainer.id)
        .maybeSingle();

      if (freshError) throw freshError;

      if (
        !fresh ||
        fresh.is_active !== action.pattern.is_active ||
        fresh.updated_at !== action.pattern.updated_at
      ) {
        throw new Error(
          "De reeks is ondertussen gewijzigd of verwijderd. Ververs en controleer de gegevens opnieuw.",
        );
      }

      if (!mounted.current) return;

      requestStarted = true;
      let message: string;

      if (action.type === "delete") {
        const { data, error } = await supabase.rpc(
          "delete_own_recurring_availability",
          {
            p_recurring_availability_id: action.pattern.id,
          },
        );

        if (error) throw error;

        if (data !== action.pattern.id) {
          throw new Error(
            "De verwijdering is niet bevestigd. Controleer eerst het overzicht.",
          );
        }

        message =
          "De reeks is verwijderd. Bestaande slots en boekingen blijven behouden; hun koppeling naar deze reeks is verwijderd.";
      } else {
        const { data, error } = await supabase.rpc(
          "set_own_recurring_availability_active",
          {
            p_recurring_availability_id: action.pattern.id,
            p_is_active: action.targetActive,
          },
        );

        if (error) throw error;

        const result: unknown = Array.isArray(data)
          ? data.length === 1 ? data[0] : null
          : data;

        if (
          !isObject(result) ||
          result.recurring_availability_id !== action.pattern.id ||
          result.is_active !== action.targetActive ||
          !isCount(result.created_slots) ||
          !isCount(result.skipped_slots)
        ) {
          throw new Error(
            "De serverrespons kon niet worden bevestigd. Controleer eerst het overzicht.",
          );
        }

        message = action.targetActive
          ? `De reeks is actief. Direct aanvullen is uitgevoerd: ${result.created_slots} nieuwe slots aangemaakt en ${result.skipped_slots} kandidaten overgeslagen. De horizon loopt tot acht weken vanaf vandaag.`
          : "De reeks is gepauzeerd. Nieuwe aanvulling stopt. Alle bestaande slots blijven ongewijzigd.";
      }

      if (!mounted.current) return;

      setPendingAction(null);
      setSuccess(message);

      // Alleen opnieuw lezen. De mutatie niet herhalen.
      await loadPatterns(false);
    } catch (error) {
      console.error("Reeksactie niet bevestigd:", error);

      if (mounted.current) {
        setPendingAction(null);
        setNeedsCheck(true);

        const detail =
          error instanceof Error
            ? error.message
            : isObject(error) && typeof error.message === "string"
              ? error.message
              : "De aanvraag kon niet worden afgerond.";

        setActionError(
          `${detail} ${
            requestStarted
              ? "De wijziging kan al zijn verwerkt. Ververs eerst; de aanvraag wordt niet automatisch herhaald."
              : "Er is nog geen beheer-RPC verstuurd. Ververs voordat je opnieuw probeert."
          }`,
        );
      }
    } finally {
      mutationLock.current = false;

      if (mounted.current) setUpdatingId(null);
    }
  }

  function confirmationTitle() {
    if (!pendingAction) return "";

    if (pendingAction.type === "delete") {
      return "VASTE REEKS VERWIJDEREN?";
    }

    return pendingAction.targetActive
      ? "ACTIVEREN EN DIRECT AANVULLEN?"
      : "VASTE REEKS PAUZEREN?";
  }

  function confirmationText() {
    if (!pendingAction) return "";

    if (pendingAction.type === "delete") {
      return (
        "De reeks en haar geplande instellingen worden definitief verwijderd. " +
        "Bestaande beschikbare, gereserveerde en geboekte slots blijven bestaan. " +
        "Alleen hun koppeling naar deze reeks wordt leeggemaakt."
      );
    }

    return pendingAction.targetActive
      ? "De reeks wordt geactiveerd en direct aangevuld binnen de komende acht weken. Geplande ingangsdatums blijven gelden. Bestaande slots worden niet gewijzigd; conflicterende momenten kunnen worden overgeslagen."
      : "De automatische aanvulling stopt. Alle bestaande slots, ook de nog beschikbare momenten, blijven staan.";
  }

  function settingsDetails(settings: Settings) {
    return (
      <div className="space-y-2 text-sm leading-relaxed text-[#B9BEC2]">
        <p>
          {settings.sport.toUpperCase()} · {settings.duration_minutes} min per les
          {" · "}Max. {settings.max_participants} spelers
        </p>

        <p className="font-semibold text-white">
          {venueLabel(settings.venue)}
        </p>

        {settings.venue?.address_line && (
          <p className="text-xs">
            {settings.venue.address_line}
            {settings.venue.postal_code
              ? ` · ${settings.venue.postal_code}`
              : ""}
          </p>
        )}

        <p>
          Prijs per les:{" "}
          <strong className="text-[#D6FF3F]">
            {formatMoney(settings.price_cents, settings.currency)}
          </strong>{" "}
          inclusief baanhuur
        </p>

        {settings.level && (
          <p>Niveau: {settings.level}</p>
        )}

        <p className="text-xs">
          Boekingsdeadline: {settings.booking_deadline_hours} uur vóór de les.
        </p>
      </div>
    );
  }

  const buttonBase =
    "inline-flex min-h-11 items-center justify-center px-4 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-8 sm:py-12">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-5 border-b-2 border-white/20 pb-7 md:flex-row md:items-end">
            <div>
              <p className="font-display text-base text-[#FF4B3E]">
                ROOSTERBEHEER
              </p>

              <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
                VASTE MOMENTEN.
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#B9BEC2]">
                Beheer je wekelijkse beschikbaarheid. Bij activeren vullen
                we direct aan binnen acht weken vanaf vandaag.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={refresh}
                className={`${buttonBase} border-2 border-white text-white hover:border-[#D6FF3F]`}
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>

              <button
                type="button"
                disabled={!trainerActive || controlsDisabled || needsCheck}
                onClick={() => router.push("/trainer-beschikbaarheid/nieuw")}
                className={`${buttonBase} bg-[#D6FF3F] text-[#14171A] hover:bg-white`}
              >
                + VASTE REEKS
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => router.push("/trainer-dashboard")}
                className={`${buttonBase} border border-white/30 text-white hover:border-white`}
              >
                ← DASHBOARD
              </button>
            </div>
          </div>

          {loadError && (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-5">
              <p>{loadError}</p>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={refresh}
                className={`${buttonBase} mt-3 bg-white text-[#14171A]`}
              >
                OPNIEUW LADEN
              </button>
            </div>
          )}

          {actionError && (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-5">
              <p className="text-sm leading-relaxed">{actionError}</p>
            </div>
          )}

          {success && (
            <div
              role="status"
              className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-sm font-semibold leading-relaxed text-[#14171A]"
            >
              {success}
            </div>
          )}

          {!loading && trainer && !trainerActive && (
            <div className="mt-6 border border-white/25 p-4 text-sm text-[#B9BEC2]">
              Je profiel is niet actief en goedgekeurd. Je kunt eigen
              reeksen bekijken, pauzeren of verwijderen. Activeren en
              nieuwe reeksen toevoegen is niet beschikbaar.
            </div>
          )}

          {pendingAction && (
            <section
              ref={confirmationRef}
              tabIndex={-1}
              aria-busy={busy}
              className="mt-6 border-2 border-[#FF4B3E] bg-[#1E2327] p-5 outline-none sm:p-6"
            >
              <h2 className="font-display text-2xl">
                {confirmationTitle()}
              </h2>

              <p className="mt-2 text-xs text-[#B9BEC2]">
                Reeks-ID: {pendingAction.pattern.id}
              </p>

              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#D7D9DA]">
                {confirmationText()}
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingAction(null)}
                  className={`${buttonBase} border-2 border-white text-white`}
                >
                  TOCH NIET
                </button>

                <button
                  type="button"
                  disabled={controlsDisabled || needsCheck}
                  onClick={() => void confirmAction()}
                  className={`${buttonBase} bg-[#FF4B3E] text-white hover:bg-white hover:text-[#14171A]`}
                >
                  {busy
                    ? "BEZIG..."
                    : pendingAction.type === "delete"
                      ? "VERWIJDER REEKS"
                      : pendingAction.targetActive
                        ? "ACTIVEER EN VUL AAN"
                        : "PAUZEER REEKS"}
                </button>
              </div>
            </section>
          )}

          {!loading && !loadError && (
            <div className="mt-6 flex flex-wrap gap-2">
              {FILTERS.map(([label, value]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  disabled={busy}
                  onClick={() => setFilter(value)}
                  className={`${buttonBase} border ${
                    filter === value
                      ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                      : "border-white/30 text-white hover:border-white"
                  }`}
                >
                  {label} (
                  {value === "all"
                    ? patterns.length
                    : value === "active"
                      ? activeCount
                      : pausedCount}
                  )
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="py-12 font-display text-xl text-[#D6FF3F]">
              VASTE MOMENTEN LADEN...
            </p>
          ) : !loadError && filteredPatterns.length === 0 ? (
            <div className="mt-6 border-2 border-white/20 p-6">
              <h2 className="font-display text-2xl text-[#D6FF3F]">
                GEEN REEKSEN BINNEN DIT FILTER.
              </h2>
              <p className="mt-2 text-sm text-[#B9BEC2]">
                Kies een ander filter of voeg een vaste reeks toe.
              </p>
            </div>
          ) : !loadError ? (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {filteredPatterns.map((pattern) => {
                const current = currentVersion(pattern, today);
                const future = futureVersions(pattern, today);
                const displayed = current ?? future[0];
                const missingVersions = !displayed;
                const disabled =
                  controlsDisabled || needsCheck || missingVersions;

                return (
                  <article
                    key={pattern.id}
                    className="flex flex-col border-2 border-white/40 bg-[#1E2327] p-5 shadow-[4px_4px_0_0_#FF4B3E] sm:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-lg text-[#D6FF3F]">
                          {displayed
                            ? `ELKE ${weekdayLabel(displayed.weekday)}`
                            : "PLANNING ONTBREEKT"}
                        </p>

                        {displayed && (
                          <h2 className="mt-1 font-display text-3xl">
                            {formatTime(displayed.starts_at_time)} –{" "}
                            {formatTime(displayed.ends_at_time)}
                          </h2>
                        )}
                      </div>

                      <span
                        className={`px-3 py-1.5 font-display text-xs ${
                          pattern.is_active
                            ? "bg-[#D6FF3F] text-[#14171A]"
                            : "bg-[#303438] text-white"
                        }`}
                      >
                        {pattern.is_active ? "ACTIEF" : "GEPAUZEERD"}
                      </span>
                    </div>

                    {missingVersions ? (
                      <p className="mt-4 text-sm text-[#FF8A80]">
                        De reeksversies ontbreken of zijn niet leesbaar.
                        Beheer is geblokkeerd totdat dit is gecontroleerd.
                      </p>
                    ) : (
                      <>
                        <p className="mt-2 text-xs text-[#B9BEC2]">
                          {current
                            ? current.effective_from === "-infinity"
                              ? "Huidige planning"
                              : `Huidige planning sinds ${formatDate(current.effective_from)}`
                            : `Begint vanaf ${formatDate(displayed.effective_from)}`}
                        </p>

                        <div className="mt-4 border-t border-white/15 pt-4">
                          {settingsDetails(displayed)}
                        </div>
                      </>
                    )}

                    {future.length > 0 && (
                      <div className="mt-5 border-l-2 border-[#D6FF3F] pl-4">
                        <p className="font-display text-sm text-[#D6FF3F]">
                          {current ? "GEPLANDE WIJZIGINGEN" : "GEPLANDE INSTELLINGEN"}
                        </p>

                        {future.map((version) => (
                          <details
                            key={version.effective_from}
                            className="mt-2 border-b border-white/10 pb-2"
                          >
                            <summary className="cursor-pointer py-2 text-sm font-semibold">
                              Vanaf {formatDate(version.effective_from)}
                              {" · "}
                              {weekdayLabel(version.weekday).toLowerCase()}
                              {" "}
                              {formatTime(version.starts_at_time)}–
                              {formatTime(version.ends_at_time)}
                            </summary>

                            <div className="py-2">
                              {settingsDetails(version)}
                            </div>
                          </details>
                        ))}

                        {!pattern.is_active && (
                          <p className="mt-3 text-xs leading-relaxed text-[#B9BEC2]">
                            De reeks blijft gepauzeerd. Nieuwe momenten worden
                            pas bij activeren gegenereerd.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-auto pt-5">
                      <button
                        type="button"
                        disabled={disabled || !trainerActive}
                        onClick={() =>
                          router.push(
                            `/trainer-beschikbaarheid/${pattern.id}/wijzigen`
                          )
                        }
                        className={`${buttonBase} w-full border-2 border-white text-white hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]`}
                      >
                        WIJZIG REEKS →
                      </button>

                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          disabled={
                            disabled ||
                            (!pattern.is_active && !trainerActive)
                          }
                          onClick={() => openAction(pattern, "state")}
                          className={`${buttonBase} bg-[#D6FF3F] text-[#14171A] hover:bg-white`}
                        >
                          {pattern.is_active ? "PAUZEER" : "ACTIVEER"}
                        </button>

                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => openAction(pattern, "delete")}
                          className={`${buttonBase} border border-[#FF4B3E] text-white hover:bg-[#FF4B3E]`}
                        >
                          VERWIJDER
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          <div className="mt-10 border-t border-white/20 pt-5">
            <h2 className="font-display text-base text-[#D6FF3F]">
              HOE WERKT HET?
            </h2>

            <ul className="mt-3 max-w-3xl list-disc space-y-2 pl-5 text-xs leading-relaxed text-[#B9BEC2]">
              <li>
                Pauzeren stopt nieuwe aanvulling. Bestaande slots blijven staan.
              </li>
              <li>
                Activeren vult direct aan binnen acht weken vanaf vandaag.
                Het voegt geen acht weken bovenop het bestaande aanbod toe.
              </li>
              <li>
                Wijzigingen gelden vanaf hun opgeslagen ingangsdatum.
                Gereserveerde en geboekte lessen worden niet automatisch
                verplaatst of opnieuw geprijsd.
              </li>
              <li>
                Verwijderen stopt de reeks en verwijdert haar instellingen.
                Bestaande slots en boekingen blijven behouden.
              </li>
              <li>
                De dagelijkse automatische aanvulling werkt alleen wanneer
                de geplande Supabase-taak actief is.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}