"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

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

type TrainerPackageDetail = {
  id: string;
  trainer_id: string;
  title: string;
  sport: Sport;
  lesson_count: number;
  duration_minutes: number;
  starts_at: string;
  location_id: string;
  max_participants: number;
  price_cents: number;
  currency: string;
  is_active: boolean;
};

const lessonCountOptions = [5, 8, 10, 12];
const durationOptions = [60, 90, 120];
const participantOptions = [1, 2, 3, 4];

const hoursOptions = Array.from(
  { length: 17 },
  (_, index) => String(index + 7).padStart(2, "0")
);

const minuteOptions = ["00", "15", "30", "45"];

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createDateFromInputs(
  dateValue: string,
  timeValue: string
): Date | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateValue) ||
    !/^\d{2}:\d{2}$/.test(timeValue)
  ) {
    return null;
  }

  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  // Deze pagina gebruikt de lokale tijdzone van de browser.
  const result = new Date(
    year,
    month - 1,
    day,
    hours,
    minutes,
    0,
    0
  );

  if (
    !Number.isFinite(result.getTime()) ||
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day ||
    result.getHours() !== hours ||
    result.getMinutes() !== minutes
  ) {
    return null;
  }

  return result;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(value)
    .toUpperCase();
}

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

export default function TrainerPakketWijzigenPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const packageId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const successMessageRef = useRef<HTMLDivElement | null>(null);
  const errorMessageRef = useRef<HTMLDivElement | null>(null);
  const venuePickerRef = useRef<HTMLDivElement | null>(null);
  const saveInProgressRef = useRef(false);

  const [trainerAccount, setTrainerAccount] =
    useState<TrainerAccount | null>(null);

  const [originalPackage, setOriginalPackage] =
    useState<TrainerPackageDetail | null>(null);

  const [title, setTitle] = useState("");
  const [selectedSport, setSelectedSport] = useState<Sport>("padel");
  const [lessonCount, setLessonCount] = useState(10);
  const [selectedDuration, setSelectedDuration] = useState(60);
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
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const timeValue = `${selectedHour}:${selectedMinute}`;

  const startDateTime = useMemo(() => {
    if (!startDateValue) return null;

    return createDateFromInputs(startDateValue, timeValue);
  }, [startDateValue, timeValue]);

  const lastLessonDate = useMemo(() => {
    if (!startDateTime) return null;

    const lastDate = new Date(startDateTime);
    lastDate.setDate(lastDate.getDate() + (lessonCount - 1) * 7);

    return lastDate;
  }, [startDateTime, lessonCount]);

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? null,
    [venues, selectedVenueId]
  );

  const priceNumber = Number(price.replace(",", "."));

  const previewPrice =
    Number.isFinite(priceNumber) && priceNumber > 0
      ? priceNumber
      : 0;

  const averagePricePerLesson = previewPrice / lessonCount;

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

  // Laad het pakket en controleer de huidige gebruiker.
  useEffect(() => {
    let cancelled = false;

    async function loadPage(): Promise<void> {
      setLoading(true);
      setErrorMessage("");
      setSuccessMessage("");
      setOriginalPackage(null);
      setTrainerAccount(null);

      try {
        if (!packageId) {
          throw new Error("Lespakket niet gevonden.");
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (cancelled) return;

        if (userError || !user) {
          router.replace("/trainer-login");
          return;
        }

        const {
          data: trainerData,
          error: trainerError,
        } = await supabase
          .from("trainers")
          .select(
            "id, is_active, approval_status, city, province, radius_km, latitude, longitude"
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (trainerError || !trainerData) {
          throw new Error("Je trainerprofiel kon niet worden geladen.");
        }

        const trainer = trainerData as TrainerAccount;

        if (
          trainer.approval_status !== "approved" ||
          !trainer.is_active
        ) {
          throw new Error(
            "Je trainerprofiel moet goedgekeurd en actief zijn om pakketten te wijzigen."
          );
        }

        setTrainerAccount(trainer);

        const { data: packageData, error: packageError } = await supabase
          .from("trainer_packages")
          .select(
            `
              id,
              trainer_id,
              title,
              sport,
              lesson_count,
              duration_minutes,
              starts_at,
              location_id,
              max_participants,
              price_cents,
              currency,
              is_active
            `
          )
          .eq("id", packageId)
          .eq("trainer_id", trainer.id)
          .maybeSingle();

        if (cancelled) return;

        if (packageError || !packageData) {
          throw new Error(
            "Dit lespakket bestaat niet of je hebt geen toegang."
          );
        }

        const pkg = packageData as TrainerPackageDetail;
        const start = new Date(pkg.starts_at);

        if (!Number.isFinite(start.getTime())) {
          throw new Error("Het pakket bevat een ongeldige startdatum.");
        }

        setOriginalPackage(pkg);
        setTitle(pkg.title);
        setSelectedSport(pkg.sport);
        setLessonCount(pkg.lesson_count);
        setSelectedDuration(pkg.duration_minutes);
        setStartDateValue(toDateInputValue(start));
        setSelectedHour(String(start.getHours()).padStart(2, "0"));
        setSelectedMinute(String(start.getMinutes()).padStart(2, "0"));
        setMaxParticipants(pkg.max_participants);
        setPrice((pkg.price_cents / 100).toFixed(2));
        setSelectedVenueId(pkg.location_id);
        setVenueSearch("");
      } catch (error: unknown) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Het lespakket kon niet worden geladen."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPage();

    return () => {
      cancelled = true;
    };
  }, [packageId, router]);

  // Laad geschikte locaties opnieuw wanneer de sport verandert.
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
            "id, name, address_line, postal_code, city, province, sports, court_environment"
          )
          .eq("is_active", true)
          .in("country_code", ["NL", "BE"])
          .contains("sports", [selectedSport])
          .order("city", { ascending: true })
          .order("name", { ascending: true });

        if (error) {
          throw error;
        }

        if (!cancelled) {
          setVenues((data ?? []) as Venue[]);
        }
      } catch {
        if (!cancelled) {
          setVenuesError(
            "Locaties konden niet worden geladen. Vernieuw de pagina om opnieuw te proberen."
          );
        }
      } finally {
        if (!cancelled) {
          setVenuesLoading(false);
        }
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

  async function handleSave(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (saveInProgressRef.current) return;

    clearMessages();

    if (
      !trainerAccount ||
      trainerAccount.approval_status !== "approved" ||
      !trainerAccount.is_active
    ) {
      showError("Je profiel is niet geautoriseerd.");
      return;
    }

    if (!packageId || !originalPackage) {
      showError("Het lespakket is niet geladen.");
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

    if (venuesLoading || !selectedVenueId || !selectedVenue) {
      showError("Kies een geldige vaste trainingslocatie.");
      return;
    }

    if (
      !startDateTime ||
      !Number.isFinite(startDateTime.getTime()) ||
      startDateTime <= new Date()
    ) {
      showError("Kies een geldige startdatum in de toekomst.");
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
      const { data, error } = await supabase.rpc(
        "update_trainer_package",
        {
          p_package_id: packageId,
          p_title: title.trim(),
          p_sport: selectedSport,
          p_lesson_count: lessonCount,
          p_duration_minutes: selectedDuration,
          p_starts_at: startDateTime.toISOString(),
          p_location_id: selectedVenueId,
          p_max_participants: maxParticipants,
          p_price_cents: priceCents,
        }
      );

      if (error) {
        console.error("Lespakket wijzigen mislukt:", error);

        if (error.code === "P0001") {
          showError(error.message);
        } else if (error.code === "42501") {
          showError(
            "Je hebt geen toestemming om dit pakket te wijzigen."
          );
        } else {
          showError(
            "Het lespakket kon niet worden gewijzigd. Vernieuw de pagina en controleer de gegevens voordat je opnieuw probeert."
          );
        }

        return;
      }

      if (!data) {
        showError(
          "De wijziging kon niet worden bevestigd. Vernieuw de pagina en controleer het pakket."
        );
        return;
      }

      setPrice((priceCents / 100).toFixed(2));
      setSuccessMessage(
        `LESPAKKET '${title.trim().toUpperCase()}' IS GEWIJZIGD!`
      );
    } catch {
      showError(
        "De verbinding is onderbroken. Vernieuw de pagina om te controleren of de wijziging is opgeslagen."
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
            PAKKET LADEN...
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
                BESCHIKBAARHEID
              </p>

              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                WIJZIG
                <br />
                LESPAKKET.
              </h1>
            </div>

            <Link
              href="/trainer-slots"
              className="inline-flex shrink-0 border-2 border-white px-4 py-2.5 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
            >
              ← MIJN SLOTS &amp; PAKKETEN
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

          {successMessage && (
            <div
              ref={successMessageRef}
              tabIndex={-1}
              role="status"
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]"
            >
              <p className="font-display text-3xl">
                LESPAKKET AANGEPAST!
              </p>

              <p className="mt-3 font-semibold leading-relaxed">
                {successMessage}
              </p>

              <div className="mt-6">
                <Link
                  href="/trainer-slots"
                  className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base !text-white transition hover:bg-white hover:!text-[#14171A]"
                >
                  TERUG NAAR OVERZICHT →
                </Link>
              </div>
            </div>
          )}

          {originalPackage && trainerAccount && (
            <form onSubmit={handleSave} className="mt-8">
              <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
                <fieldset
                  disabled={saving}
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
                      placeholder="Bijv. 10-Weken Padel Tactiek Traject"
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none focus:border-[#D6FF3F]"
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

                    <p className="text-xs text-[#B9BEC2] sm:col-span-2">
                      Gekozen wekelijks tijdstip:{" "}
                      <span className="font-display text-sm text-[#D6FF3F]">
                        {selectedHour}:{selectedMinute} UUR
                      </span>
                    </p>
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
                        disabled={saving || venuesLoading}
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
                        className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none focus:border-[#D6FF3F] disabled:opacity-60"
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

                    {!venuesLoading &&
                      !venuesError &&
                      selectedVenueId &&
                      !selectedVenue && (
                        <p className="mt-2 text-sm text-[#FF4B3E]">
                          De eerdere locatie is niet beschikbaar voor deze
                          sport. Kies een andere locatie.
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

                  {/* Prijs */}
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
                        className="w-full bg-transparent px-4 py-4 text-white outline-none"
                      />
                    </div>
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
                          {lessonCount} lessen · {selectedDuration} min per
                          les · Max. {maxParticipants} spelers
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
                          {formatDate(startDateTime)} t/m{" "}
                          {formatDate(lastLessonDate)}
                        </p>

                        <p className="mt-1">
                          📍 <strong>Locatie:</strong>{" "}
                          {selectedVenue
                            ? getVenueLabel(selectedVenue)
                            : "Kies een locatie"}
                        </p>
                      </div>
                    )}

                    <p className="mt-4 text-xs leading-relaxed text-[#8A8F94]">
                      Een gereserveerd of verkocht pakket kan niet via deze
                      pagina worden gewijzigd. De database controleert dit
                      bij het opslaan.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={saving || venuesLoading || Boolean(venuesError)}
                    className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving
                      ? "WIJZIGING OPSLAAN..."
                      : "WIJZIGING OPSLAAN. GOW!"}

                    {!saving && <span aria-hidden="true">→</span>}
                  </button>
                </fieldset>
              </div>
            </form>
          )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}