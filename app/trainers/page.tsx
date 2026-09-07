"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type SportFilter = "all" | "Padel" | "Tennis" | "Padel & Tennis";
type SortOption = "slots_desc" | "price_asc" | "price_desc";
type AvailabilityFilter = "all" | "available_only";
type DaypartFilter = "all" | "morning" | "afternoon" | "evening";

type Trainer = {
  id: string;
  initials: string;
  name: string;
  sport: string;
  focus: string;
  bio: string | null;
  city: string | null;
  province: string | null;
  radius_km: number | null;
  price_per_hour: number;
  image_url: string | null;
  available_slots_count?: number;
  available_slots?: string[];
};

type AvailabilitySlot = {
  trainer_id: string;
  starts_at: string;
};

const sportFilters: { label: string; value: SportFilter }[] = [
  { label: "ALLE TRAINERS", value: "all" },
  { label: "PADEL", value: "Padel" },
  { label: "TENNIS", value: "Tennis" },
  { label: "PADEL & TENNIS", value: "Padel & Tennis" },
];

const daypartOptions: { label: string; value: DaypartFilter }[] = [
  { label: "ALLE DAGDELEN", value: "all" },
  { label: "OCHTEND · 08:00 - 12:00", value: "morning" },
  { label: "MIDDAG · 12:00 - 17:00", value: "afternoon" },
  { label: "AVOND · 17:00 - 23:00", value: "evening" },
];

function formatPrice(price: number): string {
  return `€${Number(price).toFixed(0)}`;
}

function getTrainerLocation(trainer: Trainer): string {
  if (trainer.city && trainer.province) {
    return `${trainer.city} · ${trainer.province}`;
  }

  if (trainer.city) return trainer.city;
  if (trainer.province) return trainer.province;

  return "Locatie volgt";
}

function getTrainerInitials(trainer: Trainer): string {
  if (trainer.initials?.trim()) {
    return trainer.initials.trim().toUpperCase();
  }

  const nameParts = trainer.name.trim().split(" ").filter(Boolean);

  if (nameParts.length === 0) return "GT";
  if (nameParts.length === 1) return nameParts[0].slice(0, 2).toUpperCase();

  return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
}

/**
 * Haalt datum en tijd op in Nederlandse tijd.
 * Dit voorkomt verschillen wanneer een gebruiker bijvoorbeeld
 * vanuit een andere tijdzone de website opent.
 */
function getAmsterdamSlotData(isoDate: string): {
  date: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoDate));

  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = Number(getPart("hour"));
  const minute = Number(getPart("minute"));

  return {
    date: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute,
  };
}

function slotMatchesFilters(
  startsAt: string,
  startDate: string,
  endDate: string,
  daypart: DaypartFilter
): boolean {
  const { date, minutes } = getAmsterdamSlotData(startsAt);

  // Datums zijn inclusief: van 2026-09-10 t/m 2026-09-15.
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;

  if (daypart === "morning") {
    return minutes >= 8 * 60 && minutes < 12 * 60;
  }

  if (daypart === "afternoon") {
    return minutes >= 12 * 60 && minutes < 17 * 60;
  }

  if (daypart === "evening") {
    return minutes >= 17 * 60 && minutes < 23 * 60;
  }

  return true;
}

function TrainersContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [selectedSport, setSelectedSport] = useState<SportFilter>("all");

  const [selectedStartDate, setSelectedStartDate] = useState<string>("");
  const [selectedEndDate, setSelectedEndDate] = useState<string>("");
  const [selectedDaypart, setSelectedDaypart] =
    useState<DaypartFilter>("all");

  const [availabilityOnly, setAvailabilityOnly] =
    useState<AvailabilityFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("slots_desc");

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const hasAvailabilitySelection =
    selectedStartDate !== "" ||
    selectedEndDate !== "" ||
    selectedDaypart !== "all";

  const filteredAndSortedTrainers = useMemo((): Trainer[] => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase("nl-NL");

    const result = trainers.filter((trainer) => {
      const trainerSport = trainer.sport.trim();

      // 1. Sportfilter
      const matchesSport =
        selectedSport === "all" ||
        trainerSport === selectedSport ||
        (selectedSport === "Padel" && trainerSport === "Padel & Tennis") ||
        (selectedSport === "Tennis" && trainerSport === "Padel & Tennis");

      if (!matchesSport) return false;

      // 2. Alleen direct boekbaar
      if (
        availabilityOnly === "available_only" &&
        (trainer.available_slots_count ?? 0) === 0
      ) {
        return false;
      }

      // 3. Datumrange en dagdeel
      if (hasAvailabilitySelection) {
        const hasMatchingSlot = (trainer.available_slots ?? []).some((slot) =>
          slotMatchesFilters(
            slot,
            selectedStartDate,
            selectedEndDate,
            selectedDaypart
          )
        );

        if (!hasMatchingSlot) return false;
      }

      // 4. Zoekbalk
      if (!normalizedQuery) return true;

      const searchableText = [
        trainer.name,
        trainer.sport,
        trainer.focus,
        trainer.city ?? "",
        trainer.province ?? "",
        trainer.bio ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("nl-NL");

      return searchableText.includes(normalizedQuery);
    });

    return result.sort((a, b) => {
      if (sortBy === "price_asc") {
        return a.price_per_hour - b.price_per_hour;
      }

      if (sortBy === "price_desc") {
        return b.price_per_hour - a.price_per_hour;
      }

      const slotsDifference =
        (b.available_slots_count ?? 0) - (a.available_slots_count ?? 0);

      if (slotsDifference !== 0) return slotsDifference;

      return a.name.localeCompare(b.name, "nl-NL");
    });
  }, [
    trainers,
    searchQuery,
    selectedSport,
    selectedStartDate,
    selectedEndDate,
    selectedDaypart,
    availabilityOnly,
    sortBy,
    hasAvailabilitySelection,
  ]);

  async function loadTrainers(): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      // 1. Alle actieve, goedgekeurde trainers ophalen.
      // Rating is bewust niet meer opgenomen.
      const { data, error } = await supabase
        .from("trainers")
        .select(
          `
            id,
            initials,
            name,
            sport,
            focus,
            bio,
            city,
            province,
            radius_km,
            price_per_hour,
            image_url
          `
        )
        .eq("is_active", true)
        .eq("approval_status", "approved")
        .order("name", { ascending: true });

      if (error) {
        console.error("Trainers ophalen fout:", error.message);
        setErrorMessage("De trainers konden niet worden geladen.");
        setTrainers([]);
        return;
      }

      const loadedTrainers = (data ?? []) as Trainer[];
      const trainerIds = loadedTrainers.map((trainer) => trainer.id);

      if (trainerIds.length === 0) {
        setTrainers([]);
        return;
      }

      // Alleen slots ophalen die minimaal 2 uur in de toekomst liggen.
      const minBookingTime = new Date(
        Date.now() + 2 * 60 * 60 * 1000
      ).toISOString();

      const { data: slotData, error: slotError } = await supabase
        .from("availability_slots")
        .select("trainer_id, starts_at")
        .in("trainer_id", trainerIds)
        .eq("status", "available")
        .gte("starts_at", minBookingTime)
        .order("starts_at", { ascending: true });

      if (slotError) {
        console.error("Beschikbaarheid ophalen fout:", slotError.message);
        setErrorMessage("De beschikbaarheid van trainers kon niet worden geladen.");
        setTrainers([]);
        return;
      }

      const slotsMap = new Map<string, string[]>();

      ((slotData ?? []) as AvailabilitySlot[]).forEach((slot) => {
        if (!slotsMap.has(slot.trainer_id)) {
          slotsMap.set(slot.trainer_id, []);
        }

        slotsMap.get(slot.trainer_id)!.push(slot.starts_at);
      });

      const trainersWithAvailability = loadedTrainers.map((trainer) => {
        const slots = slotsMap.get(trainer.id) ?? [];

        return {
          ...trainer,
          available_slots_count: slots.length,
          available_slots: slots,
        };
      });

      setTrainers(trainersWithAvailability);
    } catch (error) {
      console.error("Onverwachte trainers-fout:", error);
      setErrorMessage("De trainers konden niet worden geladen.");
      setTrainers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTrainers();
  }, []);

  function resetFilters(): void {
    setSearchQuery("");
    setSelectedSport("all");
    setSelectedStartDate("");
    setSelectedEndDate("");
    setSelectedDaypart("all");
    setAvailabilityOnly("all");
  }

  function handleStartDateChange(value: string): void {
    setSelectedStartDate(value);

    // Zorg dat de einddatum niet voor de startdatum kan liggen.
    if (selectedEndDate && value && selectedEndDate < value) {
      setSelectedEndDate(value);
    }
  }

  function handleEndDateChange(value: string): void {
    setSelectedEndDate(value);

    // Zorg dat de startdatum niet na de einddatum kan liggen.
    if (selectedStartDate && value && value < selectedStartDate) {
      setSelectedStartDate(value);
    }
  }

  const hasActiveFilters =
    searchQuery !== "" ||
    selectedSport !== "all" ||
    selectedStartDate !== "" ||
    selectedEndDate !== "" ||
    selectedDaypart !== "all" ||
    availabilityOnly !== "all";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-8 sm:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 select-none font-display text-[17rem] leading-none text-[#D6FF3F] opacity-[0.03] sm:text-[26rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          {/* TITEL */}
          <div className="mb-6 border-b-2 border-white/20 pb-5">
            <p className="font-display text-base text-[#FF4B3E]">
              VIND JOUW PERFECTE MATCH
            </p>

            <h1 className="mt-1 font-display text-5xl leading-[0.85] text-white sm:text-6xl">
              VIND JE TRAINER.
              <br />
              BOEK DIRECT. GOW!
            </h1>

            <p className="mt-3 max-w-5xl text-sm text-[#D7D9DA] sm:text-base">
              Vergelijk padel- en tennistrainers in jouw buurt op specialisatie,
              uurtarief en live beschikbaarheid. Kies je periode, dagdeel en claim
              je tijdslot.
            </p>
          </div>

          {/* FILTERS */}
          <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-4 text-white sm:p-5">
              {/* ZOEKBALK */}
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex-1 border-2 border-white/25 bg-[#14171A] transition focus-within:border-[#D6FF3F]">
                  <div className="flex items-center">
                    <span className="px-3 text-lg text-[#D6FF3F]">⌕</span>

                    <input
                      id="trainer-search"
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Zoek op stad, naam of specialisatie..."
                      className="w-full bg-transparent py-3 pr-4 text-sm text-white outline-none placeholder:text-[#8A8F94]"
                    />
                  </div>
                </div>
              </div>

              {/* SPORTFILTERS */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/15 pt-3">
                <span className="mr-1 font-display text-xs text-[#D6FF3F]">
                  SPORT:
                </span>

                {sportFilters.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setSelectedSport(filter.value)}
                    className={`shrink-0 border px-3 py-1.5 font-display text-xs transition ${
                      selectedSport === filter.value
                        ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                        : "border-white/30 text-white hover:border-white"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {/* DATUMRANGE, DAGDEEL, STATUS EN SORTERING */}
              <div className="mt-3 grid gap-3 border-t border-white/15 pt-3 md:grid-cols-2 xl:grid-cols-5">
                {/* VAN DATUM */}
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="start-date"
                    className="shrink-0 font-display text-xs text-[#D6FF3F]"
                  >
                    VAN:
                  </label>

                  <input
                    id="start-date"
                    type="date"
                    value={selectedStartDate}
                    max={selectedEndDate || undefined}
                    onChange={(event) =>
                      handleStartDateChange(event.target.value)
                    }
                    className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none transition focus:border-[#D6FF3F] [color-scheme:dark]"
                  />
                </div>

                {/* TOT DATUM */}
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="end-date"
                    className="shrink-0 font-display text-xs text-[#D6FF3F]"
                  >
                    TOT:
                  </label>

                  <input
                    id="end-date"
                    type="date"
                    value={selectedEndDate}
                    min={selectedStartDate || undefined}
                    onChange={(event) => handleEndDateChange(event.target.value)}
                    className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none transition focus:border-[#D6FF3F] [color-scheme:dark]"
                  />
                </div>

                {/* DAGDEEL */}
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="daypart"
                    className="shrink-0 font-display text-xs text-[#D6FF3F]"
                  >
                    DAGDEEL:
                  </label>

                  <select
                    id="daypart"
                    value={selectedDaypart}
                    onChange={(event) =>
                      setSelectedDaypart(event.target.value as DaypartFilter)
                    }
                    className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F]"
                  >
                    {daypartOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* BESCHIKBAARHEID */}
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-display text-xs text-[#D6FF3F]">
                    STATUS:
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setAvailabilityOnly(
                        availabilityOnly === "all" ? "available_only" : "all"
                      )
                    }
                    className={`w-full border px-3 py-1.5 text-center font-display text-xs transition ${
                      availabilityOnly === "available_only"
                        ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                        : "border-white/30 text-white hover:border-white"
                    }`}
                  >
                    {availabilityOnly === "available_only"
                      ? "✓ DIRECT BOEKBAAR"
                      : "ALLE TRAINERS"}
                  </button>
                </div>

                {/* SORTERING */}
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="sort"
                    className="shrink-0 font-display text-xs text-[#8A8F94]"
                  >
                    SORTEER:
                  </label>

                  <select
                    id="sort"
                    value={sortBy}
                    onChange={(event) =>
                      setSortBy(event.target.value as SortOption)
                    }
                    className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F]"
                  >
                    <option value="slots_desc">
                      MEESTE BESCHIKBARE UREN
                    </option>
                    <option value="price_asc">PRIJS: LAAG → HOOG</option>
                    <option value="price_desc">PRIJS: HOOG → LAAG</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* COUNTER */}
          {!loading && (
            <div className="mt-6 flex items-center justify-between border-b-2 border-white/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="font-display text-2xl text-[#D6FF3F]">
                  {filteredAndSortedTrainers.length}
                </span>

                <p className="font-display text-sm tracking-wider text-white">
                  {filteredAndSortedTrainers.length === 1
                    ? "TRAINER GEVONDEN"
                    : "TRAINERS GEVONDEN"}
                </p>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="font-display text-xs text-[#D6FF3F] transition hover:text-white"
                >
                  × WIS FILTERS
                </button>
              )}
            </div>
          )}

          {/* LADEN */}
          {loading && (
            <div className="flex min-h-80 flex-col items-center justify-center">
              <div className="flex items-center gap-2">
                <span className="font-display text-5xl text-[#D6FF3F]">
                  GOWTRAIN
                </span>

                <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
              </div>

              <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
                TRAINERS LADEN...
              </p>
            </div>
          )}

          {/* FOUTMELDING */}
          {!loading && errorMessage && (
            <div
              role="alert"
              className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <p>{errorMessage}</p>

                <button
                  type="button"
                  onClick={() => void loadTrainers()}
                  className="shrink-0 border-2 border-white px-4 py-2 font-display text-sm text-white transition hover:bg-white hover:text-[#14171A]"
                >
                  OPNIEUW PROBEREN
                </button>
              </div>
            </div>
          )}

          {/* GEEN RESULTATEN */}
          {!loading &&
            !errorMessage &&
            filteredAndSortedTrainers.length === 0 && (
              <section className="mt-6 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
                <div className="bg-[#14171A] p-6 text-white sm:p-8">
                  <p className="font-display text-4xl text-[#D6FF3F]">
                    NOG GEEN MATCH.
                  </p>

                  <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#B9BEC2]">
                    We vonden geen trainer met beschikbaarheid in deze periode of
                    dit dagdeel. Pas je filters aan en probeer opnieuw.
                  </p>

                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-7 bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                  >
                    BEKIJK ALLE TRAINERS →
                  </button>
                </div>
              </section>
            )}

          {/* TRAINERKAARTEN */}
          {!loading &&
            !errorMessage &&
            filteredAndSortedTrainers.length > 0 && (
              <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {filteredAndSortedTrainers.map((trainer) => {
                  const matchingSlots = (trainer.available_slots ?? []).filter(
                    (slot) =>
                      slotMatchesFilters(
                        slot,
                        selectedStartDate,
                        selectedEndDate,
                        selectedDaypart
                      )
                  );

                  const availableSlotsToShow = hasAvailabilitySelection
                    ? matchingSlots.length
                    : trainer.available_slots_count ?? 0;

                  return (
                    <article
                      key={trainer.id}
                      className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-2 hover:shadow-[10px_10px_0_0_#FF4B3E]"
                    >
                      <div className="flex h-full flex-col justify-between bg-[#14171A] p-5 text-white">
                        <div>
                          {/* AVATAR, NAAM EN SPORT */}
                          <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A]">
                              {trainer.image_url ? (
                                <img
                                  src={trainer.image_url}
                                  alt={`Profielfoto van ${trainer.name}`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="font-display text-xl text-[#D6FF3F]">
                                  {getTrainerInitials(trainer)}
                                </span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="truncate font-display text-2xl leading-none">
                                {trainer.name}
                              </p>

                              <p className="mt-1 text-xs text-[#B9BEC2]">
                                {trainer.sport}
                              </p>
                            </div>
                          </div>

                          {/* LOCATIE EN BESCHIKBAARHEID */}
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className="max-w-[220px] truncate bg-[#2A2E31] px-2.5 py-1 font-display text-xs text-white">
                              {getTrainerLocation(trainer)}
                            </span>

                            {availableSlotsToShow > 0 ? (
                              <span className="bg-[#FF4B3E] px-2.5 py-1 font-display text-xs text-white">
                                {hasAvailabilitySelection
                                  ? `${availableSlotsToShow} UUR VRIJ IN SELECTIE`
                                  : `${availableSlotsToShow} UUR DIRECT BOEKBAAR`}
                              </span>
                            ) : (
                              <span className="border border-white/15 px-2.5 py-1 font-display text-xs text-[#8A8F94]">
                                OP AANVRAAG
                              </span>
                            )}
                          </div>

                          {/* SPECIALISATIE */}
                          <div className="mt-5">
                            <p className="font-display text-[10px] uppercase tracking-wider text-[#FF4B3E]">
                              SPECIALISATIE
                            </p>

                            <p className="mt-1 truncate font-display text-2xl text-[#D6FF3F]">
                              {trainer.focus}
                            </p>
                          </div>

                          {/* BIO */}
                          <p className="mt-3 line-clamp-3 overflow-hidden text-xs leading-relaxed text-[#B9BEC2]">
                            {trainer.bio
                              ? trainer.bio
                              : "Bekijk het profiel en de live beschikbaarheid van deze trainer op GowTrain."}
                          </p>
                        </div>

                        {/* PRIJS EN CTA */}
                        <div className="mt-6 border-t border-white/20 pt-4">
                          <div className="flex items-end justify-between">
                            <div>
                              <span className="block font-display text-[10px] tracking-wider text-[#8A8F94]">
                                PRIJS PER UUR
                              </span>

                              <span className="font-display text-4xl text-[#D6FF3F]">
                                {formatPrice(trainer.price_per_hour)}
                              </span>
                            </div>

                            <Link
                              href={`/trainers/${trainer.id}`}
                              className="flex items-center justify-center gap-2 bg-[#FF4B3E] px-6 py-3.5 font-display text-xl text-white transition group-hover:bg-[#D6FF3F] group-hover:!text-[#14171A]"
                            >
                              GOW! →
                            </Link>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function TrainersFallback() {
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
          TRAINERS LADEN...
        </p>
      </div>
    </main>
  );
}

export default function TrainersPage() {
  return (
    <Suspense fallback={<TrainersFallback />}>
      <TrainersContent />
    </Suspense>
  );
}