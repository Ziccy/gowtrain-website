"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type ViewTab = "lessons" | "trainers";
type SportFilter = "all" | "Padel" | "Tennis" | "Padel & Tennis";
type OfferTypeFilter = "all" | "slots" | "packages";
type SortOption = "time_asc" | "price_asc" | "price_desc";
type DaypartFilter = "all" | "morning" | "afternoon" | "evening";

type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address_line: string;
};

type TrainerSummary = {
  id: string;
  initials: string;
  name: string;
  sport: string;
  focus: string;
  image_url: string | null;
};

type LessonOffer = {
  id: string;
  type: "slot" | "package";
  starts_at: string;
  ends_at?: string;
  sport: "padel" | "tennis";
  title?: string;
  lesson_count?: number;
  duration_minutes: number;
  price_cents: number;
  currency: string;
  trainer: TrainerSummary | null;
  venue: VenueSummary | null;
};

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

const sportFilters: { label: string; value: SportFilter }[] = [
  { label: "ALLES", value: "all" },
  { label: "PADEL", value: "Padel" },
  { label: "TENNIS", value: "Tennis" },
];

const daypartOptions: { label: string; value: DaypartFilter }[] = [
  { label: "ALLE DAGDELEN", value: "all" },
  { label: "OCHTEND · 08:00 - 12:00", value: "morning" },
  { label: "MIDDAG · 12:00 - 17:00", value: "afternoon" },
  { label: "AVOND · 17:00 - 23:00", value: "evening" },
];

function formatPriceCents(cents: number): string {
  return `€${(cents / 100).toFixed(0)}`;
}

function formatPricePerHour(price: number): string {
  return `€${Number(price).toFixed(0)}`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(value))
    .replace(".", "")
    .toUpperCase();
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getTrainerInitials(name: string, initials?: string): string {
  if (initials?.trim()) return initials.trim().toUpperCase();
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "GT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getAmsterdamSlotData(isoDate: string): { date: string; minutes: number } {
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

  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;

  if (daypart === "morning") return minutes >= 8 * 60 && minutes < 12 * 60;
  if (daypart === "afternoon") return minutes >= 12 * 60 && minutes < 17 * 60;
  if (daypart === "evening") return minutes >= 17 * 60 && minutes < 23 * 60;

  return true;
}

function TrainersContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [activeTab, setActiveTab] = useState<ViewTab>("lessons");

  const [lessons, setLessons] = useState<LessonOffer[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);

  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [selectedSport, setSelectedSport] = useState<SportFilter>("all");
  const [offerTypeFilter, setOfferTypeFilter] = useState<OfferTypeFilter>("all");

  const [selectedStartDate, setSelectedStartDate] = useState<string>("");
  const [selectedEndDate, setSelectedEndDate] = useState<string>("");
  const [selectedDaypart, setSelectedDaypart] = useState<DaypartFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("time_asc");

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    void loadAllData();
  }, []);

  async function loadAllData(): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      const minBookingTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

      // 1. HAAL ALLE ACTIEVE TRAINERS OP
      const { data: trainerData, error: trainerError } = await supabase
        .from("trainers")
        .select("id, initials, name, sport, focus, bio, city, province, radius_km, price_per_hour, image_url")
        .eq("is_active", true)
        .eq("approval_status", "approved")
        .order("name", { ascending: true });

      if (trainerError) {
        setErrorMessage("De trainers konden niet worden geladen.");
        setLoading(false);
        return;
      }

      const loadedTrainers = (trainerData ?? []) as Trainer[];
      const trainerIds = loadedTrainers.map((t) => t.id);

      // 2. HAAL LOSSE TIJDSLOTEN OP
      let fetchedSlots: LessonOffer[] = [];
      if (trainerIds.length > 0) {
        const { data: slotData } = await supabase
          .from("availability_slots")
          .select(
            `
              id,
              starts_at,
              ends_at,
              sport,
              price_cents,
              currency,
              trainer:trainers!inner ( id, initials, name, sport, focus, image_url ),
              venue:venues!availability_slots_location_id_fkey ( id, name, city, address_line )
            `
          )
          .in("trainer_id", trainerIds)
          .eq("status", "available")
          .gte("starts_at", minBookingTime)
          .order("starts_at", { ascending: true });

        if (slotData) {
          fetchedSlots = slotData.map((s: any) => {
            const start = new Date(s.starts_at).getTime();
            const end = new Date(s.ends_at).getTime();
            return {
              id: s.id,
              type: "slot",
              starts_at: s.starts_at,
              ends_at: s.ends_at,
              sport: s.sport,
              duration_minutes: Math.round((end - start) / 60000),
              price_cents: s.price_cents,
              currency: s.currency,
              trainer: s.trainer,
              venue: s.venue,
            };
          });
        }
      }

      // 3. HAAL LESPAKKETTEN OP
      let fetchedPackages: LessonOffer[] = [];
      if (trainerIds.length > 0) {
        const { data: pkgData } = await supabase
          .from("trainer_packages")
          .select(
            `
              id,
              title,
              sport,
              lesson_count,
              duration_minutes,
              starts_at,
              price_cents,
              currency,
              trainer:trainers!inner ( id, initials, name, sport, focus, image_url ),
              venue:venues!trainer_packages_location_id_fkey ( id, name, city, address_line )
            `
          )
          .in("trainer_id", trainerIds)
          .eq("is_active", true)
          .gte("starts_at", minBookingTime)
          .order("starts_at", { ascending: true });

        if (pkgData) {
          fetchedPackages = pkgData.map((p: any) => ({
            id: p.id,
            type: "package",
            starts_at: p.starts_at,
            sport: p.sport,
            title: p.title,
            lesson_count: p.lesson_count,
            duration_minutes: p.duration_minutes,
            price_cents: p.price_cents,
            currency: p.currency,
            trainer: p.trainer,
            venue: p.venue,
          }));
        }
      }

      const combinedLessons = [...fetchedSlots, ...fetchedPackages].sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );

      setLessons(combinedLessons);

      const slotsCountMap = new Map<string, number>();
      fetchedSlots.forEach((s) => {
        if (s.trainer?.id) {
          slotsCountMap.set(s.trainer.id, (slotsCountMap.get(s.trainer.id) || 0) + 1);
        }
      });

      const trainersWithCount = loadedTrainers.map((t) => ({
        ...t,
        available_slots_count: slotsCountMap.get(t.id) || 0,
      }));

      setTrainers(trainersWithCount);
    } catch {
      setErrorMessage("De gegevens konden niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  // GEFILTERD LESAANBOD
  const filteredLessons = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const result = lessons.filter((item) => {
      if (offerTypeFilter === "slots" && item.type !== "slot") return false;
      if (offerTypeFilter === "packages" && item.type !== "package") return false;

      if (
        selectedSport !== "all" &&
        item.sport.toLowerCase() !== selectedSport.toLowerCase()
      ) {
        return false;
      }

      if (
        !slotMatchesFilters(
          item.starts_at,
          selectedStartDate,
          selectedEndDate,
          selectedDaypart
        )
      ) {
        return false;
      }

      if (!query) return true;

      const searchable = [
        item.trainer?.name ?? "",
        item.trainer?.focus ?? "",
        item.venue?.name ?? "",
        item.venue?.city ?? "",
        item.title ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });

    return result.sort((a, b) => {
      if (sortBy === "price_asc") return a.price_cents - b.price_cents;
      if (sortBy === "price_desc") return b.price_cents - a.price_cents;
      return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    });
  }, [lessons, searchQuery, selectedSport, offerTypeFilter, selectedStartDate, selectedEndDate, selectedDaypart, sortBy]);

  // GEFILTERDE TRAINERS
  const filteredTrainers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return trainers.filter((t) => {
      if (
        selectedSport !== "all" &&
        t.sport.toLowerCase() !== selectedSport.toLowerCase() &&
        t.sport !== "Padel & Tennis"
      ) {
        return false;
      }

      if (!query) return true;

      const searchable = [t.name, t.sport, t.focus, t.city ?? "", t.province ?? ""]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [trainers, searchQuery, selectedSport]);

  const hasActiveFilters = useMemo(() => {
    return (
      searchQuery !== "" ||
      selectedSport !== "all" ||
      offerTypeFilter !== "all" ||
      selectedStartDate !== "" ||
      selectedEndDate !== "" ||
      selectedDaypart !== "all"
    );
  }, [searchQuery, selectedSport, offerTypeFilter, selectedStartDate, selectedEndDate, selectedDaypart]);

  function resetFilters(): void {
    setSearchQuery("");
    setSelectedSport("all");
    setOfferTypeFilter("all");
    setSelectedStartDate("");
    setSelectedEndDate("");
    setSelectedDaypart("all");
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-8 sm:py-10">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          {/* BANNER KOP */}
          <div className="mb-6 border-b-2 border-white/20 pb-5">
            <p className="font-display text-base text-[#FF4B3E]">VIND JOUW PERFECTE MATCH</p>
            <h1 className="mt-1 font-display text-5xl leading-[0.85] text-white sm:text-6xl lg:text-7xl">
              LESAANBOD &amp; TRAINERS.
            </h1>
            <p className="mt-3 max-w-4xl text-sm text-[#D7D9DA] sm:text-base">
              Kies direct uit beschikbare tijdsloten en complete trajecten in jouw buurt, of vergelijk alle trainers.
            </p>
          </div>

          {/* TAB SWITCHER */}
          <div className="mb-6 flex gap-3 border-b-2 border-white/20 pb-4">
            <button
              type="button"
              onClick={() => setActiveTab("lessons")}
              className={`border-2 px-6 py-3 font-display text-lg sm:text-xl transition ${
                activeTab === "lessons"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              LESAANBOD ({filteredLessons.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("trainers")}
              className={`border-2 px-6 py-3 font-display text-lg sm:text-xl transition ${
                activeTab === "trainers"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              ONZE TRAINERS ({filteredTrainers.length})
            </button>
          </div>

          {/* FILTERS BALK */}
          <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-4 text-white sm:p-5 space-y-4">
              
              {/* ZOEKBALK */}
              <div className="border-2 border-white/25 bg-[#14171A] transition focus-within:border-[#D6FF3F]">
                <div className="flex items-center">
                  <span className="px-3 text-lg text-[#D6FF3F]">⌕</span>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Zoek op stad, clubnaam, trainer of specialisatie..."
                    className="w-full bg-transparent py-3 pr-4 text-sm text-white outline-none placeholder:text-[#8A8F94]"
                  />
                </div>
              </div>

              {/* SPORT & LESVORM FILTERS */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-white/15 pt-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {/* SPORT */}
                  <div className="flex flex-wrap items-center gap-2 sm:border-r sm:border-white/20 sm:pr-4">
                    <span className="mr-1 font-display text-xs text-[#D6FF3F]">SPORT:</span>
                    {sportFilters.map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() => setSelectedSport(filter.value)}
                        className={`border px-3 py-1.5 font-display text-xs transition ${
                          selectedSport === filter.value
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>

                  {/* LESVORM FILTER */}
                  {activeTab === "lessons" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mr-1 font-display text-xs text-[#D6FF3F]">LESVORM:</span>
                      {(
                        [
                          ["ALLE LESVORMEN", "all"],
                          ["LOSSE LESSEN", "slots"],
                          ["LESPAKKETTEN / TRAJECTEN", "packages"],
                        ] as [string, OfferTypeFilter][]
                      ).map(([label, val]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setOfferTypeFilter(val)}
                          className={`border px-3 py-1.5 font-display text-xs transition ${
                            offerTypeFilter === val
                              ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                              : "border-white/30 text-white hover:border-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 💡 WIS FILTERS KNOP RECHTSBOVEN IN FILTERBALK */}
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="font-display text-xs text-[#D6FF3F] hover:text-white transition cursor-pointer self-start sm:self-center"
                  >
                    × WIS FILTERS
                  </button>
                )}
              </div>

              {/* DATUMRANGE, DAGDEEL & SORTERING (ALLEEN BIJ LESAANBOD TAB) */}
              {activeTab === "lessons" && (
                <div className="grid gap-3 border-t border-white/15 pt-3 md:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-center gap-2">
                    <label htmlFor="start-date" className="shrink-0 font-display text-xs text-[#D6FF3F]">VAN:</label>
                    <input
                      id="start-date"
                      type="date"
                      value={selectedStartDate}
                      max={selectedEndDate || undefined}
                      onChange={(e) => setSelectedStartDate(e.target.value)}
                      className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F] [color-scheme:dark]"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="end-date" className="shrink-0 font-display text-xs text-[#D6FF3F]">TOT:</label>
                    <input
                      id="end-date"
                      type="date"
                      value={selectedEndDate}
                      min={selectedStartDate || undefined}
                      onChange={(e) => setSelectedEndDate(e.target.value)}
                      className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F] [color-scheme:dark]"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="daypart" className="shrink-0 font-display text-xs text-[#D6FF3F]">DAGDEEL:</label>
                    <select
                      id="daypart"
                      value={selectedDaypart}
                      onChange={(e) => setSelectedDaypart(e.target.value as DaypartFilter)}
                      className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F]"
                    >
                      {daypartOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="sort" className="shrink-0 font-display text-xs text-[#8A8F94]">SORTEER:</label>
                    <select
                      id="sort"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                      className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F]"
                    >
                      <option value="time_asc">EERSTVOLGENDE EERST</option>
                      <option value="price_asc">PRIJS: LAAG → HOOG</option>
                      <option value="price_desc">PRIJS: HOOG → LAAG</option>
                    </select>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* TELLER BAR MET EVENENEENS WIS FILTERS KNOP */}
          {!loading && (
            <div className="mt-6 flex items-center justify-between border-b-2 border-white/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="font-display text-2xl text-[#D6FF3F]">
                  {activeTab === "lessons" ? filteredLessons.length : filteredTrainers.length}
                </span>

                <p className="font-display text-sm tracking-wider text-white">
                  {activeTab === "lessons"
                    ? filteredLessons.length === 1 ? "LES GEVONDEN" : "LESSEN GEVONDEN"
                    : filteredTrainers.length === 1 ? "TRAINER GEVONDEN" : "TRAINERS GEVONDEN"}
                </p>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="font-display text-xs text-[#D6FF3F] hover:text-white transition cursor-pointer"
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
                <span className="font-display text-5xl text-[#D6FF3F]">GOWTRAIN</span>
                <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
              </div>
              <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">AANBOD LADEN...</p>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {/* TAB 1: LESAANBOD (LOSSE SLOTS & TRAJECTEN) */}
          {!loading && !errorMessage && activeTab === "lessons" && (
            <div className="mt-8">
              {filteredLessons.length === 0 ? (
                <section className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
                  <div className="bg-[#14171A] p-6 text-white sm:p-8">
                    <p className="font-display text-4xl text-[#D6FF3F]">GEEN BLAUWE OF GELE KAARTEN GEVONDEN.</p>
                    <p className="mt-3 text-base text-[#B9BEC2]">
                      Geen beschikbare lessen gevonden binnen de gekozen periode, lesvorm of sport. Pas je filters aan.
                    </p>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="mt-6 bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    >
                      × WIS FILTERS &amp; HERLAAD →
                    </button>
                  </div>
                </section>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {filteredLessons.map((item) => {
                    const isPackage = item.type === "package";
                    const bookingUrl = isPackage
                      ? `/boeken/pakket/${item.id}`
                      : `/boeken/${item.trainer?.id}?slot=${item.id}`;

                    return (
                      <article
                        key={item.id}
                        className={`group border-2 bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 ${
                          isPackage
                            ? "border-[#D6FF3F] shadow-[6px_6px_0_0_#D6FF3F]"
                            : "border-white shadow-[6px_6px_0_0_#FF4B3E]"
                        }`}
                      >
                        <div className="bg-[#14171A] p-5 text-white flex flex-col justify-between h-full space-y-4">
                          
                          <div>
                            {/* BADGE: SPORT + LES VORM */}
                            <div className="flex justify-between items-start gap-2">
                              <span className="bg-[#FF4B3E] px-2.5 py-1 font-display text-[10px] text-white uppercase">
                                {item.sport.toUpperCase()} · {isPackage ? `${item.lesson_count} LESSEN TRAJECT` : "LOSSE LES"}
                              </span>

                              <span className="font-display text-2xl text-[#D6FF3F]">
                                {formatPriceCents(item.price_cents)}
                              </span>
                            </div>

                            {/* TITEL / DATUM */}
                            <div className="mt-4">
                              {isPackage ? (
                                <h3 className="font-display text-2xl text-white leading-tight">{item.title}</h3>
                              ) : (
                                <p className="font-display text-lg text-[#D6FF3F]">{formatShortDate(item.starts_at)}</p>
                              )}

                              <p className="font-display text-3xl mt-1">
                                {formatTime(item.starts_at)} {item.ends_at ? `– ${formatTime(item.ends_at)}` : ""}
                              </p>
                            </div>

                            {/* TRAINER INFO */}
                            {item.trainer && (
                              <div className="mt-5 flex items-center gap-3 border-t border-white/20 pt-4">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#D6FF3F] bg-[#14171A]">
                                  {item.trainer.image_url ? (
                                    <img src={item.trainer.image_url} alt={item.trainer.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="font-display text-sm text-[#D6FF3F]">{getTrainerInitials(item.trainer.name, item.trainer.initials)}</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-display text-base text-white truncate">{item.trainer.name}</p>
                                  <p className="text-xs text-[#B9BEC2] truncate">{item.trainer.focus}</p>
                                </div>
                              </div>
                            )}

                            {/* LOCATIE */}
                            {item.venue && (
                              <p className="mt-3 text-xs text-[#B9BEC2] truncate">
                                📍 {item.venue.city.toUpperCase()} — {item.venue.name}
                              </p>
                            )}
                          </div>

                          {/* DIRECTE GOW! KNOP */}
                          <div className="pt-2">
                            <Link
                              href={bookingUrl}
                              className="flex w-full items-center justify-center gap-2 bg-[#FF4B3E] px-4 py-3.5 font-display text-lg text-white transition group-hover:bg-[#D6FF3F] group-hover:!text-[#14171A]"
                            >
                              GOW! →
                            </Link>
                          </div>

                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ONZE TRAINERS */}
          {!loading && !errorMessage && activeTab === "trainers" && (
            <div className="mt-8">
              {filteredTrainers.length === 0 ? (
                <section className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
                  <div className="bg-[#14171A] p-6 text-white sm:p-8">
                    <p className="font-display text-4xl text-[#D6FF3F]">NOG GEEN TRAINER MATCH.</p>
                    <p className="mt-3 text-base text-[#B9BEC2]">Geen trainers gevonden voor deze zoekopdracht.</p>
                  </div>
                </section>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {filteredTrainers.map((trainer) => (
                    <article
                      key={trainer.id}
                      className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#FF4B3E]"
                    >
                      <div className="flex h-full flex-col justify-between bg-[#14171A] p-5 text-white">
                        <div>
                          <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A]">
                              {trainer.image_url ? (
                                <img src={trainer.image_url} alt={trainer.name} className="h-full w-full object-cover" />
                              ) : (
                                <span className="font-display text-xl text-[#D6FF3F]">{getTrainerInitials(trainer.name, trainer.initials)}</span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="truncate font-display text-2xl leading-none">{trainer.name}</p>
                              <p className="mt-1 text-xs text-[#B9BEC2]">{trainer.sport}</p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className="bg-[#2A2E31] px-2.5 py-1 font-display text-xs text-white">
                              {trainer.city || "Nederland"}
                            </span>
                            {(trainer.available_slots_count ?? 0) > 0 ? (
                              <span className="bg-[#FF4B3E] px-2.5 py-1 font-display text-xs text-white">
                                {trainer.available_slots_count} UUR BOEKBAAR
                              </span>
                            ) : (
                              <span className="border border-white/15 px-2.5 py-1 font-display text-xs text-[#8A8F94]">
                                OP AANVRAAG
                              </span>
                            )}
                          </div>

                          <div className="mt-4">
                            <p className="font-display text-[10px] uppercase text-[#FF4B3E]">SPECIALISATIE</p>
                            <p className="truncate font-display text-xl text-[#D6FF3F]">{trainer.focus}</p>
                          </div>

                          <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-[#B9BEC2]">
                            {trainer.bio || "Bekijk het profiel en de live beschikbaarheid van deze trainer op GowTrain."}
                          </p>
                        </div>

                        <div className="mt-6 border-t border-white/20 pt-4 flex items-end justify-between">
                          <div>
                            <span className="block font-display text-[10px] text-[#8A8F94]">PRIJS PER UUR</span>
                            <span className="font-display text-3xl text-[#D6FF3F]">{formatPricePerHour(trainer.price_per_hour)}</span>
                          </div>

                          <Link
                            href={`/trainers/${trainer.id}`}
                            className="bg-[#FF4B3E] px-6 py-3.5 font-display text-lg text-white transition group-hover:bg-[#D6FF3F] group-hover:!text-[#14171A]"
                          >
                            BEKIJK PROFIEL →
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
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
          <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
          <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
        </div>
        <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">AANBOD LADEN...</p>
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