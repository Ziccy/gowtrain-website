"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";
import {
  addCalendarDays,
  createAmsterdamDateFromInputs,
  formatAmsterdamDate,
  getAmsterdamDateInputs,
} from "@/lib/amsterdam-date-time";

type ApprovalStatus = "pending" | "approved" | "rejected";
type Sport = "padel" | "tennis";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: ApprovalStatus;
  city: string | null;
  province: string | null;
  radius_km: number | null;
  latitude: number | null;
  longitude: number | null;
};

type Venue = {
  id: string;
  name: string;
  address_line: string;
  postal_code: string | null;
  city: string;
  province: string | null;
  sports: Sport[];
  court_environment: "indoor" | "outdoor" | "indoor_outdoor" | null;
};

const lessonCountOptions = [5, 8, 10, 12];
const durationOptions = [60, 90, 120];
const participantOptions = [1, 2, 3, 4];

const hoursOptions = Array.from(
  { length: 17 },
  (_, index) => String(index + 7).padStart(2, "0"),
);

const minuteOptions = ["00", "15", "30", "45"];

function formatMoney(value: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getVenueLabel(venue: Venue): string {
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export default function TrainerPakketToevoegenPage() {
  const router = useRouter();

  const successMessageRef = useRef<HTMLDivElement | null>(null);
  const errorMessageRef = useRef<HTMLDivElement | null>(null);
  const venuePickerRef = useRef<HTMLDivElement | null>(null);
  const saveInProgressRef = useRef(false);

  const [trainerAccount, setTrainerAccount] =
    useState<TrainerAccount | null>(null);

  const [title, setTitle] = useState("");
  const [selectedSport, setSelectedSport] = useState<Sport>("padel");
  const [lessonCount, setLessonCount] = useState(10);
  const [selectedDuration, setSelectedDuration] = useState(60);

  /*
   * Na het laden van de pagina initialiseren we de datum vanuit
   * Europe/Amsterdam, onafhankelijk van de browsertijdzone.
   */
  const [startDateValue, setStartDateValue] = useState("");
  const [selectedHour, setSelectedHour] = useState("19");
  const [selectedMinute, setSelectedMinute] = useState("00");

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [venuesError, setVenuesError] = useState("");
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [venueSearch, setVenueSearch] = useState("");
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);

  const [maxParticipants, setMaxParticipants] = useState(1);
  const [price, setPrice] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createdPackageId, setCreatedPackageId] = useState<string | null>(
    null,
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const timeValue = `${selectedHour}:${selectedMinute}`;

  const startDateTime = useMemo(() => {
    return createAmsterdamDateFromInputs(startDateValue, timeValue);
  }, [startDateValue, timeValue]);

  const lastLessonDate = useMemo(() => {
    const lastDateValue = addCalendarDays(
      startDateValue,
      (lessonCount - 1) * 7,
    );

    return lastDateValue
      ? createAmsterdamDateFromInputs(lastDateValue, timeValue)
      : null;
  }, [startDateValue, timeValue, lessonCount]);

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? null,
    [venues, selectedVenueId],
  );

  const priceNumber = Number(price.replace(",", "."));

  const previewPrice =
    Number.isFinite(priceNumber) && priceNumber > 0 ? priceNumber : 0;

  const averagePricePerLesson = previewPrice / lessonCount;

  const trainerIsActive =
    trainerAccount?.approval_status === "approved" &&
    trainerAccount.is_active === true;

  const formDisabled = saving || createdPackageId !== null;

  const { cityVenues, otherVenues, searchVenues } = useMemo(() => {
    const query = venueSearch.trim().toLocaleLowerCase("nl-NL");

    if (query) {
      const matches = venues.filter((venue) => {
        const searchableText = [
          venue.name,
          venue.city,
          venue.address_line,
          venue.postal_code,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("nl-NL");

        return searchableText.includes(query);
      });

      return {
        cityVenues: [] as Venue[],
        otherVenues: [] as Venue[],
        searchVenues: matches,
      };
    }

    const trainerCity =
      trainerAccount?.city?.trim().toLocaleLowerCase("nl-NL") ?? "";

    const inCity: Venue[] = [];
    const others: Venue[] = [];

    for (const venue of venues) {
      const venueCity = venue.city.trim().toLocaleLowerCase("nl-NL");

      if (trainerCity && venueCity === trainerCity) {
        inCity.push(venue);
      } else {
        others.push(venue);
      }
    }

    return {
      cityVenues: inCity,
      otherVenues: others,
      searchVenues: [] as Venue[],
    };
  }, [venues, venueSearch, trainerAccount?.city]);

  useEffect(() => {
    const today = getAmsterdamDateInputs(new Date()).date;
    const nextWeek = addCalendarDays(today, 7);

    if (nextWeek) {
      setStartDateValue(nextWeek);
    }
  }, []);

  useEffect(() => {
    if (!successMessage) return;

    const timeout = window.setTimeout(() => {
      successMessageRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      successMessageRef.current?.focus();
    }, 50);

    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    if (!errorMessage) return;

    const timeout = window.setTimeout(() => {
      errorMessageRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      errorMessageRef.current?.focus();
    }, 50);

    return () => window.clearTimeout(timeout);
  }, [errorMessage]);

  useEffect(() => {
    function handleOutsideClick(event: PointerEvent): void {
      if (
        event.target instanceof Node &&
        venuePickerRef.current &&
        !venuePickerRef.current.contains(event.target)
      ) {
        setVenuePickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsideClick);

    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTrainerAccount(): Promise<void> {
      setLoading(true);
      setErrorMessage("");

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (cancelled) return;

        if (userError || !user) {
          router.replace("/trainer-login");
          return;
        }

        const { data: trainerData, error: trainerError } = await supabase
          .from("trainers")
          .select(
            "id, is_active, approval_status, city, province, radius_km, latitude, longitude",
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (trainerError || !trainerData) {
          throw new Error("Je trainerprofiel kon niet worden geladen.");
        }

        setTrainerAccount(trainerData as TrainerAccount);
      } catch (error: unknown) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Je trainerprofiel kon niet worden geladen.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTrainerAccount();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function loadVenues(): Promise<void> {
      setVenuesLoading(true);
      setVenuesError("");
      setVenues([]);

      try {
        const { data, error } = await supabase
          .from("venues")
          .select(
            "id, name, address_line, postal_code, city, province, sports, court_environment",
          )
          .eq("is_active", true)
          .in("country_code", ["NL", "BE"])
          .contains("sports", [selectedSport])
          .order("city", { ascending: true })
          .order("name", { ascending: true });

        if (error) throw error;

        if (!cancelled) {
          setVenues((data ?? []) as Venue[]);
        }
      } catch {
        if (!cancelled) {
          setVenuesError(
            "Locaties konden niet worden geladen. Vernieuw de pagina om opnieuw te proberen.",
          );
        }
      } finally {
        if (!cancelled) setVenuesLoading(false);
      }
    }

    void loadVenues();

    return () => {
      cancelled = true;
    };
  }, [selectedSport]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  function handleSportChange(sport: Sport): void {
    if (sport === selectedSport) return;

    clearMessages();
    setSelectedSport(sport);
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(false);
  }

  function handleVenueSelect(venue: Venue): void {
    clearMessages();
    setSelectedVenueId(venue.id);
    setVenueSearch("");
    setVenuePickerOpen(false);
  }

  function resetFormForNewPackage(): void {
    if (saveInProgressRef.current) return;

    clearMessages();
    setCreatedPackageId(null);
    setTitle("");
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(false);
    setPrice("");
    setSelectedHour("19");
    setSelectedMinute("00");

    const today = getAmsterdamDateInputs(new Date()).date;
    setStartDateValue(addCalendarDays(today, 7) ?? today);
  }

  async function handleSave(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (saveInProgressRef.current || createdPackageId) return;

    clearMessages();

    if (!trainerAccount || !trainerIsActive) {
      showError(
        "Je trainerprofiel moet goedgekeurd en actief zijn om pakketten aan te maken.",
      );
      return;
    }

    if (!title.trim() || title.trim().length > 200) {
      showError("Vul een titel van maximaal 200 tekens in.");
      return;
    }

    if (
      !lessonCountOptions.includes(lessonCount) ||
      !durationOptions.includes(selectedDuration) ||
      !participantOptions.includes(maxParticipants)
    ) {
      showError("Controleer het aantal lessen, de lesduur en groepsgrootte.");
      return;
    }

    if (
      !hoursOptions.includes(selectedHour) ||
      !minuteOptions.includes(selectedMinute)
    ) {
      showError("Kies een geldig begintijdstip op een kwartier.");
      return;
    }

    if (
      venuesLoading ||
      venuesError ||
      !selectedVenueId ||
      !selectedVenue
    ) {
      showError("Kies een geldige vaste trainingslocatie.");
      return;
    }

    if (
      !startDateTime ||
      !Number.isFinite(startDateTime.getTime()) ||
      startDateTime.getTime() <= Date.now()
    ) {
      showError(
        "Kies een geldige toekomstige startdatum en tijd in Europe/Amsterdam.",
      );
      return;
    }

    if (!lastLessonDate) {
      showError("De wekelijkse planning kon niet worden berekend.");
      return;
    }

    const amount = Number(price.replace(",", "."));
    const priceCents = Math.round(amount * 100);

    if (
      !Number.isFinite(amount) ||
      !Number.isSafeInteger(priceCents) ||
      priceCents < lessonCount ||
      priceCents > 2147483647
    ) {
      showError("Vul een geldige totaalprijs in.");
      return;
    }

    saveInProgressRef.current = true;
    setSaving(true);

    try {
      /*
       * Alleen de eerste starttijd wordt meegestuurd.
       * De SQL-functie bouwt de weken op in Europe/Amsterdam.
       *
       * Eigenaarschap, trainerstatus en invoer worden opnieuw
       * in de database gecontroleerd.
       */
      const { data, error } = await supabase.rpc(
        "create_trainer_package",
        {
          p_trainer_id: trainerAccount.id,
          p_title: title.trim(),
          p_sport: selectedSport,
          p_lesson_count: lessonCount,
          p_duration_minutes: selectedDuration,
          p_starts_at: startDateTime.toISOString(),
          p_location_id: selectedVenueId,
          p_max_participants: maxParticipants,
          p_price_cents: priceCents,
        },
      );

      if (error) {
        console.error("Lespakket aanmaken mislukt:", {
          code: error.code,
          message: error.message,
        });

        if (error.code === "42501") {
          showError(
            "Pakketten aanmaken is niet toegestaan voor deze aanvraag of is tijdelijk uitgeschakeld.",
          );
        } else if (error.code === "P0001") {
          showError(error.message);
        } else {
          showError(
            "Het aanmaken kon niet worden bevestigd. Controleer eerst Mijn slots & pakketten voordat je opnieuw probeert.",
          );
        }

        return;
      }

      if (!isUuid(data)) {
        showError(
          "De server gaf geen geldig pakket-ID terug. Controleer eerst Mijn slots & pakketten voordat je opnieuw probeert.",
        );
        return;
      }

      setCreatedPackageId(data);
      setPrice((priceCents / 100).toFixed(2));
      setVenuePickerOpen(false);

      setSuccessMessage(
        `LESPAKKET '${title.trim().toUpperCase()}' IS GEPUBLICEERD. ` +
          `${lessonCount} pakketlessen zijn aangemaakt op ${selectedVenue.name}, ` +
          `wekelijks om ${timeValue} uur in Europe/Amsterdam.`,
      );
    } catch {
      showError(
        "De verbinding is onderbroken. Het pakket kan al zijn aangemaakt. Controleer eerst Mijn slots & pakketten; probeer niet blind opnieuw.",
      );
    } finally {
      saveInProgressRef.current = false;
      setSaving(false);
    }
  }

  function renderVenueOption(venue: Venue) {
    return (
      <button
        key={venue.id}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => handleVenueSelect(venue)}
        className="block w-full border-b border-white/15 px-4 py-3 text-left text-white transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
      >
        <span className="block font-display text-sm">
          {getVenueLabel(venue)}
        </span>

        <span className="mt-1 block text-xs opacity-75">
          {venue.address_line}
          {venue.postal_code ? ` · ${venue.postal_code}` : ""}
        </span>
      </button>
    );
  }

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
            LADEN...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                LESPAKKETTEN &amp; TRAJECTEN
              </p>

              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                NIEUW
                <br />
                LESPAKKET.
              </h1>

              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Bied spelers een compleet traject aan op een vast wekelijks
                tijdstip in Nederland of België.
              </p>
            </div>

            <Link
              href="/trainer-dashboard"
              className="inline-flex shrink-0 border-2 border-white px-4 py-2.5 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
            >
              ← DASHBOARD
            </Link>
          </div>

          {errorMessage && (
            <div
              ref={errorMessageRef}
              tabIndex={-1}
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white outline-none"
            >
              {errorMessage}
            </div>
          )}

          {!trainerIsActive && (
            <div className="mt-6 border-2 border-white/30 p-5 text-sm">
              Je trainerprofiel moet goedgekeurd en actief zijn om
              pakketten aan te maken.
            </div>
          )}

          {successMessage && (
            <div
              ref={successMessageRef}
              tabIndex={-1}
              role="status"
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] outline-none shadow-[8px_8px_0_0_#FF4B3E]"
            >
              <p className="font-display text-3xl">
                LESPAKKET GEPUBLICEERD!
              </p>

              <p className="mt-3 font-semibold leading-relaxed">
                {successMessage}
              </p>

              {createdPackageId && (
                <p className="mt-3 break-all text-xs">
                  Pakket-ID: {createdPackageId}
                </p>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/trainer-slots"
                  className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base !text-white transition hover:bg-white hover:!text-[#14171A]"
                >
                  BEKIJK MIJN PAKKETTEN →
                </Link>

                <button
                  type="button"
                  onClick={resetFormForNewPackage}
                  className="inline-flex items-center justify-center border-2 border-[#14171A] px-5 py-3 font-display text-base text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
                >
                  NOG EEN PAKKET TOEVOEGEN
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSave} className="mt-8">
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <fieldset
                disabled={formDisabled || !trainerIsActive}
                className="min-w-0 border-0 bg-[#14171A] p-5 text-white sm:p-8"
              >
                {/* Titel */}
                <div>
                  <label
                    htmlFor="title"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    TITEL VAN HET TRAJECT
                  </label>

                  <input
                    id="title"
                    type="text"
                    value={title}
                    maxLength={200}
                    required
                    onChange={(event) => {
                      clearMessages();
                      setTitle(event.target.value);
                    }}
                    placeholder="Bijv. Padel Tactiek Traject"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>

                {/* Sport */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    SPORT
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["padel", "tennis"] as Sport[]).map((sport) => (
                      <button
                        key={sport}
                        type="button"
                        aria-pressed={selectedSport === sport}
                        onClick={() => handleSportChange(sport)}
                        className={`border-2 px-5 py-3 font-display text-sm transition ${
                          selectedSport === sport
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {sport.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Aantal lessen */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    AANTAL LESSEN IN HET PAKKET
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {lessonCountOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={lessonCount === count}
                        onClick={() => {
                          clearMessages();
                          setLessonCount(count);
                        }}
                        className={`border-2 px-5 py-3 font-display text-sm transition ${
                          lessonCount === count
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {count} LESSEN
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Datum en tijd */}
                <div className="mt-8 grid gap-6 sm:grid-cols-2 sm:items-start">
                  <div>
                    <label
                      htmlFor="startDate"
                      className="mb-2 block font-display text-base text-[#FF4B3E]"
                    >
                      STARTDATUM EERSTE LES
                    </label>

                    <input
                      id="startDate"
                      type="date"
                      value={startDateValue}
                      min="2000-01-01"
                      max="2100-12-31"
                      required
                      onChange={(event) => {
                        clearMessages();
                        setStartDateValue(event.target.value);
                      }}
                      className="h-[52px] w-full border-2 border-white/25 bg-transparent px-4 font-display text-base text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="start-hour"
                      className="mb-2 block font-display text-base text-[#FF4B3E]"
                    >
                      WEKELIJKS TIJDSTIP
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        id="start-hour"
                        value={selectedHour}
                        onChange={(event) => {
                          clearMessages();
                          setSelectedHour(event.target.value);
                        }}
                        className="h-[52px] w-full border-2 border-white/25 bg-[#14171A] px-3 font-display text-base text-white outline-none focus:border-[#D6FF3F]"
                      >
                        {hoursOptions.map((hour) => (
                          <option key={hour} value={hour}>
                            {hour}:00 UUR
                          </option>
                        ))}
                      </select>

                      <div
                        role="group"
                        aria-label="Minuten"
                        className="grid h-[52px] grid-cols-2 gap-1"
                      >
                        {minuteOptions.map((minute) => (
                          <button
                            key={minute}
                            type="button"
                            aria-label={`${minute} minuten`}
                            aria-pressed={selectedMinute === minute}
                            onClick={() => {
                              clearMessages();
                              setSelectedMinute(minute);
                            }}
                            className={`h-full border-2 font-display text-xs transition ${
                              selectedMinute === minute
                                ? "border-[#D6FF3F] bg-[#D6FF3F] font-bold text-[#14171A]"
                                : "border-white/30 text-white hover:border-white"
                            }`}
                          >
                            :{minute}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs leading-relaxed text-[#B9BEC2] sm:col-span-2">
                    <p>
                      Gekozen wekelijks tijdstip (Europe/Amsterdam):{" "}
                      <span className="font-display text-sm text-[#D6FF3F]">
                        {selectedHour}:{selectedMinute} UUR
                      </span>
                    </p>

                    <p className="mt-1">
                      Dit is de lokale tijd in Nederland en België.
                      Bij de zomer- en wintertijdwisseling blijft het
                      gekozen lokale begintijdstip gelijk.
                    </p>
                  </div>
                </div>

                {/* Lesduur */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    DUUR PER LES
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {durationOptions.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        aria-pressed={selectedDuration === duration}
                        onClick={() => {
                          clearMessages();
                          setSelectedDuration(duration);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
                          selectedDuration === duration
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {duration} MIN
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Locatie */}
                <div className="mt-8">
                  <label
                    htmlFor="venue-search"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    VASTE TRAININGSLOCATIE
                  </label>

                  <div ref={venuePickerRef} className="relative">
                    <input
                      id="venue-search"
                      type="search"
                      value={
                        venuePickerOpen
                          ? venueSearch
                          : selectedVenue
                            ? getVenueLabel(selectedVenue)
                            : venueSearch
                      }
                      disabled={formDisabled || venuesLoading}
                      autoComplete="off"
                      aria-expanded={venuePickerOpen}
                      aria-controls="venue-results"
                      onFocus={() => {
                        setVenueSearch("");
                        setVenuePickerOpen(true);
                      }}
                      onChange={(event) => {
                        setVenueSearch(event.target.value);
                        setVenuePickerOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setVenuePickerOpen(false);
                        }
                      }}
                      placeholder={
                        venuesLoading
                          ? "Locaties laden..."
                          : "Zoek op stad of clubnaam..."
                      }
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F] disabled:opacity-60"
                    />

                    {venuePickerOpen &&
                      !venuesLoading &&
                      !venuesError && (
                        <div
                          id="venue-results"
                          className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                        >
                          {venueSearch.trim() ? (
                            searchVenues.length > 0 ? (
                              searchVenues.map(renderVenueOption)
                            ) : (
                              <p className="px-4 py-4 text-sm text-[#B9BEC2]">
                                Geen locaties gevonden.
                              </p>
                            )
                          ) : (
                            <>
                              {cityVenues.length > 0 && (
                                <>
                                  <p className="bg-white/5 px-4 py-2 font-display text-xs text-[#D6FF3F]">
                                    IN JOUW STAD
                                  </p>

                                  {cityVenues.map(renderVenueOption)}
                                </>
                              )}

                              {otherVenues.length > 0 && (
                                <>
                                  <p className="bg-white/5 px-4 py-2 font-display text-xs text-[#D6FF3F]">
                                    ANDERE LOCATIES
                                  </p>

                                  {otherVenues.map(renderVenueOption)}
                                </>
                              )}

                              {venues.length === 0 && (
                                <p className="px-4 py-4 text-sm text-[#B9BEC2]">
                                  Geen geschikte locaties beschikbaar.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                  </div>

                  {venuesError && (
                    <p role="alert" className="mt-2 text-sm text-[#FF4B3E]">
                      {venuesError}
                    </p>
                  )}

                  {selectedVenue && (
                    <p className="mt-2 text-xs text-[#D6FF3F]">
                      Geselecteerd: {getVenueLabel(selectedVenue)}
                    </p>
                  )}
                </div>

                {/* Groepsgrootte */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    MAXIMAAL AANTAL SPELERS
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {participantOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={maxParticipants === count}
                        onClick={() => {
                          clearMessages();
                          setMaxParticipants(count);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
                          maxParticipants === count
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {count}{" "}
                        {count === 1 ? "SPELER (PRIVÉ)" : "SPELERS (GROEP)"}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Totaalprijs */}
                <div className="mt-8">
                  <label
                    htmlFor="price"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    TOTAALPRIJS VOOR HET HELE PAKKET ({lessonCount} LESSEN
                    INCL. BAANHUUR)
                  </label>

                  <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F]">
                    <span className="flex items-center border-r-2 border-white/25 px-4 font-display text-xl text-[#D6FF3F]">
                      €
                    </span>

                    <input
                      id="price"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      required
                      value={price}
                      onChange={(event) => {
                        clearMessages();
                        setPrice(event.target.value);
                      }}
                      placeholder="Bijv. 380,50"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-[#8A8F94]">
                    De speler betaalt het pakket in één keer vooraf.
                    De toepasselijke commissie wordt bij de
                    betaalreservering vastgelegd.
                  </p>
                </div>

                {/* Preview */}
                <div className="mt-10 border-2 border-white/25 bg-white/5 p-5">
                  <p className="font-display text-xs text-[#D6FF3F]">
                    PREVIEW LESPAKKET
                  </p>

                  <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-white/20 pb-4">
                    <div>
                      <p className="break-words font-display text-2xl text-white">
                        {title || "Pakkettitel"}
                      </p>

                      <p className="text-xs text-[#B9BEC2]">
                        {lessonCount} lessen · {selectedDuration} min per les
                        · Max. {maxParticipants} spelers
                      </p>

                      <p className="mt-1 text-xs text-[#B9BEC2]">
                        Wekelijks om {timeValue} uur — Europe/Amsterdam
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-display text-3xl text-[#D6FF3F]">
                        {formatMoney(previewPrice)}
                      </p>

                      <p className="text-[10px] text-[#8A8F94]">
                        GEMIDDELD {formatMoney(averagePricePerLesson)} PER LES
                      </p>
                    </div>
                  </div>

                  {startDateTime && lastLessonDate && (
                    <div className="mt-4 text-xs text-[#B9BEC2]">
                      <p>
                        🗓️ <strong>Looptijd:</strong>{" "}
                        {formatAmsterdamDate(startDateTime)} t/m{" "}
                        {formatAmsterdamDate(lastLessonDate)}
                      </p>

                      <p className="mt-1">
                        📍 <strong>Locatie:</strong>{" "}
                        {selectedVenue
                          ? getVenueLabel(selectedVenue)
                          : "Kies een locatie"}
                      </p>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={
                    formDisabled ||
                    !trainerIsActive ||
                    venuesLoading ||
                    Boolean(venuesError)
                  }
                  className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "OPSLAAN..."
                    : createdPackageId
                      ? "PAKKET IS AANGEMAAKT"
                      : "LESPAKKET PUBLICEREN. GOW!"}

                  {!saving && !createdPackageId && (
                    <span aria-hidden="true">→</span>
                  )}
                </button>
              </fieldset>
            </div>
          </form>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}