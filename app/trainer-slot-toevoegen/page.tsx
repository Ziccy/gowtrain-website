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
  distanceKm?: number | null;
};

const durationOptions: number[] = [30, 60, 90, 120];
const participantOptions: number[] = [1, 2, 3, 4];

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function createDateFromInputs(
  dateValue: string,
  timeValue: string
): Date | null {
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

function isQuarterHour(timeValue: string): boolean {
  const [, minutesString] = timeValue.split(":");
  const minutes = Number(minutesString);
  return [0, 15, 30, 45].includes(minutes);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(value)
    .toUpperCase();
}

function formatPreviewDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(value)
    .replace(".", "")
    .toUpperCase();
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
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
  if (environment === "indoor") return "BINNEN";
  if (environment === "outdoor") return "BUITEN";
  if (environment === "indoor_outdoor") return "BINNEN & BUITEN";
  return null;
}

function getVenueLabel(venue: Venue): string {
  return `${venue.city} — ${venue.name}`;
}

function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export default function TrainerSlotToevoegenPage() {
  const router = useRouter();
  const successMessageRef = useRef<HTMLDivElement | null>(null);

  const initialDate = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    return tomorrow;
  }, []);

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();

  const [dateValue, setDateValue] = useState<string>(
    toDateInputValue(initialDate)
  );
  const [timeValue, setTimeValue] = useState<string>(
    toTimeInputValue(initialDate)
  );

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

  const startDateTime = useMemo(() => {
    return createDateFromInputs(dateValue, timeValue);
  }, [dateValue, timeValue]);

  const endDateTime = useMemo(() => {
    if (!startDateTime) return null;
    const end = new Date(startDateTime);
    end.setMinutes(end.getMinutes() + selectedDuration);
    return end;
  }, [startDateTime, selectedDuration]);

  const selectedVenue = useMemo(() => {
    return venues.find((venue) => venue.id === selectedVenueId) ?? null;
  }, [selectedVenueId, venues]);

  /* 💡 SLIMME DUBBELE FILTERING: 1. JOUW STAD (ROERMOND) | 2. REGIO (LIMBURG) | 3. REST */
  const { cityVenues, nearbyVenues, otherVenues, searchVenues } = useMemo(() => {
    const normalizedSearch = venueSearch.trim().toLocaleLowerCase("nl-NL");

    // Als er handmatig gezocht wordt:
    if (normalizedSearch) {
      const searchMatches = venues.filter((venue) => {
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

      return { cityVenues: [], nearbyVenues: [], otherVenues: [], searchVenues: searchMatches };
    }

    const trainerCity = trainerAccount?.city?.trim().toLowerCase() ?? "";
    const trainerProvince = trainerAccount?.province?.trim().toLowerCase() ?? "";
    const maxRadius = trainerAccount?.radius_km ?? 25;

    const inCity: Venue[] = [];
    const nearby: Venue[] = [];
    const others: Venue[] = [];

    venues.forEach((venue) => {
      const venueCity = venue.city.trim().toLowerCase();
      const venueProvince = venue.province?.trim().toLowerCase() ?? "";

      // PRIORITEIT 1: EXTREEM EXACTE STAD MATCH (bijv. Roermond)
      if (trainerCity && (venueCity === trainerCity || venueCity.includes(trainerCity))) {
        inCity.push(venue);
        return;
      }

      // PRIORITEIT 2: NABIJE REGIO (GPS Afstand of Provincie)
      let isNearby = false;
      if (
        trainerAccount?.latitude &&
        trainerAccount?.longitude &&
        venue.latitude &&
        venue.longitude
      ) {
        const dist = calculateDistanceKm(
          trainerAccount.latitude,
          trainerAccount.longitude,
          venue.latitude,
          venue.longitude
        );
        venue.distanceKm = dist;
        if (dist <= maxRadius) {
          isNearby = true;
        }
      } else if (trainerProvince && venueProvince === trainerProvince) {
        isNearby = true;
      }

      if (isNearby) {
        nearby.push(venue);
      } else {
        others.push(venue);
      }
    });

    nearby.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

    return { cityVenues: inCity, nearbyVenues: nearby, otherVenues: others, searchVenues: [] };
  }, [venueSearch, venues, trainerAccount]);

  const formattedPrice = useMemo(() => {
    return formatEuroFromInput(price);
  }, [price]);

  const trainerIsActive =
    trainerAccount?.approval_status === "approved" &&
    trainerAccount.is_active === true;

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
        .select("id, is_active, approval_status, city, province, radius_km, latitude, longitude")
        .eq("user_id", user.id)
        .single();

      if (trainerError || !trainerData) {
        console.error("Trainer ophalen fout:", trainerError?.message);
        showError("Je trainerprofiel kon niet worden geladen.");
        return;
      }

      setTrainerAccount(trainerData as TrainerAccount);
    } catch (error) {
      console.error("Onverwachte trainerprofiel-fout:", error);
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
        .select(
          "id, name, address_line, postal_code, city, province, latitude, longitude, sports, court_environment"
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

    if (!startDateTime || !endDateTime) {
      showError("Kies een geldige datum en starttijd.");
      return;
    }

    if (!isQuarterHour(timeValue)) {
      showError("Kies een starttijd per kwartier: :00, :15, :30 of :45.");
      return;
    }

    if (startDateTime <= new Date()) {
      showError("Kies een tijdslot in de toekomst.");
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

    setSaving(true);

    try {
      const { data: hasOverlap, error: overlapError } = await supabase.rpc(
        "trainer_has_overlapping_slot",
        {
          p_trainer_id: trainerAccount.id,
          p_starts_at: startDateTime.toISOString(),
          p_ends_at: endDateTime.toISOString(),
        }
      );

      if (overlapError) {
        console.error("Overlapcontrole fout:", overlapError.message);
        showError("De overlapcontrole lukt nu niet.");
        return;
      }

      if (hasOverlap === true) {
        showError("Dit tijdslot overlapt met een bestaand moment.");
        return;
      }

      const { error: insertError } = await supabase
        .from("availability_slots")
        .insert({
          trainer_id: trainerAccount.id,
          starts_at: startDateTime.toISOString(),
          ends_at: endDateTime.toISOString(),
          sport: selectedSport,
          location_id: selectedVenueId,
          max_participants: maxParticipants,
          price_cents: priceCents,
          currency: "eur",
          status: "available",
        });

      if (insertError) {
        console.error("Slot toevoegen fout:", insertError.message);
        showError("Je tijdslot kon niet worden opgeslagen.");
        return;
      }

      setSuccessMessage(
        `${selectedSport.toUpperCase()} · ${formatDate(
          startDateTime
        )} · ${formatTime(startDateTime)} – ${formatTime(
          endDateTime
        )} · ${getVenueLabel(selectedVenue)}`
      );
    } catch (error) {
      console.error("Onverwachte slot-fout:", error);
      showError("Je tijdslot kon niet worden opgeslagen.");
    } finally {
      setSaving(false);
    }
  }

  function resetFormForNewSlot(): void {
    clearMessages();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);

    setDateValue(toDateInputValue(tomorrow));
    setTimeValue(toTimeInputValue(tomorrow));
    setSelectedDuration(60);
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(false);
    setMaxParticipants(1);
    setPrice("");
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
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/trainer-slots"
            aria-label="Terug naar mijn slots"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/trainer-slots"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              ← MIJN SLOTS
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
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          <div className="border-b-2 border-white/20 pb-8">
            <p className="font-display text-lg text-[#FF4B3E]">BESCHIKBAARHEID</p>
            <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
              NIEUW<br />TIJDSLOT.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
              Kies wanneer en waar je les wilt geven. Spelers kunnen dit moment straks direct vinden en boeken.
            </p>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {/* SUCCESS FEEDBACK */}
{successMessage && (
  <div
    ref={successMessageRef}
    role="status"
    tabIndex={-1}
    className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 text-[#14171A] outline-none shadow-[8px_8px_0_0_#FF4B3E]"
  >
    <p className="font-display text-3xl">SLOT GEPUBLICEERD!</p>
    <p className="mt-3 font-semibold leading-relaxed">
      {successMessage}
    </p>
    <p className="mt-2 text-sm font-semibold">
      Spelers kunnen dit moment nu direct in de app boeken.
    </p>

    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      {/* Toegevoegd: !text-white en hover:!text-[#14171A] */}
      <a
        href="/trainer-slots"
        className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base !text-white transition hover:bg-white hover:!text-[#14171A]"
      >
        BEKIJK MIJN SLOTS →
      </a>

      <button
        type="button"
        onClick={resetFormForNewSlot}
        className="inline-flex items-center justify-center border-2 border-[#14171A] px-5 py-3 font-display text-base text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
      >
        NOG EEN SLOT TOEVOEGEN
      </button>
    </div>
  </div>
)}

          <form onSubmit={handleSave} className="mt-8">
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-5 text-white sm:p-8">
                <p className="font-display text-xl text-[#D6FF3F]">JOUW NIEUWE MOMENT.</p>

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

                {/* Datum */}
                <div className="mt-8">
                  <label htmlFor="date" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    DATUM
                  </label>
                  <input
                    id="date"
                    type="date"
                    value={dateValue}
                    min={toDateInputValue(new Date())}
                    disabled={saving}
                    onChange={(e) => {
                      clearMessages();
                      setDateValue(e.target.value);
                    }}
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none transition [color-scheme:dark] focus:border-[#D6FF3F]"
                  />
                </div>

                {/* Starttijd */}
                <div className="mt-6">
                  <label htmlFor="time" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    STARTTIJD (PER KWARTIER)
                  </label>
                  <input
                    id="time"
                    type="time"
                    value={timeValue}
                    step={900}
                    disabled={saving}
                    onChange={(e) => {
                      clearMessages();
                      const nextTime = e.target.value;
                      const [hours, minutes] = nextTime.split(":");
                      if (!["00", "15", "30", "45"].includes(minutes)) return;
                      setTimeValue(`${hours}:${minutes}`);
                    }}
                    className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-lg text-white outline-none transition [color-scheme:dark] focus:border-[#D6FF3F]"
                  />
                </div>

                {/* Lesduur */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">DUUR</legend>
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

                {/* LOCATIE PICKER MET DUBBELE REGIO GROUPING */}
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
                      <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                        
                        {/* ALS DE GEBRUIKER ZELF AAN HET TYPEN IS */}
                        {venueSearch.trim() && searchVenues.length > 0 && (
                          searchVenues.map((venue) => (
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

                        {venueSearch.trim() && searchVenues.length === 0 && (
                          <p className="px-5 py-5 text-sm text-[#B9BEC2]">Geen locaties gevonden voor “{venueSearch}”.</p>
                        )}

                        {/* ALS DE GEBRUIKER NIET TYPT (STANDAARD OPENING) */}
                        {!venueSearch.trim() && (
                          <>
                            {/* PRIO 1: EXACT IN JOUW STAD (bijv. Roermond) */}
                            {cityVenues.length > 0 && (
                              <div>
                                <div className="sticky top-0 bg-[#D6FF3F] px-4 py-2 font-display text-xs text-[#14171A]">
                                  📍 LOCATIES IN JOUW STAD ({trainerAccount?.city?.toUpperCase()})
                                </div>
                                {cityVenues.map((venue) => (
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
                                ))}
                              </div>
                            )}

                            {/* PRIO 2: REGIO (bijv. Limburg / binnen km straal) */}
                            {nearbyVenues.length > 0 && (
                              <div>
                                <div className="sticky top-0 bg-[#303438] px-4 py-2 font-display text-xs text-[#D6FF3F]">
                                  📍 REGIO {trainerAccount?.province?.toUpperCase() || "DICHTSBIJ"} (BINNEN {trainerAccount?.radius_km || 25} KM)
                                </div>
                                {nearbyVenues.map((venue) => (
                                  <button
                                    key={venue.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => handleVenueSelect(venue)}
                                    className="group block w-full border-b border-white/15 px-5 py-4 text-left transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                                  >
                                    <div className="flex justify-between items-center">
                                      <span className="font-display text-base">{getVenueLabel(venue)}</span>
                                      {venue.distanceKm !== undefined && (
                                        <span className="font-display text-xs text-[#D6FF3F] group-hover:text-[#14171A]">
                                          {venue.distanceKm} KM
                                        </span>
                                      )}
                                    </div>
                                    <span className="mt-1 block text-xs opacity-75">{venue.address_line}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* PRIO 3: REST VAN NEDERLAND */}
                            {otherVenues.length > 0 && (
                              <div>
                                <div className="sticky top-0 bg-[#14171A] border-t border-white/20 px-4 py-2 font-display text-xs text-[#8A8F94]">
                                  OVERIGE LOCATIES IN NEDERLAND
                                </div>
                                {otherVenues.map((venue) => (
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
                                ))}
                              </div>
                            )}
                          </>
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
                      onChange={(e) => {
                        clearMessages();
                        setPrice(e.target.value);
                      }}
                      placeholder="Bijv. 100"
                      className="w-full bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>
                </div>

                {/* SUBMIT BUTTON */}
                <button
                  type="submit"
                  disabled={saving || !trainerIsActive || venuesLoading}
                  className="mt-8 flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "SLOT OPSLAAN..." : "OPSLAAN. GOW!"}
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