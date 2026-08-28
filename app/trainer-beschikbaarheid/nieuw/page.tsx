"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type ApprovalStatus = "pending" | "approved" | "rejected";
type Sport = "padel" | "tennis";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: ApprovalStatus;
};

type Venue = {
  id: string;
  name: string;
  address_line: string;
  postal_code: string | null;
  city: string;
  sports: Sport[];
  court_environment: "indoor" | "outdoor" | "indoor_outdoor" | null;
};

type CreateRecurringAvailabilityResult = {
  recurring_availability_id: string;
  created_slots: number;
  skipped_slots: number;
};

type WeekdayOption = {
  value: number;
  shortLabel: string;
  label: string;
};

const weekdayOptions: WeekdayOption[] = [
  { value: 1, shortLabel: "MA", label: "MAANDAG" },
  { value: 2, shortLabel: "DI", label: "DINSDAG" },
  { value: 3, shortLabel: "WO", label: "WOENSDAG" },
  { value: 4, shortLabel: "DO", label: "DONDERDAG" },
  { value: 5, shortLabel: "VR", label: "VRIJDAG" },
  { value: 6, shortLabel: "ZA", label: "ZATERDAG" },
  { value: 7, shortLabel: "ZO", label: "ZONDAG" },
];

const durationOptions: number[] = [30, 60, 90, 120];
const participantOptions: number[] = [1, 2, 3, 4];

function getWeekdayLabel(weekday: number): string {
  return (
    weekdayOptions.find((option) => option.value === weekday)?.label ??
    "ONBEKEND"
  );
}

