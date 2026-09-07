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
  province?: string;
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
  venue: Venue | null;
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

export default function TrainerPakketWijzigenPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const packageId = Array.isArray(params.id) ? params.id[0] : params.id;

  const successMessageRef = useRef<HTMLDivElement | null>(null);
  const errorMessageRef = useRef<HTMLDivElement | null>(null);

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();
  const [originalPackage, setOriginalPackage] = useState<TrainerPackageDetail | null>();

  const [title, setTitle] = useState<string>("");
  const [selectedSport, setSelectedSport] = useState<Sport>("padel");
  const [lessonCount, setLessonCount] = useState<number>(10);
  const [selectedDuration, setSelectedDuration] = useState<number>(60);

  const [startDateValue, setStartDateValue] = useState<string>("");

  // 💡 CUSTOM KWARTIER TIJDPRIKER STATE
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
    if (!startDateValue || !timeValue) return null;
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

  /* REGIO-LOCATIE FILTERING */
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
    if (!packageId) {
      setLoading(false);
      setErrorMessage("Lespakket niet gevonden.");
      return;
    }
    void loadPage();
  }, [packageId]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function getCurrentTrainer(): Promise<TrainerAccount | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      router.replace("/trainer-login");
      return null;
    }

    const { data: trainerData, error: trainerError } = await supabase
      .from("trainers")
      .select("id, is_active, approval_status, city, province, radius_km, latitude, longitude")
      .eq("user_id", session.user.id)
      .single();

    if (trainerError || !trainerData) {
      showError("Je trainerprofiel kon niet worden geladen.");
      return null;
    }

    return trainerData as TrainerAccount;
  }

  async function loadVenues(sport: Sport, initialLocationId?: string): Promise<void> {
    setVenuesLoading(true);
    try {
      const { data } = await supabase
        .from("venues")
        .select("*")
        .eq("is_active", true)
        .contains("sports", [sport])
        .order("city", { ascending: true });

      const loadedVenues = (data ?? []) as Venue[];
      setVenues(loadedVenues);

      if (initialLocationId) {
        const found = loadedVenues.find((v) => v.id === initialLocationId);
        if (found) {
          setSelectedVenueId(found.id);
          setVenueSearch(getVenueLabel(found));
        }
      }
    } catch {
      showError("Locaties konden niet worden geladen.");
    } finally {
      setVenuesLoading(false);
    }
  }

  async function loadPage(): Promise<void> {
    setLoading(true);
    clearMessages();

    try {
      const trainer = await getCurrentTrainer();
      if (!trainer) return;

      setTrainerAccount(trainer);

      const { data: pkgData, error: pkgError } = await supabase
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
            is_active,
            venue:venues!trainer_packages_location_id_fkey (
              id, name, city, address_line, postal_code, sports, court_environment
            )
          `
        )
        .eq("id", packageId)
        .eq("trainer_id", trainer.id)
        .maybeSingle();

      if (pkgError || !pkgData) {
        showError("Dit lespakket bestaat niet of kan niet meer worden gewijzigd.");
        return;
      }

      const pkg = pkgData as unknown as TrainerPackageDetail;
      const start = new Date(pkg.starts_at);

      setOriginalPackage(pkg);
      setTitle(pkg.title);
      setSelectedSport(pkg.sport);
      setLessonCount(pkg.lesson_count);
      setSelectedDuration(pkg.duration_minutes);
      setStartDateValue(toDateInputValue(start));

      // Parse uur en minuut
      const sH = String(start.getHours()).padStart(2, "0");
      const sM = String(start.getMinutes()).padStart(2, "0");
      setSelectedHour(sH);
      setSelectedMinute(sM);

      setMaxParticipants(pkg.max_participants);
      setPrice((pkg.price_cents / 100).toFixed(0));

      await loadVenues(pkg.sport, pkg.location_id);
    } catch {
      showError("Het lespakket kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  function handleVenueSelect(venue: Venue): void {
    clearMessages();
    setSelectedVenueId(venue.id);
    setVenueSearch(getVenueLabel(venue));
    setVenuePickerOpen(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    if (!trainerAccount || trainerAccount.approval_status !== "approved") {
      showError("Je profiel is niet geautoriseerd.");
      return;
    }

    if (!title.trim()) {
      showError("Vul een titel in voor het traject.");
      return;
    }

    if (!selectedVenueId || !selectedVenue) {
      showError("Kies een vaste trainingslocatie.");
      return;
    }

    if (!startDateTime || startDateTime <= new Date()) {
      showError("Kies een geldige startdatum in de toekomst.");
      return;
    }

    const priceNumber = Number(price.replace(",", "."));
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      showError("Vul een geldige totaalprijs in.");
      return;
    }

    setSaving(true);

    try {
      const priceCents = Math.round(priceNumber * 100);

      const { error: updateError } = await supabase
        .from("trainer_packages")
        .update({
          title: title.trim(),
          sport: selectedSport,
          lesson_count: lessonCount,
          duration_minutes: selectedDuration,
          starts_at: startDateTime.toISOString(),
          location_id: selectedVenueId,
          max_participants: maxParticipants,
          price_cents: priceCents,
        })
        .eq("id", packageId)
        .eq("trainer_id", trainerAccount.id);

      if (updateError) {
        showError("Het lespakket kon niet worden gewijzigd.");
        return;
      }

      await supabase
        .from("availability_slots")
        .delete()
        .eq("package_id", packageId)
        .eq("status", "package");

      for (let i = 0; i < lessonCount; i++) {
        const lessonStart = new Date(startDateTime);
        lessonStart.setDate(lessonStart.getDate() + i * 7);
        const lessonEnd = new Date(lessonStart);
        lessonEnd.setMinutes(lessonEnd.getMinutes() + selectedDuration);

        await supabase.from("availability_slots").insert({
          trainer_id: trainerAccount.id,
          starts_at: lessonStart.toISOString(),
          ends_at: lessonEnd.toISOString(),
          sport: selectedSport,
          location_id: selectedVenueId,
          max_participants: maxParticipants,
          price_cents: Math.round(priceCents / lessonCount),
          currency: "eur",
          status: "package",
          package_id: packageId,
        });
      }

      setSuccessMessage(`LESPAKKET '${title.toUpperCase()}' IS GEWIJZIGD!`);
    } catch {
      showError("Het lespakket kon niet worden gewijzigd.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">PAKKET LADEN...</p>
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
        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">BESCHIKBAARHEID</p>
              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                WIJZIG<br />LESPAKKET.
              </h1>
            </div>

            <Link
              href="/trainer-slots"
              className="inline-flex shrink-0 border-2 border-white px-4 py-2.5 font-display text-xs text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
            >
              ← MIJN SLOTS &amp; PAKKETEN
            </Link>
          </div>

          {errorMessage && (
            <div ref={errorMessageRef} tabIndex={-1} role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white outline-none">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div ref={successMessageRef} tabIndex={-1} role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <p className="font-display text-3xl">LESPAKKET AANGEPAST!</p>
              <p className="mt-3 font-semibold leading-relaxed">{successMessage}</p>
              <div className="mt-6">
                <Link href="/trainer-slots" className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base !text-white hover:bg-white hover:!text-[#14171A]">
                  TERUG NAAR OVERZICHT →
                </Link>
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
                    placeholder="Bijv. 10-Weken Padel Tactiek Traject"
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none focus:border-[#D6FF3F]"
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
                        onClick={() => {
                          setSelectedSport(sport);
                          void loadVenues(sport);
                        }}
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

                {/* Startdatum & Custom Kwartier Tijdpriker */}
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

                  {/* 💡 CUSTOM KWARTIER TIJDPRIKER */}
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

                {/* Locatie */}
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
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none focus:border-[#D6FF3F]"
                    />

                    {venuePickerOpen && !venuesLoading && (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
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
                      className="w-full bg-transparent px-4 py-4 text-white outline-none"
                    />
                  </div>
                </div>

                {/* PREVIEW */}
                <div className="mt-10 border-2 border-white/25 bg-white/5 p-5">
                  <p className="font-display text-xs text-[#D6FF3F]">PREVIEW LESPAKKET</p>
                  
                  <div className="mt-4 border-b border-white/20 pb-4 flex justify-between items-end">
                    <div>
                      <p className="font-display text-2xl text-white">{title || "Pakkettitel"}</p>
                      <p className="text-xs text-[#B9BEC2]">{lessonCount} lessen · {selectedDuration} min per les · Max. {maxParticipants} spelers</p>
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
                  {saving ? "WIJZIGING OPSLAAN..." : "WIJZIGING OPSLAAN. GOW!"}
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