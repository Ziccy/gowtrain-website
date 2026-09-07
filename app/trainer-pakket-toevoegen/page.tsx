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
  province?: string;
  latitude?: number | null;
  longitude?: number | null;
  sports: Sport[];
  court_environment: "indoor" | "outdoor" | "indoor_outdoor" | null;
};

const lessonCountOptions: number[] = [5, 8, 10, 12];
const durationOptions: number[] = [60, 90, 120];
const participantOptions: number[] = [1, 2, 3, 4];
const hoursOptions: string[] = Array.from({ length: 17 }, (_, i) => String(i + 7).padStart(2, "0")); // 07:00 t/m 23:00
const minuteOptions: string[] = ["00", "15", "30", "45"];

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createDateFromInputs(dateValue: string, timeValue: string): Date | null {
  const [yearString, monthString, dayString] = dateValue.split("-");
  const [hoursString, minutesString] = timeValue.split(":");

  const year = Number(yearString);
  const month = Number(monthString);
  const day = Number(dayString);
  const hours = Number(hoursString);
  const minutes = Number(minutesString);

  if (
    !year ||
    !month ||
    !day ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const result = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (Number.isNaN(result.getTime())) return null;
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

function getVenueLabel(venue: Venue): string {
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

export default function TrainerPakketToevoegenPage() {
  const router = useRouter();

  const successMessageRef = useRef<HTMLDivElement | null>(null);
  const errorMessageRef = useRef<HTMLDivElement | null>(null);

  const initialDate = useMemo(() => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(19, 0, 0, 0);
    return nextWeek;
  }, []);

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();

  const [title, setTitle] = useState<string>("");
  const [selectedSport, setSelectedSport] = useState<Sport>("padel");
  const [lessonCount, setLessonCount] = useState<number>(10);
  const [selectedDuration, setSelectedDuration] = useState<number>(60);

  const [startDateValue, setStartDateValue] = useState<string>(
    toDateInputValue(initialDate)
  );

  // CUSTOM KWARTIER TIJDPRIKER STATE
  const [selectedHour, setSelectedHour] = useState<string>("19");
  const [selectedMinute, setSelectedMinute] = useState<string>("00");

  const timeValue = useMemo(() => `${selectedHour}:${selectedMinute}`, [selectedHour, selectedMinute]);

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

  const startDateTime = useMemo(() => {
    return createDateFromInputs(startDateValue, timeValue);
  }, [startDateValue, timeValue]);

  const lastLessonDate = useMemo(() => {
    if (!startDateTime) return null;
    const end = new Date(startDateTime);
    end.setDate(end.getDate() + (lessonCount - 1) * 7);
    return end;
  }, [startDateTime, lessonCount]);

  const selectedVenue = useMemo(() => {
    return venues.find((v) => v.id === selectedVenueId) ?? null;
  }, [selectedVenueId, venues]);

  const pricePerLesson = useMemo(() => {
    const total = Number(price.replace(",", "."));
    if (Number.isNaN(total) || total <= 0 || lessonCount <= 0) return 0;
    return Math.round(total / lessonCount);
  }, [price, lessonCount]);

  /* LOCATIE FILTER SYSTEM */
  const { cityVenues, otherVenues, searchVenues } = useMemo(() => {
    const normalizedSearch = venueSearch.trim().toLocaleLowerCase("nl-NL");

    if (normalizedSearch) {
      const searchMatches = venues.filter((venue) => {
        const searchableText = [venue.name, venue.city, venue.address_line]
          .join(" ")
          .toLocaleLowerCase("nl-NL");
        return searchableText.includes(normalizedSearch);
      });
      return { cityVenues: [], otherVenues: [], searchVenues: searchMatches };
    }

    const trainerCity = trainerAccount?.city?.trim().toLowerCase() ?? "";
    const inCity: Venue[] = [];
    const others: Venue[] = [];

    venues.forEach((v) => {
      const vCity = v.city.trim().toLowerCase();
      if (trainerCity && (vCity === trainerCity || vCity.includes(trainerCity))) {
        inCity.push(v);
      } else {
        others.push(v);
      }
    });

    return { cityVenues: inCity, otherVenues: others, searchVenues: [] };
  }, [venueSearch, venues, trainerAccount]);

  useEffect(() => {
    if (!successMessage) return;
    window.setTimeout(() => {
      successMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      successMessageRef.current?.focus();
    }, 50);
  }, [successMessage]);

  useEffect(() => {
    if (!errorMessage) return;
    window.setTimeout(() => {
      errorMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      errorMessageRef.current?.focus();
    }, 50);
  }, [errorMessage]);

  useEffect(() => {
    void loadTrainerAccount();
  }, []);

  useEffect(() => {
    void loadVenues(selectedSport);
  }, [selectedSport]);

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

      const { data: trainerData, error: trainerError } = await supabase
        .from("trainers")
        .select("id, is_active, approval_status, city, province, radius_km, latitude, longitude")
        .eq("user_id", session.user.id)
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
      const { data } = await supabase
        .from("venues")
        .select("*")
        .eq("is_active", true)
        .contains("sports", [sport])
        .order("city", { ascending: true });

      setVenues((data ?? []) as Venue[]);
      setSelectedVenueId("");
      setVenueSearch("");
      setVenuePickerOpen(false);
    } catch {
      showError("Locaties konden niet worden geladen.");
    } finally {
      setVenuesLoading(false);
    }
  }

  function handleVenueSelect(venue: Venue): void {
    clearMessages();
    setSelectedVenueId(venue.id);
    setVenueSearch(getVenueLabel(venue));
    setVenuePickerOpen(false);
  }

  function resetFormForNewPackage(): void {
    clearMessages();
    setTitle("");
    setSelectedVenueId("");
    setVenueSearch("");
    setPrice("");
    setSelectedHour("19");
    setSelectedMinute("00");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!trainerAccount || trainerAccount.approval_status !== "approved") {
      showError("Je profiel is nog niet goedgekeurd om pakketten aan te maken.");
      return;
    }

    if (!title.trim()) {
      showError("Vul een duidelijke titel in voor je traject.");
      return;
    }

    if (!selectedVenueId || !selectedVenue) {
      showError("Kies de vaste trainingslocatie voor dit traject.");
      return;
    }

    if (!startDateTime || startDateTime <= new Date()) {
      showError("Kies een geldige startdatum in de toekomst.");
      return;
    }

    const priceNumber = Number(price.replace(",", "."));
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      showError("Vul een geldige totaalprijs in voor het hele pakket.");
      return;
    }

    setSaving(true);

    try {
      const priceCents = Math.round(priceNumber * 100);

      const { error: packageRpcError } = await supabase.rpc(
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
        }
      );

      if (packageRpcError) {
        if (
          packageRpcError.message.includes("bookings_slot_id_fkey") || 
          packageRpcError.message.includes("violates foreign key constraint")
        ) {
          showError("Kan lespakket niet aanmaken: er staat op één van de gekozen datums al een geboekte les van een speler.");
        } else {
          showError(packageRpcError.message || "Het lespakket kon niet worden opgeslagen.");
        }
        return;
      }

      setSuccessMessage(
        `LESPAKKET '${title.toUpperCase()}' GEPUBLICEERD! Er zijn ${lessonCount} gereserveerde lesdatums klaargezet op ${selectedVenue.name}.`
      );
    } catch {
      showError("Het lespakket kon niet worden opgeslagen.");
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
      {/* UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">LESPAKKETTEN &amp; TRAJECTEN</p>
              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                NIEUW<br />LESPAKKET.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Bied spelers een compleet traject aan op een vast wekelijks tijdstip.
              </p>
            </div>

            <Link
              href="/trainer-dashboard"
              className="inline-flex shrink-0 border-2 border-white px-4 py-2.5 font-display text-xs text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
            >
              ← DASHBOARD
            </Link>
          </div>

          {/* FOUTMELDING */}
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

          {/* SUCCESMELDING */}
          {successMessage && (
            <div
              ref={successMessageRef}
              tabIndex={-1}
              role="status"
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] outline-none shadow-[8px_8px_0_0_#FF4B3E]"
            >
              <p className="font-display text-3xl">LESPAKKET GEPUBLICEERD!</p>
              <p className="mt-3 font-semibold leading-relaxed">{successMessage}</p>
              
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/trainer-dashboard"
                  className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base !text-white hover:bg-white hover:!text-[#14171A]"
                >
                  TERUG NAAR DASHBOARD →
                </Link>
                <button
                  type="button"
                  onClick={resetFormForNewPackage}
                  className="inline-flex items-center justify-center border-2 border-[#14171A] px-5 py-3 font-display text-base text-[#14171A] hover:bg-[#14171A] hover:!text-white"
                >
                  NOG EEN PAKKET TOEVOEGEN
                </button>
              </div>
            </div>
          )}

          {/* FORMULIER */}
          <form onSubmit={handleSave} className="mt-8">
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-5 text-white sm:p-8">
                
                {/* Titel */}
                <div>
                  <label htmlFor="title" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    TITEL VAN HET TRAJECT
                  </label>
                  <input
                    id="title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Bijv. Padel Tactiek Traject"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                  />
                </div>

                {/* Sport */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">SPORT</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["padel", "tennis"] as Sport[]).map((sport) => (
                      <button
                        key={sport}
                        type="button"
                        onClick={() => setSelectedSport(sport)}
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
                  <legend className="font-display text-base text-[#FF4B3E]">AANTAL LESSEN IN HET PAKKET</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lessonCountOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setLessonCount(count)}
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

                {/* Startdatum & Custom Kwartier Tijdstip */}
                <div className="mt-8 grid gap-6 sm:grid-cols-2 sm:items-start">
                  
                  {/* DATUM VELD */}
                  <div>
                    <label htmlFor="startDate" className="mb-2 block font-display text-base text-[#FF4B3E]">
                      STARTDATUM EERSTE LES
                    </label>
                    <input
                      id="startDate"
                      type="date"
                      value={startDateValue}
                      onChange={(e) => setStartDateValue(e.target.value)}
                      className="h-[52px] w-full border-2 border-white/25 bg-transparent px-4 font-display text-base text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F]"
                    />
                  </div>

                  {/* 💡 TIJDPRIKER */}
                  <div>
                    <label className="mb-2 block font-display text-base text-[#FF4B3E]">
                      WEKELIJKS TIJDSTIP (PER KWARTIER)
                    </label>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={selectedHour}
                        onChange={(e) => setSelectedHour(e.target.value)}
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
                            onClick={() => setSelectedMinute(m)}
                            className={`h-full border-2 font-display text-xs transition ${
                              selectedMinute === m
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

                  {/* 💡 DUIDELIJKE GEKOZEN STARTTIJD WEERGAVE */}
                  <p className="text-xs text-[#B9BEC2] sm:col-span-2">
                    Gekozen wekelijks tijdstip: <span className="font-display text-sm text-[#D6FF3F]">{selectedHour}:{selectedMinute} UUR</span>
                  </p>

                </div>

                {/* Duur */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">DUUR PER LES</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {durationOptions.map((duration) => (
                      <button
                        key={duration}
                        type="button"
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

                {/* LOCATIE PICKER */}
                <div className="mt-8">
                  <label htmlFor="venue-search" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    VASTE TRAININGSLOCATIE
                  </label>

                  <div className="relative">
                    <input
                      id="venue-search"
                      type="search"
                      value={venueSearch}
                      onFocus={() => setVenuePickerOpen(true)}
                      onChange={(e) => {
                        setVenueSearch(e.target.value);
                        setVenuePickerOpen(true);
                      }}
                      placeholder="Zoek op stad of clubnaam..."
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                    />

                    {venuePickerOpen && !venuesLoading && (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                        
                        {venueSearch.trim() && searchVenues.length > 0 && (
                          searchVenues.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleVenueSelect(v)}
                              className="block w-full border-b border-white/15 px-4 py-3 text-left text-white hover:bg-[#D6FF3F] hover:text-[#14171A]"
                            >
                              <span className="block font-display text-sm">{getVenueLabel(v)}</span>
                            </button>
                          ))
                        )}

                        {venueSearch.trim() && searchVenues.length === 0 && (
                          <p className="px-4 py-4 text-xs text-[#B9BEC2]">Geen locaties gevonden voor “{venueSearch}”.</p>
                        )}

                        {!venueSearch.trim() && (
                          <>
                            {cityVenues.length > 0 && (
                              <div>
                                <div className="bg-[#D6FF3F] px-4 py-1.5 font-display text-xs text-[#14171A]">
                                  📍 LOCATIES IN JOUW STAD ({trainerAccount?.city?.toUpperCase()})
                                </div>
                                {cityVenues.map((v) => (
                                  <button
                                    key={v.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => handleVenueSelect(v)}
                                    className="block w-full border-b border-white/15 px-4 py-3 text-left text-white hover:bg-[#D6FF3F] hover:text-[#14171A]"
                                  >
                                    <span className="block font-display text-sm">{getVenueLabel(v)}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {otherVenues.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleVenueSelect(v)}
                                className="block w-full border-b border-white/15 px-4 py-3 text-left text-white hover:bg-[#D6FF3F] hover:text-[#14171A]"
                              >
                                <span className="block font-display text-sm">{getVenueLabel(v)}</span>
                              </button>
                            ))}
                          </>
                        )}

                      </div>
                    )}
                  </div>
                </div>

                {/* Groepsgrootte */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">MAXIMAAL AANTAL SPELERS</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {participantOptions.map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setMaxParticipants(count)}
                        className={`border-2 px-4 py-3 font-display text-sm transition ${
                          maxParticipants === count
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {count} {count === 1 ? "SPELER (PRIVÉ)" : "SPELERS (GROEP)"}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Totaalprijs */}
                <div className="mt-8">
                  <label htmlFor="price" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    TOTAALPRIJS VOOR HET HELE PAKKET ({lessonCount} LESSEN INCL. BAANHUUR)
                  </label>

                  <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F]">
                    <span className="flex items-center border-r-2 border-white/25 px-4 font-display text-xl text-[#D6FF3F]">
                      €
                    </span>
                    <input
                      id="price"
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="Bijv. 380"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>
                  <p className="mt-2 text-xs text-[#8A8F94]">
                    💡 De speler betaalt dit bedrag in 1 keer vooraf bij het boeken. GowTrain inhoudt 5% commissie op de totaalsom.
                  </p>
                </div>

                {/* PREVIEW */}
                <div className="mt-10 border-2 border-white/25 bg-white/5 p-5">
                  <p className="font-display text-xs text-[#D6FF3F]">PREVIEW LESPAKKET</p>
                  
                  <div className="mt-4 border-b border-white/20 pb-4 flex justify-between items-end">
                    <div>
                      <p className="font-display text-2xl text-white">{title || "Pakkettitel"}</p>
                      <p className="text-xs text-[#B9BEC2]">{lessonCount} lessen · {selectedDuration} min per les · Wekelijks om {selectedHour}:{selectedMinute} uur</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-3xl text-[#D6FF3F]">€{price || 0}</p>
                      <p className="text-[10px] text-[#8A8F94]">€{pricePerLesson} PER LES</p>
                    </div>
                  </div>

                  {startDateTime && lastLessonDate && (
                    <div className="mt-4 text-xs text-[#B9BEC2]">
                      <p>🗓️ <strong>Looptijd:</strong> {formatDate(startDateTime)} t/m {formatDate(lastLessonDate)}</p>
                      <p className="mt-1">📍 <strong>Locatie:</strong> {selectedVenue ? getVenueLabel(selectedVenue) : "Kies een locatie"}</p>
                    </div>
                  )}
                </div>

                {/* SUBMIT BUTTON */}
                <button
                  type="submit"
                  disabled={saving}
                  className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:opacity-60"
                >
                  {saving ? "OPSLAAN..." : "LESPAKKET PUBLICEREN. GOW!"}
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