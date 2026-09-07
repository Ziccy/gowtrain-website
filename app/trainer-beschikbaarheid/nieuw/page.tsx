"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
const hoursOptions: string[] = Array.from({ length: 17 }, (_, i) => String(i + 7).padStart(2, "0")); // 07:00 t/m 23:00
const minuteOptions: string[] = ["00", "15", "30", "45"];

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekdayLabel(weekday: number): string {
  return (
    weekdayOptions.find((option) => option.value === weekday)?.label ??
    "ONBEKEND"
  );
}

function getMinutesFromTime(timeValue: string): number | null {
  const parts = timeValue.split(":");
  if (parts.length !== 2) return null;

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

function toDatabaseTime(timeValue: string): string | null {
  const minutes = getMinutesFromTime(timeValue);
  if (minutes === null) return null;

  const hoursValue = Math.floor(minutes / 60);
  const minutesValue = minutes % 60;

  return `${String(hoursValue).padStart(2, "0")}:${String(minutesValue).padStart(2, "0")}:00`;
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

function getVenueLabel(venue: Venue): string {
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

export default function NieuwVastMomentPage() {
  const router = useRouter();
  const successMessageRef = useRef<HTMLDivElement | null>(null);

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();

  // 💡 INGANGSDATUM STATE
  const [startDateValue, setStartDateValue] = useState<string>(
    toDateInputValue(new Date())
  );

  const [selectedWeekday, setSelectedWeekday] = useState<number>(1);

  // 💡 CUSTOM KWARTIER TIJDPRIKER STATE (VAN & TOT)
  const [startHour, setStartHour] = useState<string>("18");
  const [startMinute, setStartMinute] = useState<string>("00");

  const [endHour, setEndHour] = useState<string>("21");
  const [endMinute, setEndMinute] = useState<string>("00");

  const startTime = useMemo(() => `${startHour}:${startMinute}`, [startHour, startMinute]);
  const endTime = useMemo(() => `${endHour}:${endMinute}`, [endHour, endMinute]);

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

  const startMinutes = useMemo(() => getMinutesFromTime(startTime), [startTime]);
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
    if (!successMessage) return;

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
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/trainer-login");
        return;
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        await supabase.auth.signOut();
        router.replace("/trainer-login");
        return;
      }

      const { data: trainerData, error: trainerError } = await supabase
        .from("trainers")
        .select("id, is_active, approval_status, city, province")
        .eq("user_id", user.id)
        .single();

      if (trainerError || !trainerData) {
        showError("Je trainerprofiel kon niet worden geladen.");
        return;
      }

      setTrainerAccount(trainerData as TrainerAccount);
    } catch {
      showError("Je trainerprofiel kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  async function loadVenues(sport: Sport): Promise<void> {
    setVenuesLoading(true);

    try {
      const { data, error } = await supabase
        .from("venues")
        .select("id, name, address_line, postal_code, city, sports, court_environment")
        .eq("is_active", true)
        .contains("sports", [sport])
        .order("city", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        showError("De trainingslocaties konden niet worden geladen.");
        return;
      }

      setVenues((data ?? []) as Venue[]);
      setSelectedVenueId("");
      setVenueSearch("");
      setVenuePickerOpen(false);
    } catch {
      showError("De trainingslocaties konden niet worden geladen.");
    } finally {
      setVenuesLoading(false);
    }
  }

  function handleSportChange(sport: Sport): void {
    clearMessages();
    if (sport === selectedSport) return;
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
    setStartHour("18");
    setStartMinute("00");
    setEndHour("21");
    setEndMinute("00");
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
      showError("Je profiel is nog niet actief.");
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
      showError("De gekozen lesduur past niet binnen dit tijdsblok.");
      return;
    }

    const priceNumber = Number(price.replace(",", "."));
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      showError("Vul een geldige totaalprijs in.");
      return;
    }

    const priceCents = Math.round(priceNumber * 100);

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
          p_start_date: startDateValue || undefined,
        }
      );

      if (error) {
        showError(error.message || "Je vaste moment kon niet worden opgeslagen.");
        return;
      }

      const result = (Array.isArray(data) ? data[0] : data) as CreateRecurringAvailabilityResult | null;
      const createdSlots = result?.created_slots ?? 0;

      setSuccessMessage(
        `${selectedSport.toUpperCase()} · elke ${getWeekdayLabel(
          selectedWeekday
        ).toLowerCase()} · ${startTime} – ${endTime} · ${
          selectedVenue.name
        }. ${createdSlots} boekbare slots zijn toegevoegd vanaf ${startDateValue}.`
      );
    } catch {
      showError("Je vaste moment kon niet worden opgeslagen.");
    } finally {
      setSaving(false);
    }
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
      {/* 💡 UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">BESCHIKBAARHEID</p>
              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                NIEUW<br />VAST MOMENT.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Stel je wekelijkse beschikbaarheid in. GowTrain maakt automatisch losse boekbare momenten voor de komende 8 weken.
              </p>
            </div>

            <Link
              href="/trainer-beschikbaarheid"
              className="inline-flex shrink-0 border-2 border-white px-4 py-2.5 font-display text-xs text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
            >
              ← VASTE MOMENTEN
            </Link>
          </div>

          {!trainerIsActive && (
            <div className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 text-white">
              <p className="font-display text-lg">JE PROFIEL IS NOG NIET ACTIEF.</p>
              <p className="mt-1 text-sm leading-relaxed text-white/90">
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
            <div
              ref={successMessageRef}
              role="status"
              tabIndex={-1}
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] outline-none shadow-[8px_8px_0_0_#FF4B3E]"
            >
              <p className="font-display text-3xl">VAST MOMENT OPGESLAGEN.</p>
              <p className="mt-3 font-semibold leading-relaxed">{successMessage}</p>
              
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/trainer-beschikbaarheid"
                  className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base !text-white hover:bg-white hover:!text-[#14171A]"
                >
                  BEKIJK VASTE MOMENTEN →
                </Link>

                <button
                  type="button"
                  onClick={resetFormForNewMoment}
                  className="inline-flex items-center justify-center border-2 border-[#14171A] px-5 py-3 font-display text-base text-[#14171A] hover:bg-[#14171A] hover:!text-white"
                >
                  NOG EEN MOMENT TOEVOEGEN
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSave} className="mt-8">
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-5 text-white sm:p-8">
                <p className="font-display text-xl text-[#D6FF3F]">JOUW VASTE BESCHIKBAARHEID.</p>

                {/* Sport */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">SPORT</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["padel", "tennis"] as Sport[]).map((sport) => (
                      <button
                        key={sport}
                        type="button"
                        disabled={saving}
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

                {/* 💡 INGANGSDATUM (VANAF WANNEER GAT DIT IN) */}
                <div className="mt-8">
                  <label htmlFor="startDate" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    VANAF DATUM (INGANGSDATUM)
                  </label>
                  <input
                    id="startDate"
                    type="date"
                    value={startDateValue}
                    min={toDateInputValue(new Date())}
                    disabled={saving}
                    onChange={(e) => {
                      clearMessages();
                      setStartDateValue(e.target.value);
                    }}
                    className="h-[52px] w-full border-2 border-white/25 bg-transparent px-4 font-display text-base text-white outline-none transition [color-scheme:dark] focus:border-[#D6FF3F]"
                  />
                  <p className="mt-2 text-xs text-[#B9BEC2]">Vanaf deze datum vullen we wekelijks je slots automatisch aan.</p>
                </div>

                {/* Weekdag */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">ELKE</legend>
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
                        className={`min-w-12 border-2 px-4 py-3 font-display text-sm transition ${
                          selectedWeekday === weekday.value
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {weekday.shortLabel}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* 💡 CUSTOM KWARTIER TIJDPRIKER (VAN EN TOT) */}
                <div className="mt-8 grid gap-6 sm:grid-cols-2">
                  
                  {/* STARTTIJD */}
                  <div>
                    <label className="mb-2 block font-display text-base text-[#FF4B3E]">
                      VAN (STARTTIJD)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={startHour}
                        disabled={saving}
                        onChange={(e) => setStartHour(e.target.value)}
                        className="h-[52px] w-full border-2 border-white/25 bg-[#14171A] px-3 font-display text-base text-white outline-none focus:border-[#D6FF3F]"
                      >
                        {hoursOptions.map((h) => (
                          <option key={h} value={h}>{h}:00 UUR</option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-1 h-[52px]">
                        {minuteOptions.map((m) => (
                          <button
                            key={m}
                            type="button"
                            disabled={saving}
                            onClick={() => setStartMinute(m)}
                            className={`h-full border-2 font-display text-xs transition ${
                              startMinute === m
                                ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] font-bold"
                                : "border-white/30 text-white hover:border-white"
                            }`}
                          >
                            :{m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* EINDTIJD */}
                  <div>
                    <label className="mb-2 block font-display text-base text-[#FF4B3E]">
                      TOT (EINDTIJD)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={endHour}
                        disabled={saving}
                        onChange={(e) => setEndHour(e.target.value)}
                        className="h-[52px] w-full border-2 border-white/25 bg-[#14171A] px-3 font-display text-base text-white outline-none focus:border-[#D6FF3F]"
                      >
                        {hoursOptions.map((h) => (
                          <option key={h} value={h}>{h}:00 UUR</option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-1 h-[52px]">
                        {minuteOptions.map((m) => (
                          <button
                            key={m}
                            type="button"
                            disabled={saving}
                            onClick={() => setEndMinute(m)}
                            className={`h-full border-2 font-display text-xs transition ${
                              endMinute === m
                                ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] font-bold"
                                : "border-white/30 text-white hover:border-white"
                            }`}
                          >
                            :{m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-[#B9BEC2] sm:col-span-2">
                    Gekozen tijdsblok: <span className="font-display text-sm text-[#D6FF3F]">{startTime} – {endTime} UUR</span>
                  </p>

                </div>

                {/* Lesduur */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">DUUR PER LES</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {durationOptions.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        disabled={saving}
                        onClick={() => setSelectedDuration(duration)}
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

                {/* Trainingslocatie */}
                <div className="mt-8">
                  <label htmlFor="venue-search" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    TRAININGSLOCATIE / CLUB
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
                        placeholder={venuesLoading ? "Locaties laden..." : "Zoek op stad of clubnaam..."}
                        onFocus={() => {
                          if (!venuesLoading && !saving) setVenuePickerOpen(true);
                        }}
                        onChange={(e) => handleVenueSearchChange(e.target.value)}
                        className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                      />

                      {selectedVenueId && (
                        <button
                          type="button"
                          onClick={clearVenueSelection}
                          disabled={saving}
                          className="border-l-2 border-white/25 px-4 font-display text-sm text-white transition hover:bg-[#FF4B3E]"
                        >
                          WIS
                        </button>
                      )}
                    </div>

                    {venuePickerOpen && !venuesLoading && !saving && (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                        {filteredVenues.length === 0 ? (
                          <p className="px-5 py-5 text-sm text-[#B9BEC2]">
                            Geen {selectedSport}locaties gevonden voor “{venueSearch}”.
                          </p>
                        ) : (
                          filteredVenues.map((venue) => (
                            <button
                              key={venue.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleVenueSelect(venue)}
                              className="group block w-full border-b border-white/15 px-5 py-4 text-left transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                            >
                              <span className="block font-display text-base">{getVenueLabel(venue)}</span>
                              <span className="mt-1 block text-xs opacity-75">{venue.address_line}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {selectedVenue && (
                    <div className="mt-4 border-l-2 border-[#D6FF3F] bg-white/5 p-4 text-sm text-[#D7D9DA]">
                      <p className="font-display text-base text-white">{getVenueLabel(selectedVenue)}</p>
                      <p className="mt-1 text-xs text-[#B9BEC2]">{selectedVenue.address_line}, {selectedVenue.city}</p>
                    </div>
                  )}
                </div>

                {/* Maximaal aantal spelers */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">MAXIMAAL AANTAL SPELERS</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {participantOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        disabled={saving}
                        onClick={() => setMaxParticipants(count)}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
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
                  <label htmlFor="price" className="mb-2 block font-display text-base text-[#FF4B3E]">
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
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="Bijv. 110"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>
                </div>

                {/* PREVIEW */}
                <div className="mt-10 border-2 border-white/25 bg-white/5 p-5">
                  <p className="font-display text-xs text-[#D6FF3F]">CONTROLEER JE VASTE MOMENT</p>
                  
                  <div className="mt-4 border-b border-white/20 pb-4 flex justify-between items-end">
                    <div>
                      <p className="font-display text-2xl text-white">ELKE {getWeekdayLabel(selectedWeekday)}</p>
                      <p className="text-xs text-[#B9BEC2]">{selectedSport.toUpperCase()} · {startTime} – {endTime} UUR</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-3xl text-[#D6FF3F]">{formattedPrice}</p>
                      <p className="text-[10px] text-[#8A8F94]">INCL. BAANHUUR</p>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-[#B9BEC2]">
                    <p>🗓️ <b>Ingangsdatum:</b> Vanaf {startDateValue}</p>
                    <p className="mt-1">📍 <b>Locatie:</b> {selectedVenue ? getVenueLabel(selectedVenue) : "Kies een locatie"}</p>
                  </div>
                </div>

                {/* SUBMIT BUTTON */}
                <button
                  type="submit"
                  disabled={saving || !trainerIsActive || venuesLoading || possibleSlots === 0}
                  className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:opacity-60"
                >
                  {saving ? "OPSLAAN..." : "VASTE BESCHIKBAARHEID OPSLAAN. GOW!"}
                  {!saving && <span aria-hidden="true">→</span>}
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