function getMinutesFromTime(timeValue: string): number | null {
  const parts = timeValue.split(":");

  if (parts.length !== 2) {
    return null;
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function isQuarterHour(timeValue: string): boolean {
  const minutes = getMinutesFromTime(timeValue);

  return minutes !== null && minutes % 15 === 0;
}

function toDatabaseTime(timeValue: string): string | null {
  const minutes = getMinutesFromTime(timeValue);

  if (minutes === null) {
    return null;
  }

  const hoursValue = Math.floor(minutes / 60);
  const minutesValue = minutes % 60;

  return `${String(hoursValue).padStart(2, "0")}:${String(
    minutesValue
  ).padStart(2, "0")}:00`;
}

function formatEuroFromInput(value: string): string {
  const parsedValue = Number(value.replace(",", "."));

  if (
    !value.trim() ||
    Number.isNaN(parsedValue) ||
    !Number.isFinite(parsedValue) ||
    parsedValue <= 0
  ) {
    return "–";
  }

  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(parsedValue);
}

function formatCourtEnvironment(
  environment: Venue["court_environment"]
): string | null {
  if (environment === "indoor") {
    return "BINNEN";
  }

  if (environment === "outdoor") {
    return "BUITEN";
  }

  if (environment === "indoor_outdoor") {
    return "BINNEN & BUITEN";
  }

  return null;
}

function getVenueLabel(venue: Venue): string {
  return `${venue.city} — ${venue.name}`;
}

export default function NieuwVastMomentPage() {
  const router = useRouter();
  const successMessageRef = useRef<HTMLDivElement | null>(null);

  const [trainerAccount, setTrainerAccount] =
    useState<TrainerAccount | null>();

  const [selectedWeekday, setSelectedWeekday] = useState<number>(1);
  const [startTime, setStartTime] = useState<string>("18:00");
  const [endTime, setEndTime] = useState<string>("21:00");
  const [selectedDuration, setSelectedDuration] = useState<number>(60);

  const [selectedSport, setSelectedSport] = useState<Sport>("padel");

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState<boolean>(true);
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");
  const [venueSearch, setVenueSearch] = useState<string>("");
  const [venuePickerOpen, setVenuePickerOpen] = useState<boolean>(false);

  const [maxParticipants, setMaxParticipants] = useState<number>(1);
  const [price, setPrice] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const trainerIsActive =
    trainerAccount?.approval_status === "approved" &&
    trainerAccount.is_active === true;

  const selectedVenue = useMemo(() => {
    return venues.find((venue) => venue.id === selectedVenueId) ?? null;
  }, [venues, selectedVenueId]);

  const filteredVenues = useMemo(() => {
    const normalizedSearch = venueSearch.trim().toLocaleLowerCase("nl-NL");

    if (!normalizedSearch) {
      return venues;
    }

    return venues.filter((venue) => {
      const searchableText = [
        venue.name,
        venue.city,
        venue.address_line,
        venue.postal_code ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("nl-NL");

      return searchableText.includes(normalizedSearch);
    });
  }, [venueSearch, venues]);

  const startMinutes = useMemo(
    () => getMinutesFromTime(startTime),
    [startTime]
  );

  const endMinutes = useMemo(() => getMinutesFromTime(endTime), [endTime]);

  const blockMinutes =
    startMinutes !== null && endMinutes !== null && endMinutes > startMinutes
      ? endMinutes - startMinutes
      : 0;

  const possibleSlots =
    blockMinutes >= selectedDuration
      ? Math.floor(blockMinutes / selectedDuration)
      : 0;

  const formattedPrice = useMemo(() => {
    return formatEuroFromInput(price);
  }, [price]);

  useEffect(() => {
    void loadTrainerAccount();
  }, []);

  useEffect(() => {
    void loadVenues(selectedSport);
  }, [selectedSport]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    window.setTimeout(() => {
      successMessageRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      successMessageRef.current?.focus();
    }, 50);
  }, [successMessage]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function loadTrainerAccount(): Promise<void> {
    setLoading(true);
    clearMessages();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/trainer-login");
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        await supabase.auth.signOut();
        router.replace("/trainer-login");
        return;
      }

      const { data: trainerData, error: trainerError } = await supabase
        .from("trainers")
        .select("id, is_active, approval_status")
        .eq("user_id", user.id)
        .single();

      if (trainerError || !trainerData) {
        console.error("Trainer ophalen fout:", trainerError?.message);

        showError(
          "Je trainerprofiel kon niet worden geladen. Probeer opnieuw in te loggen."
        );

        return;
      }

      setTrainerAccount(trainerData as TrainerAccount);
    } catch (error) {
      console.error("Onverwachte trainerprofiel-fout:", error);

      showError(
        "Je trainerprofiel kon niet worden geladen. Vernieuw de pagina en probeer het opnieuw."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadVenues(sport: Sport): Promise<void> {
    setVenuesLoading(true);

    try {
      const { data, error } = await supabase
        .from("venues")
        .select(
          "id, name, address_line, postal_code, city, sports, court_environment"
        )
        .eq("is_active", true)
        .contains("sports", [sport])
        .order("city", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        console.error("Locaties ophalen fout:", error.message);
        showError("De trainingslocaties konden niet worden geladen.");
        return;
      }

      setVenues((data ?? []) as Venue[]);
      setSelectedVenueId("");
      setVenueSearch("");
      setVenuePickerOpen(false);
    } catch (error) {
      console.error("Onverwachte locaties-fout:", error);
      showError("De trainingslocaties konden niet worden geladen.");
    } finally {
      setVenuesLoading(false);
    }
  }

  function handleSportChange(sport: Sport): void {
    clearMessages();

    if (sport === selectedSport) {
      return;
    }

    setSelectedSport(sport);
  }

  function handleVenueSearchChange(value: string): void {
    clearMessages();
    setVenueSearch(value);
    setSelectedVenueId("");
    setVenuePickerOpen(true);
  }

  function handleVenueSelect(venue: Venue): void {
    clearMessages();
    setSelectedVenueId(venue.id);
    setVenueSearch(getVenueLabel(venue));
    setVenuePickerOpen(false);
  }

  function clearVenueSelection(): void {
    clearMessages();
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(true);
  }

  function resetFormForNewMoment(): void {
    clearMessages();
    setSelectedWeekday(1);
    setStartTime("18:00");
    setEndTime("21:00");
    setSelectedDuration(60);
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(false);
    setMaxParticipants(1);
    setPrice("");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!trainerAccount) {
      showError("Je trainerprofiel kon niet worden geladen.");
      return;
    }

    if (!trainerIsActive) {
      showError(
        "Je profiel is nog niet actief. Je kunt vaste momenten toevoegen zodra je trainerprofiel is goedgekeurd."
      );
      return;
    }

    if (!selectedVenueId || !selectedVenue) {
      showError("Kies de exacte locatie waar deze training plaatsvindt.");
      return;
    }

    if (maxParticipants < 1 || maxParticipants > 4) {
      showError("Kies een geldig maximaal aantal spelers.");
      return;
    }

    if (!price.trim()) {
      showError("Vul een totaalprijs inclusief baanhuur in.");
      return;
    }

    if (!isQuarterHour(startTime) || !isQuarterHour(endTime)) {
      showError(
        "Kies een start- en eindtijd per kwartier: :00, :15, :30 of :45."
      );
      return;
    }

    const databaseStartTime = toDatabaseTime(startTime);
    const databaseEndTime = toDatabaseTime(endTime);

    if (!databaseStartTime || !databaseEndTime) {
      showError("Kies een geldige start- en eindtijd.");
      return;
    }

    if (
      startMinutes === null ||
      endMinutes === null ||
      endMinutes <= startMinutes
    ) {
      showError("De eindtijd moet na de starttijd liggen.");
      return;
    }

    if (blockMinutes < selectedDuration) {
      showError(
        "De gekozen lesduur past niet binnen dit tijdsblok. Kies een langere periode of een kortere lesduur."
      );
      return;
    }

    const priceNumber = Number(price.replace(",", "."));

    if (
      Number.isNaN(priceNumber) ||
      !Number.isFinite(priceNumber) ||
      priceNumber <= 0
    ) {
      showError("Vul een geldige totaalprijs in.");
      return;
    }

    const priceCents = Math.round(priceNumber * 100);

    if (priceCents <= 0) {
      showError("Vul een geldige totaalprijs in.");
      return;
    }

    setSaving(true);

    try {
      const { data, error } = await supabase.rpc(
        "create_recurring_availability_and_slots",
        {
          p_trainer_id: trainerAccount.id,
          p_weekday: selectedWeekday,
          p_starts_at_time: databaseStartTime,
          p_ends_at_time: databaseEndTime,
          p_duration_minutes: selectedDuration,

          p_sport: selectedSport,
          p_location_id: selectedVenueId,
          p_max_participants: maxParticipants,
          p_price_cents: priceCents,

          p_weeks_ahead: 8,
        }
      );

      if (error) {
        console.error("Vaste beschikbaarheid opslaan fout:", error.message);

        showError(
          "Je vaste moment kon niet worden opgeslagen. Controleer de gegevens en probeer het opnieuw."
        );

        return;
      }

      const result = (
        Array.isArray(data) ? data[0] : data
      ) as CreateRecurringAvailabilityResult | null;

      const createdSlots = result?.created_slots ?? 0;
      const skippedSlots = result?.skipped_slots ?? 0;

      const skippedText =
        skippedSlots > 0
          ? ` ${skippedSlots} overlappend${
              skippedSlots === 1 ? " moment is" : "e momenten zijn"
            } overgeslagen.`
          : "";

      setSuccessMessage(
        `${selectedSport.toUpperCase()} · elke ${getWeekdayLabel(
          selectedWeekday
        ).toLowerCase()} · ${startTime} – ${endTime} · ${
          selectedVenue.name
        }. ${createdSlots} boekbare ${
          createdSlots === 1 ? "slot is" : "slots zijn"
        } toegevoegd voor de komende 8 weken.${skippedText}`
      );
    } catch (error) {
      console.error("Onverwachte opslaan-fout:", error);

      showError(
        "Je vaste moment kon niet worden opgeslagen. Probeer het opnieuw."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout(): Promise<void> {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Uitloggen fout:", error.message);
      showError("Uitloggen lukt nu niet. Probeer het opnieuw.");
      return;
    }

    router.replace("/trainer-login");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="text-center">
          <p className="font-display text-5xl text-[#D6FF3F]">GOW!</p>

          <p className="mt-4 font-display text-lg text-[#FF4B3E]">
            PROFIEL LADEN...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/trainer-beschikbaarheid"
            aria-label="Terug naar vaste momenten"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>

            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/trainer-beschikbaarheid"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              ← VASTE MOMENTEN
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

      <section className="relative flex-1 overflow-hidden py-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">
              BESCHIKBAARHEID
            </p>

            <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
              NIEUW
              <br />
              VAST MOMENT.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
              Stel je wekelijkse beschikbaarheid in. GowTrain maakt automatisch
              losse boekbare momenten voor de komende 8 weken.
            </p>
          </div>

          {!trainerIsActive ? (
            <div className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 text-white">
              <p className="font-display text-lg">
                JE PROFIEL IS NOG NIET ACTIEF.
              </p>

              <p className="mt-2 leading-relaxed text-white/90">
                Je kunt vaste beschikbaarheid toevoegen zodra je trainerprofiel
                is goedgekeurd.
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <div
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold leading-relaxed text-white"
            >
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div
              ref={successMessageRef}
              role="status"
              tabIndex={-1}
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] outline-none shadow-[8px_8px_0_0_#FF4B3E]"
            >
              <p className="font-display text-3xl">
                VAST MOMENT OPGESLAGEN.
              </p>

              <p className="mt-3 font-semibold leading-relaxed">
                {successMessage}
              </p>

              <p className="mt-2 text-sm font-semibold">
                Je nieuwe slots zijn direct zichtbaar voor spelers.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a
                  href="/trainer-beschikbaarheid"
                  className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A]"
                >
                  BEKIJK VASTE MOMENTEN →
                </a>

                <button
                  type="button"
                  onClick={resetFormForNewMoment}
                  className="inline-flex items-center justify-center border-2 border-[#14171A] px-5 py-3 font-display text-base text-[#14171A] transition hover:bg-[#14171A] hover:text-white"
                >
                  NOG EEN MOMENT TOEVOEGEN
                </button>
              </div>
            </div>
          ) : null}

          <form onSubmit={handleSave} className="mt-8">
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-5 text-white sm:p-8">
                <p className="font-display text-xl text-[#D6FF3F]">
                  JOUW VASTE BESCHIKBAARHEID.
                </p>

                <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                  Publiceer alleen momenten waarop jij én de baan beschikbaar
                  zijn. GowTrain maakt vervolgens losse, direct boekbare slots.
                </p>

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
                        disabled={saving}
                        onClick={() => handleSportChange(sport)}
                        className={`border-2 px-5 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
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

                {/* Weekdag */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    ELKE
                  </legend>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {weekdayOptions.map((weekday) => (
                      <button
                        key={weekday.value}
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          clearMessages();
                          setSelectedWeekday(weekday.value);
                        }}
                        className={`min-w-12 border-2 px-4 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          selectedWeekday === weekday.value
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {weekday.shortLabel}
                      </button>
                    ))}
                  </div>

                  <p className="mt-3 font-display text-sm text-[#D6FF3F]"><br></br>
                    ELKE {getWeekdayLabel(selectedWeekday)}
                  </p>
                </fieldset>

                {/* Tijd */}
                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="start-time"
                      className="mb-2 block font-display text-base text-[#FF4B3E]"
                    >
                      VAN (PER KWARTIER)
                    </label>

                    <input
                      id="start-time"
                      type="time"
                      value={startTime}
                      step={900}
                      disabled={saving}
                      onChange={(event) => {
                        clearMessages();

                        const value = event.target.value;

                        if (isQuarterHour(value)) {
                          setStartTime(value);
                        }
                      }}
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-lg text-white outline-none transition [color-scheme:dark] focus:border-[#D6FF3F] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="end-time"
                      className="mb-2 block font-display text-base text-[#FF4B3E]"
                    >
                      TOT (PER KWARTIER)
                    </label>

                    <input
                      id="end-time"
                      type="time"
                      value={endTime}
                      step={900}
                      disabled={saving}
                      onChange={(event) => {
                        clearMessages();

                        const value = event.target.value;

                        if (isQuarterHour(value)) {
                          setEndTime(value);
                        }
                      }}
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-lg text-white outline-none transition [color-scheme:dark] focus:border-[#D6FF3F] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                </div>

                <p className="mt-3 text-sm text-[#8A8F94]">
                  Kies tijden op :00, :15, :30 of :45.
                </p>

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
                        disabled={saving}
                        onClick={() => {
                          clearMessages();
                          setSelectedDuration(duration);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
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

                {/* Trainingslocatie */}
                <div className="mt-8">
                  <label
                    htmlFor="venue-search"
                    className="mb-2 block font-display text-base text-[#FF4B3E]"
                  >
                    TRAININGSLOCATIE
                  </label>

                  <div className="relative">
                    <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F]">
                      <span className="flex items-center border-r-2 border-white/25 px-4 text-lg text-[#D6FF3F]">
                        ⌕
                      </span>

                      <input
                        id="venue-search"
                        type="search"
                        value={venueSearch}
                        disabled={venuesLoading || saving}
                        placeholder={
                          venuesLoading
                            ? "Locaties laden..."
                            : "Zoek op stad of clubnaam"
                        }
                        onFocus={() => {
                          if (!venuesLoading && !saving) {
                            setVenuePickerOpen(true);
                          }
                        }}
                        onChange={(event) =>
                          handleVenueSearchChange(event.target.value)
                        }
                        className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] disabled:cursor-not-allowed disabled:opacity-60"
                      />

                      {selectedVenueId ? (
                        <button
                          type="button"
                          onClick={clearVenueSelection}
                          disabled={saving}
                          className="border-l-2 border-white/25 px-4 font-display text-sm text-white transition hover:bg-[#FF4B3E] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          WIS
                        </button>
                      ) : null}
                    </div>

                    {venuePickerOpen && !venuesLoading && !saving ? (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                        {filteredVenues.length === 0 ? (
                          <p className="px-5 py-5 text-sm text-[#B9BEC2]">
                            Geen {selectedSport}locaties gevonden voor “
                            {venueSearch}”.
                          </p>
                        ) : (
                          filteredVenues.map((venue) => {
                            const environment = formatCourtEnvironment(
                              venue.court_environment
                            );

                            return (
                              <button
                                key={venue.id}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                }}
                                onClick={() => handleVenueSelect(venue)}
                                className="group block w-full border-b border-white/15 px-5 py-4 text-left transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                              >
                                <span className="block font-display text-base">
                                  {getVenueLabel(venue)}
                                </span>

                                <span className="mt-1 block text-sm opacity-75">
                                  {venue.address_line}
                                  {venue.postal_code
                                    ? ` · ${venue.postal_code}`
                                    : ""}
                                </span>

                                {environment ? (
                                  <span className="mt-2 inline-block font-display text-xs text-[#D6FF3F] group-hover:text-[#14171A]">
                                    {environment}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>

                  {!venuesLoading && venues.length === 0 ? (
                    <p className="mt-3 text-sm leading-relaxed text-[#FF4B3E]">
                      Er zijn nog geen actieve {selectedSport}locaties
                      beschikbaar.
                    </p>
                  ) : (
                    <p className="mt-3 text-sm leading-relaxed text-[#8A8F94]">
                      Zoek op stad, dorp, postcode of clubnaam. Kies de locatie
                      waar jij de baan reserveert en lesgeeft.
                    </p>
                  )}

                  {selectedVenue ? (
                    <div className="mt-4 border-l-2 border-[#D6FF3F] bg-white/5 p-4 text-sm text-[#D7D9DA]">
                      <p className="font-display text-base text-white">
                        {getVenueLabel(selectedVenue)}
                      </p>

                      <p className="mt-2">
                        {selectedVenue.address_line}
                        <br />
                        {selectedVenue.postal_code
                          ? `${selectedVenue.postal_code} `
                          : ""}
                        {selectedVenue.city}
                      </p>

                      {formatCourtEnvironment(
                        selectedVenue.court_environment
                      ) ? (
                        <p className="mt-3 font-display text-sm text-[#D6FF3F]">
                          {formatCourtEnvironment(
                            selectedVenue.court_environment
                          )}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Maximaal aantal spelers */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">
                    MAXIMAAL AANTAL SPELERS
                  </legend>

                  <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                    Eén speler reserveert en betaalt een volledig lesmoment. De
                    boeker geeft aan met hoeveel spelers de groep komt.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {participantOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          clearMessages();
                          setMaxParticipants(count);
                        }}
                        className={`border-2 px-4 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          maxParticipants === count
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {count} {count === 1 ? "SPELER" : "SPELERS"}
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
                    TOTAALPRIJS INCLUSIEF BAANHUUR
                  </label>

                  <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F]">
                    <span className="flex items-center border-r-2 border-white/25 px-4 font-display text-xl text-[#D6FF3F]">
                      €
                    </span>

                    <input
                      id="price"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="0.01"
                      value={price}
                      disabled={saving}
                      onChange={(event) => {
                        clearMessages();
                        setPrice(event.target.value);
                      }}
                      placeholder="Bijv. 110"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-[#8A8F94]">
                    Dit is de totaalprijs voor iedere losse sessie, inclusief
                    jouw training en baanhuur. Eén speler betaalt dit bedrag
                    voor de volledige groep.
                  </p>
                </div>

                {/* Controlekaart */}
                <div className="mt-10 border-2 border-white/25 bg-white/5">
                  <div className="flex items-center justify-between border-b-2 border-white/15 px-5 py-4 sm:px-6">
                    <div>
                      <p className="font-display text-sm text-[#D6FF3F]">
                        CONTROLEER JE VASTE MOMENT
                      </p>

                      <p className="mt-1 text-sm text-[#B9BEC2]">
                        GowTrain maakt hiervan losse boekbare slots.
                      </p>
                    </div>

                    <span className="font-display text-sm text-[#FF4B3E]">
                      PREVIEW
                    </span>
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-4 border-b-2 border-white/15 pb-5 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="font-display text-xl text-white sm:text-2xl">
                          ELKE {getWeekdayLabel(selectedWeekday)}
                        </p>

                        <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-[#8A8F94]">
                          {selectedSport}training
                        </p>
                      </div>

                      <p className="font-display text-4xl leading-none text-[#D6FF3F] sm:text-5xl">
                        {startTime}
                        <span className="mx-2 text-white/35">–</span>
                        {endTime}
                      </p>
                    </div>

                    <div className="grid gap-4 border-b-2 border-white/15 py-5 sm:grid-cols-3">
                      <div>
                        <p className="font-display text-xs text-[#8A8F94]">
                          DUUR
                        </p>

                        <p className="mt-2 font-display text-xl text-white">
                          {selectedDuration} MIN
                        </p>

                        <p className="mt-1 text-xs font-semibold text-[#B9BEC2]">
                          Per les
                        </p>
                      </div>

                      <div>
                        <p className="font-display text-xs text-[#8A8F94]">
                          GROEP
                        </p>

                        <p className="mt-2 font-display text-xl text-white">
                          MAX. {maxParticipants}
                        </p>

                        <p className="mt-1 text-xs font-semibold text-[#B9BEC2]">
                          {maxParticipants === 1
                            ? "1 speler"
                            : `${maxParticipants} spelers`}
                        </p>
                      </div>

                      <div>
                        <p className="font-display text-xs text-[#8A8F94]">
                          TOTAALPRIJS
                        </p>

                        <p className="mt-2 font-display text-xl text-[#D6FF3F]">
                          {formattedPrice}
                        </p>

                        <p className="mt-1 text-xs font-semibold text-[#B9BEC2]">
                          Inclusief baanhuur
                        </p>
                      </div>
                    </div>

                    <div className="border-b-2 border-white/15 py-5">
                      <p className="font-display text-xs text-[#8A8F94]">
                        BOEKBARE LESSEN
                      </p>

{possibleSlots > 0 ? (
  <p className="mt-2 text-sm font-semibold leading-relaxed text-white">
    Elke {getWeekdayLabel(selectedWeekday).toLowerCase()} staan er maximaal{" "}
      {possibleSlots}{" "}
      {possibleSlots === 1 ? "LES" : "LESSEN"}
{" "}
    van {selectedDuration} minuten open.
  </p>
) : (
                        <p className="mt-2 text-sm font-semibold leading-relaxed text-[#FF4B3E]">
                          Kies een tijdsblok dat minimaal {selectedDuration}{" "}
                          minuten lang is.
                        </p>
                      )}
                    </div>

                    <div className="pt-5">
                      <p className="font-display text-xs text-[#8A8F94]">
                        LOCATIE
                      </p>

                      {selectedVenue ? (
                        <div className="mt-3 flex items-start gap-3">
                          <div
                            aria-hidden="true"
                            className="mt-1 h-3 w-3 shrink-0 bg-[#FF4B3E]"
                          />

                          <div>
                            <p className="font-display text-lg leading-tight text-white">
                              {selectedVenue.city.toUpperCase()}
                              <span className="mx-2 text-[#FF4B3E]">—</span>
                              {selectedVenue.name}
                            </p>

                            <p className="mt-2 text-sm font-semibold leading-relaxed text-[#B9BEC2]">
                              {selectedVenue.address_line}
                              <br />
                              {selectedVenue.postal_code
                                ? `${selectedVenue.postal_code} `
                                : ""}
                              {selectedVenue.city}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 border-l-2 border-[#FF4B3E] pl-4">
                          <p className="text-sm font-semibold text-[#B9BEC2]">
                            Kies nog een trainingslocatie.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    !trainerIsActive ||
                    venuesLoading ||
                    possibleSlots === 0
                  }
                  className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-white hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {saving
                    ? "VAST MOMENT OPSLAAN..."
                    : "VASTE BESCHIKBAARHEID OPSLAAN"}

                  {!saving ? <span aria-hidden="true">→</span> : null}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}