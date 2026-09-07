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
type SlotStatus = "available" | "held" | "booked" | "cancelled" | "completed";

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

type Slot = {
  id: string;
  starts_at: string;
  ends_at: string;
  sport: Sport;
  location_id: string;
  max_participants: number;
  price_cents: number;
  currency: string;
  status: SlotStatus;
  venue: Venue | null;
};

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

function getVenueLabel(venue: Venue): string {
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

export default function TrainerSlotWijzigenPage() {
  const router = useRouter();
  const params = useParams<{ slotId: string }>();
  const successMessageRef = useRef<HTMLDivElement | null>(null);

  const slotId = Array.isArray(params.slotId)
    ? params.slotId[0]
    : params.slotId;

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();
  const [originalSlot, setOriginalSlot] = useState<Slot | null>();

  const [dateValue, setDateValue] = useState<string>("");

  // 💡 CUSTOM KWARTIER TIJDPRIKER STATE
  const [selectedHour, setSelectedHour] = useState<string>("18");
  const [selectedMinute, setSelectedMinute] = useState<string>("00");

  const timeValue = useMemo(() => `${selectedHour}:${selectedMinute}`, [selectedHour, selectedMinute]);

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

  const startDateTime = useMemo(() => {
    if (!dateValue || !timeValue) return null;
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
  }, [venues, selectedVenueId]);

  const filteredVenues = useMemo(() => {
    const normalizedSearch = venueSearch.trim().toLocaleLowerCase("nl-NL");
    if (!normalizedSearch) return venues;

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

  const formattedPrice = useMemo(() => formatEuroFromInput(price), [price]);

  useEffect(() => {
    if (!slotId) {
      setLoading(false);
      setErrorMessage("Dit slot kon niet worden gevonden.");
      return;
    }

    void loadPage();
  }, [slotId]);

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

  async function getCurrentTrainer(): Promise<TrainerAccount | null> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace("/trainer-login");
      return null;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      router.replace("/trainer-login");
      return null;
    }

    const { data: trainerData, error: trainerError } = await supabase
      .from("trainers")
      .select("id, is_active, approval_status")
      .eq("user_id", user.id)
      .single();

    if (trainerError || !trainerData) {
      showError("Je trainerprofiel kon niet worden geladen.");
      return null;
    }

    return trainerData as TrainerAccount;
  }

  async function loadVenues(
    sport: Sport,
    selectedLocationId?: string
  ): Promise<Venue[]> {
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
        return [];
      }

      const loadedVenues = (data ?? []) as Venue[];
      setVenues(loadedVenues);

      if (selectedLocationId) {
        const currentVenue = loadedVenues.find((venue) => venue.id === selectedLocationId);
        if (currentVenue) {
          setSelectedVenueId(currentVenue.id);
          setVenueSearch(getVenueLabel(currentVenue));
        }
      }

      return loadedVenues;
    } catch {
      showError("De trainingslocaties konden niet worden geladen.");
      return [];
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

      const { data: slotData, error: slotError } = await supabase
        .from("availability_slots")
        .select(
          `
            id,
            starts_at,
            ends_at,
            sport,
            location_id,
            max_participants,
            price_cents,
            currency,
            status,
            venue:venues!availability_slots_location_id_fkey (
              id, name, address_line, postal_code, city, sports, court_environment
            )
          `
        )
        .eq("id", slotId)
        .eq("trainer_id", trainer.id)
        .eq("status", "available")
        .maybeSingle();

      if (slotError || !slotData) {
        showError("Dit slot bestaat niet, is niet meer beschikbaar of kan niet meer worden gewijzigd.");
        return;
      }

      const slot = slotData as unknown as Slot;
      const start = new Date(slot.starts_at);
      const end = new Date(slot.ends_at);

      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

      setOriginalSlot(slot);
      setDateValue(toDateInputValue(start));

      // Parse uur en minuut
      const sH = String(start.getHours()).padStart(2, "0");
      const sM = String(start.getMinutes()).padStart(2, "0");
      setSelectedHour(sH);
      setSelectedMinute(sM);

      setSelectedDuration(durationMinutes);
      setSelectedSport(slot.sport);
      setMaxParticipants(slot.max_participants);
      setPrice((slot.price_cents / 100).toFixed(2));

      await loadVenues(slot.sport, slot.location_id);
    } catch {
      showError("Dit slot kon niet worden geladen. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSportChange(sport: Sport): Promise<void> {
    clearMessages();
    if (sport === selectedSport) return;

    setSelectedSport(sport);
    setSelectedVenueId("");
    setVenueSearch("");
    setVenuePickerOpen(false);

    await loadVenues(sport);
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

    if (!originalSlot || originalSlot.status !== "available") {
      showError("Dit slot is niet meer beschikbaar.");
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

    if (startDateTime <= new Date()) {
      showError("Kies een tijdslot in de toekomst.");
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
      const { data, error } = await supabase
        .from("availability_slots")
        .update({
          starts_at: startDateTime.toISOString(),
          ends_at: endDateTime.toISOString(),
          sport: selectedSport,
          location_id: selectedVenueId,
          max_participants: maxParticipants,
          price_cents: priceCents,
          currency: "eur",
        })
        .eq("id", originalSlot.id)
        .eq("trainer_id", trainerAccount.id)
        .eq("status", "available")
        .select("id")
        .maybeSingle();

      if (error) {
        showError("Je wijzigingen konden niet worden opgeslagen.");
        return;
      }

      if (!data) {
        showError("Dit slot is ondertussen gewijzigd of geboekt.");
        return;
      }

      setOriginalSlot((currentSlot) =>
        currentSlot
          ? {
              ...currentSlot,
              starts_at: startDateTime.toISOString(),
              ends_at: endDateTime.toISOString(),
              sport: selectedSport,
              location_id: selectedVenueId,
              max_participants: maxParticipants,
              price_cents: priceCents,
              venue: selectedVenue,
            }
          : currentSlot
      );

      setSuccessMessage(
        `${formatDate(startDateTime)} · ${formatTime(
          startDateTime
        )} – ${formatTime(endDateTime)} is aangepast.`
      );
    } catch {
      showError("Je wijzigingen konden niet worden opgeslagen.");
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
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">SLOT LADEN...</p>
        </div>
      </main>
    );
  }

  if (!originalSlot && !errorMessage) {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <section className="flex flex-1 items-center justify-center px-5">
          <div className="max-w-xl border-2 border-[#FF4B3E] bg-[#FF4B3E] p-6 text-white">
            <p className="font-display text-3xl">SLOT NIET GEVONDEN.</p>
            <p className="mt-3 leading-relaxed text-white/90">Dit slot bestaat niet of kan niet meer worden gewijzigd.</p>
            <Link href="/trainer-slots" className="mt-6 inline-flex bg-[#14171A] px-5 py-3 font-display text-base !text-white hover:bg-white hover:!text-[#14171A]">
              ← TERUG NAAR MIJN SLOTS
            </Link>
          </div>
        </section>
        <SiteFooter />
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
          EDIT
        </div>

        <div className="relative mx-auto max-w-4xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">BESCHIKBAARHEID</p>
              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                WIJZIG<br />TIJDSLOT.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Pas dit beschikbare moment aan. Zodra een speler boekt, kan het slot niet meer worden gewijzigd.
              </p>
            </div>

            <Link
              href="/trainer-slots"
              className="inline-flex shrink-0 border-2 border-white px-4 py-2.5 font-display text-xs text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
            >
              ← MIJN SLOTS
            </Link>
          </div>

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
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-6 !text-[#14171A] outline-none shadow-[8px_8px_0_0_#FF4B3E]"
            >
              <p className="font-display text-3xl">SLOT AANGEPAST.</p>
              <p className="mt-3 font-semibold leading-relaxed">{successMessage}</p>

              <div className="mt-6">
                <Link
                  href="/trainer-slots"
                  className="inline-flex items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base !text-white hover:bg-white hover:!text-[#14171A]"
                >
                  TERUG NAAR MIJN SLOTS →
                </Link>
              </div>
            </div>
          )}

          <form onSubmit={handleSave} className="mt-8">
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-5 text-white sm:p-8">
                <p className="font-display text-xl text-[#D6FF3F]">PAS JE MOMENT AAN.</p>

                {/* Sport */}
                <fieldset className="mt-8">
                  <legend className="font-display text-base text-[#FF4B3E]">SPORT</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["padel", "tennis"] as Sport[]).map((sport) => (
                      <button
                        key={sport}
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSportChange(sport)}
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

                {/* Datum en Custom Kwartier Tijdprikker */}
                <div className="mt-8 grid gap-6 sm:grid-cols-2 sm:items-start">
                  
                  {/* DATUM VELD */}
                  <div>
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
                      className="h-[52px] w-full border-2 border-white/25 bg-transparent px-4 font-display text-base text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F]"
                    />
                  </div>

                  {/* 💡 CUSTOM KWARTIER TIJDPRIKER */}
                  <div>
                    <label className="mb-2 block font-display text-base text-[#FF4B3E]">
                      STARTTIJD (PER KWARTIER)
                    </label>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={selectedHour}
                        disabled={saving}
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
                            disabled={saving}
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
                    Gekozen starttijd: <span className="font-display text-sm text-[#D6FF3F]">{selectedHour}:{selectedMinute} UUR</span>
                  </p>

                </div>

                {/* Duur */}
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

                {/* Locatie */}
                <div className="mt-8">
                  <label htmlFor="venue-search" className="mb-2 block font-display text-base text-[#FF4B3E]">
                    TRAININGSLOCATIE
                  </label>

                  <div className="relative">
                    <input
                      id="venue-search"
                      type="search"
                      value={venueSearch}
                      disabled={venuesLoading || saving}
                      placeholder={venuesLoading ? "Locaties laden..." : "Zoek op stad of clubnaam..."}
                      onFocus={() => { if (!venuesLoading && !saving) setVenuePickerOpen(true); }}
                      onChange={(e) => handleVenueSearchChange(e.target.value)}
                      className="w-full border-2 border-white/25 bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F]"
                    />

                    {venuePickerOpen && !venuesLoading && !saving && (
                      <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto border-2 border-[#D6FF3F] bg-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                        {filteredVenues.map((venue) => (
                          <button
                            key={venue.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleVenueSelect(venue)}
                            className="block w-full border-b border-white/15 px-5 py-4 text-left transition last:border-b-0 hover:bg-[#D6FF3F] hover:text-[#14171A]"
                          >
                            <span className="block font-display text-base">{getVenueLabel(venue)}</span>
                            <span className="mt-1 block text-xs opacity-75">{venue.address_line}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedVenue && (
                    <div className="mt-4 border-l-2 border-[#D6FF3F] bg-white/5 p-4">
                      <p className="font-display text-base">{getVenueLabel(selectedVenue)}</p>
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

                  <div className="flex border-2 border-white/25 focus-within:border-[#D6FF3F]">
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
                      className="w-full bg-transparent px-4 py-4 text-white outline-none"
                    />
                  </div>
                </div>

                {/* Controle */}
                <div className="mt-10 border-2 border-white/25 bg-white/5">
                  <div className="flex items-center justify-between border-b-2 border-white/15 px-5 py-4 sm:px-6">
                    <div>
                      <p className="font-display text-sm text-[#D6FF3F]">CONTROLEER JE WIJZIGING</p>
                      <p className="mt-1 text-sm text-[#B9BEC2]">Dit zien spelers voordat ze boeken.</p>
                    </div>
                    <span className="font-display text-sm text-[#FF4B3E]">PREVIEW</span>
                  </div>

                  {startDateTime && endDateTime ? (
                    <div className="p-5 sm:p-6">
                      <div className="flex flex-col gap-4 border-b-2 border-white/15 pb-5 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="font-display text-xl text-white sm:text-2xl">
                            {formatPreviewDate(startDateTime)}
                          </p>
                          <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-[#8A8F94]">
                            {selectedSport}training
                          </p>
                        </div>

                        <p className="font-display text-4xl leading-none text-[#D6FF3F] sm:text-5xl">
                          {formatTime(startDateTime)}
                          <span className="mx-2 text-white/35">–</span>
                          {formatTime(endDateTime)}
                        </p>
                      </div>

                      <div className="grid gap-4 border-b-2 border-white/15 py-5 sm:grid-cols-3">
                        <div>
                          <p className="font-display text-xs text-[#8A8F94]">DUUR</p>
                          <p className="mt-2 font-display text-xl text-white">{selectedDuration} MIN</p>
                        </div>

                        <div>
                          <p className="font-display text-xs text-[#8A8F94]">GROEP</p>
                          <p className="mt-2 font-display text-xl text-white">MAX. {maxParticipants}</p>
                        </div>

                        <div>
                          <p className="font-display text-xs text-[#8A8F94]">TOTAALPRIJS</p>
                          <p className="mt-2 font-display text-xl text-[#D6FF3F]">{formattedPrice}</p>
                        </div>
                      </div>

                      <div className="pt-5">
                        <p className="font-display text-xs text-[#8A8F94]">LOCATIE</p>
                        {selectedVenue && (
                          <p className="mt-2 font-display text-lg text-white">{getVenueLabel(selectedVenue)}</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* SUBMIT BUTTON */}
                <button
                  type="submit"
                  disabled={saving || !trainerIsActive || venuesLoading || !originalSlot}
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