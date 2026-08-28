"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type Sport = "padel" | "tennis";

type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address_line: string;
  postal_code: string | null;
};

type RecurringAvailability = {
  id: string;
  trainer_id: string;
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

  is_active: boolean;
  created_at: string;
  venue: VenueSummary | null;
};

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: "pending" | "approved" | "rejected";
};

type PendingAction =
  | {
      type: "toggle";
      pattern: RecurringAvailability;
    }
  | {
      type: "delete";
      pattern: RecurringAvailability;
    }
  | null;

function getWeekdayLabel(weekday: number): string {
  const labels: Record<number, string> = {
    1: "MAANDAG",
    2: "DINSDAG",
    3: "WOENSDAG",
    4: "DONDERDAG",
    5: "VRIJDAG",
    6: "ZATERDAG",
    7: "ZONDAG",
  };

  return labels[weekday] ?? "ONBEKEND";
}

function formatTime(value: string): string {
  return value.slice(0, 5);
}

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function getVenueLabel(venue: VenueSummary | null): string {
  if (!venue) return "LOCATIE ONBEKEND";
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

function getLevelLabel(level: string | null): string | null {
  if (!level) return null;
  return level.toUpperCase();
}

export default function TrainerBeschikbaarheidPage() {
  const router = useRouter();

  const [patterns, setPatterns] = useState<RecurringAvailability[]>([]);
  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingPatternId, setUpdatingPatternId] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>();

  useEffect(() => {
    void loadPatterns();
  }, []);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function getCurrentTrainer(): Promise<TrainerAccount | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace("/trainer-login");
      return null;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      router.replace("/trainer-login");
      return null;
    }

    const { data: trainer, error: trainerError } = await supabase
      .from("trainers")
      .select("id, is_active, approval_status")
      .eq("user_id", user.id)
      .single();

    if (trainerError || !trainer) {
      console.error("Trainer ophalen fout:", trainerError?.message);
      showError("Je trainerprofiel kon niet worden gevonden.");
      return null;
    }

    return trainer as TrainerAccount;
  }

  async function loadPatterns(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setErrorMessage("");

    try {
      const trainer = await getCurrentTrainer();
      if (!trainer) {
        setPatterns([]);
        return;
      }

      setTrainerAccount(trainer);

      const { data, error } = await supabase
        .from("recurring_availability")
        .select(
          `
            id,
            trainer_id,
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

            is_active,
            created_at,

            venue:venues!recurring_availability_location_id_fkey (
              id,
              name,
              city,
              address_line,
              postal_code
            )
          `
        )
        .eq("trainer_id", trainer.id)
        .order("weekday", { ascending: true })
        .order("starts_at_time", { ascending: true });

      if (error) {
        console.error("Vaste momenten ophalen fout:", error.message);
        showError("Je vaste momenten konden niet worden geladen.");
        setPatterns([]);
        return;
      }

      setPatterns((data ?? []) as unknown as RecurringAvailability[]);
    } catch (error) {
      console.error("Onverwachte beschikbaarheidsfout:", error);
      showError("Je vaste momenten konden niet worden geladen.");
      setPatterns([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadPatterns(false);
    setRefreshing(false);
  }

  function openToggleConfirmation(pattern: RecurringAvailability): void {
    clearMessages();
    setPendingAction({ type: "toggle", pattern });
  }

  function openDeleteConfirmation(pattern: RecurringAvailability): void {
    clearMessages();
    setPendingAction({ type: "delete", pattern });
  }

  function closeConfirmation(): void {
    setPendingAction(null);
  }

  async function togglePattern(pattern: RecurringAvailability): Promise<void> {
    setUpdatingPatternId(pattern.id);
    clearMessages();

    const newActiveState = !pattern.is_active;

    try {
      const { error } = await supabase
        .from("recurring_availability")
        .update({ is_active: newActiveState })
        .eq("id", pattern.id);

      if (error) {
        console.error("Vast moment aanpassen fout:", error.message);
        showError("Dit vaste moment kon niet worden aangepast.");
        return;
      }

      setPendingAction(null);
      setSuccessMessage(
        newActiveState
          ? `Elke ${getWeekdayLabel(pattern.weekday).toLowerCase()} is weer actief! Nieuwe slots worden automatisch aangevuld voor de komende 8 weken.`
          : `Elke ${getWeekdayLabel(pattern.weekday).toLowerCase()} is gepauzeerd. Er worden geen nieuwe slots meer aangemaakt.`
      );

      await loadPatterns(false);
    } catch (error) {
      console.error("Onverwachte toggle-fout:", error);
      showError("Dit vaste moment kon niet worden aangepast.");
    } finally {
      setUpdatingPatternId(null);
    }
  }

  async function deletePattern(pattern: RecurringAvailability): Promise<void> {
    setUpdatingPatternId(pattern.id);
    clearMessages();

    try {
      const { error } = await supabase
        .from("recurring_availability")
        .delete()
        .eq("id", pattern.id);

      if (error) {
        console.error("Vast moment verwijderen fout:", error.message);
        showError("Dit vaste moment kon niet worden verwijderd.");
        return;
      }

      setPendingAction(null);
      setSuccessMessage(
        `De reeks op elke ${getWeekdayLabel(pattern.weekday).toLowerCase()} is verwijderd.`
      );

      await loadPatterns(false);
    } catch (error) {
      console.error("Onverwachte verwijderfout:", error);
      showError("Dit vaste moment kon niet worden verwijderd.");
    } finally {
      setUpdatingPatternId(null);
    }
  }

  async function confirmPendingAction(): Promise<void> {
    if (!pendingAction) return;
    if (pendingAction.type === "toggle") {
      await togglePattern(pendingAction.pattern);
      return;
    }
    await deletePattern(pendingAction.pattern);
  }

  async function handleLogout(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showError("Uitloggen lukt nu niet.");
      return;
    }
    router.replace("/trainer-login");
    router.refresh();
  }

  function getConfirmationTitle(): string {
    if (!pendingAction) return "";
    if (pendingAction.type === "delete") return "VASTE REEKS VERWIJDEREN?";
    return pendingAction.pattern.is_active
      ? "VASTE REEKS PAUZEREN?"
      : "VASTE REEKS ACTIVEREN?";
  }

  function getConfirmationText(): string {
    if (!pendingAction) return "";
    const pattern = pendingAction.pattern;
    const moment = `Elke ${getWeekdayLabel(pattern.weekday).toLowerCase()} van ${formatTime(pattern.starts_at_time)} tot ${formatTime(pattern.ends_at_time)} bij ${getVenueLabel(pattern.venue)}.`;

    if (pendingAction.type === "delete") {
      return `${moment} Deze vaste reeks wordt definitief verwijderd.`;
    }
    if (pattern.is_active) {
      return `${moment} Deze reeks wordt gepauzeerd. Er worden geen nieuwe slots meer aangemaakt.`;
    }
    return `${moment} Deze reeks wordt weer actief. GowTrain vult automatisch slots aan voor de komende 8 weken.`;
  }

  /* BRANDBOOK BRANDED LOADER */
  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">
              GOWTRAIN
            </span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
            VASTE MOMENTEN LADEN...
          </p>
        </div>
      </main>
    );
  }

  const trainerIsActive =
    trainerAccount?.approval_status === "approved" &&
    trainerAccount.is_active === true;

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/trainer-dashboard"
            aria-label="Terug naar trainerdashboard"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/trainer-dashboard"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              ← DASHBOARD
            </a>

            <button
              type="button"
              onClick={() => void handleLogout()}
              className="border-2 border-white px-4 py-2 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]"
            >
              UITLOGGEN
            </button>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[14rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[23rem]"
        >
          SLOT
        </div>

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">ROOSTER BEHEER</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                VASTE<br />MOMENTEN.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
                Stel je wekelijkse beschikbaarheid in. Actieve reeksen vullen automatisch boekbare slots aan voor de komende 8 weken.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="border-2 border-white px-4 py-3 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>

              <a
                href="/trainer-beschikbaarheid/nieuw"
                className={`inline-flex items-center justify-center px-5 py-3 font-display text-sm transition ${
                  trainerIsActive
                    ? "bg-[#FF4B3E] text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    : "pointer-events-none bg-[#53595E] text-white/60"
                }`}
              >
                + VASTE REEKS
              </a>
            </div>
          </div>

          {!trainerIsActive && (
            <div className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 text-white">
              <p className="font-display text-lg">JE PROFIEL IS NOG NIET ACTIEF</p>
              <p className="mt-2 leading-relaxed text-white/90">
                Je kunt vaste beschikbaarheid toevoegen zodra je trainerprofiel is goedgekeurd.
              </p>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              {successMessage}
            </div>
          )}

          {/* CONFIRMATION BANNER */}
          {pendingAction && (
            <section
              className={`mt-8 border-2 p-5 sm:p-6 shadow-[8px_8px_0_0_#14171A] ${
                pendingAction.type === "delete"
                  ? "border-[#FF4B3E] bg-[#FF4B3E] text-white"
                  : "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
              }`}
            >
              <p className="font-display text-3xl">{getConfirmationTitle()}</p>
              <p className="mt-3 max-w-2xl leading-relaxed">{getConfirmationText()}</p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeConfirmation}
                  className={`px-5 py-3 font-display text-base transition ${
                    pendingAction.type === "delete"
                      ? "border-2 border-white text-white hover:bg-white hover:text-[#14171A]"
                      : "border-2 border-[#14171A] text-[#14171A] hover:bg-[#14171A] hover:text-white"
                  }`}
                >
                  TERUG
                </button>

                <button
                  type="button"
                  disabled={updatingPatternId === pendingAction.pattern.id}
                  onClick={() => void confirmPendingAction()}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {updatingPatternId === pendingAction.pattern.id
                    ? "BEZIG..."
                    : pendingAction.type === "delete"
                    ? "VERWIJDER REEKS"
                    : pendingAction.pattern.is_active
                    ? "PAUZEER REEKS"
                    : "ACTIVEER REEKS"}
                </button>
              </div>
            </section>
          )}

          {/* GEEN REEKSEN */}
          {patterns.length === 0 ? (
            <section className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-6 text-white sm:p-8">
                <p className="font-display text-4xl text-[#D6FF3F]">NOG GEEN VASTE REEKSEN.</p>
                <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#B9BEC2]">
                  Stel je wekelijkse beschikbaarheid in. GowTrain vult daarna automatisch losse slots aan voor de komende 8 weken.
                </p>
                <a
                  href="/trainer-beschikbaarheid/nieuw"
                  className={`mt-7 inline-flex px-6 py-4 font-display text-lg transition ${
                    trainerIsActive
                      ? "bg-[#FF4B3E] text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                      : "pointer-events-none bg-[#53595E] text-white/60"
                  }`}
                >
                  VASTE REEKS TOEVOEGEN →
                </a>
              </div>
            </section>
          ) : (
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {patterns.map((pattern) => {
                const isUpdating = updatingPatternId === pattern.id;
                const levelLabel = getLevelLabel(pattern.level);

                return (
                  <article
                    key={pattern.id}
                    className={`border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E] transition ${
                      !pattern.is_active ? "opacity-75" : ""
                    }`}
                  >
                    <div className="bg-[#14171A] p-5 text-white">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-display text-xl text-[#D6FF3F]">
                            ELKE {getWeekdayLabel(pattern.weekday)}
                          </p>
                          <p className="mt-2 font-display text-4xl">
                            {formatTime(pattern.starts_at_time)} – {formatTime(pattern.ends_at_time)}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 px-3 py-1.5 font-display text-xs ${
                            pattern.is_active
                              ? "bg-[#D6FF3F] text-[#14171A]"
                              : "bg-[#303438] text-white"
                          }`}
                        >
                          {pattern.is_active ? "ACTIEF" : "GEPAUZEERD"}
                        </span>
                      </div>

                      <div className="mt-6 grid gap-4 border-y border-white/20 py-4 sm:grid-cols-2">
                        <div>
                          <p className="font-display text-[10px] text-[#8A8F94]">TRAINING</p>
                          <p className="mt-1 font-display text-xl text-white">{pattern.sport.toUpperCase()}</p>
                          <p className="mt-1 text-xs text-[#B9BEC2]">{pattern.duration_minutes} min per les</p>
                          <p className="mt-0.5 text-xs text-[#B9BEC2]">Max. {pattern.max_participants} spelers</p>
                          {levelLabel && (
                            <p className="mt-2 font-display text-xs text-[#D6FF3F]">{levelLabel}</p>
                          )}
                        </div>

                        <div className="sm:text-right">
                          <p className="font-display text-[10px] text-[#8A8F94]">PRIJS PER LES</p>
                          <p className="mt-1 font-display text-2xl text-[#D6FF3F]">
                            {formatEuro(pattern.price_cents, pattern.currency)}
                          </p>
                          <p className="mt-0.5 text-xs text-[#B9BEC2]">Incl. baanhuur</p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="font-display text-xs text-[#FF4B3E]">LOCATIE</p>
                        <p className="mt-1 font-display text-base text-white">{getVenueLabel(pattern.venue)}</p>
                        {pattern.venue && (
                          <p className="mt-0.5 text-xs text-[#B9BEC2]">{pattern.venue.address_line}, {pattern.venue.city}</p>
                        )}
                      </div>

                      {/* KNOPPEN PER PATROON */}
                      <div className="mt-6 grid grid-cols-2 gap-3">
                        <a
                          href={`/trainer-beschikbaarheid/${pattern.id}/wijzigen`}
                          className="col-span-2 flex items-center justify-center border-2 border-white px-4 py-3 font-display text-sm !text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                        >
                          WIJZIG REEKS →
                        </a>

                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => openToggleConfirmation(pattern)}
                          className="bg-[#D6FF3F] px-4 py-3 font-display text-sm text-[#14171A] transition hover:bg-white disabled:opacity-60"
                        >
                          {isUpdating ? "..." : pattern.is_active ? "PAUZEER" : "ACTIVEER"}
                        </button>

                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => openDeleteConfirmation(pattern)}
                          className="bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white transition hover:bg-white hover:!text-[#14171A] disabled:opacity-60"
                        >
                          VERWIJDER
                        </button>
                      </div>

                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="mt-12 border-t border-white/20 pt-6">
            <p className="font-display text-xs text-[#8A8F94]">HOE WERKT HET?</p>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[#B9BEC2]">
              Een actieve reeks vult automatisch beschikbare slots aan voor de komende 8 weken. Pauzeren stopt het aanmaken van nieuwe slots. Verwijderen stopt de reeks volledig. Bestaande slots en geboekte lessen blijven altijd behouden.
            </p>
          </div>

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}