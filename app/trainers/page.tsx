"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type SportFilter = "all" | "Padel" | "Tennis" | "Padel & Tennis";
type SortOption = "rating" | "price_asc" | "price_desc";

type Trainer = {
  id: string;
  initials: string;
  name: string;
  sport: string;
  focus: string;
  bio: string | null;
  rating: number | null;
  city: string | null;
  province: string | null;
  radius_km: number | null;
  price_per_hour: number;
  image_url: string | null;
};

const sportFilters: {
  label: string;
  value: SportFilter;
}[] = [
  { label: "ALLE TRAINERS", value: "all" },
  { label: "PADEL", value: "Padel" },
  { label: "TENNIS", value: "Tennis" },
  { label: "PADEL & TENNIS", value: "Padel & Tennis" },
];

function formatPrice(price: number): string {
  return `€${Number(price).toFixed(0)}`;
}

function getTrainerLocation(trainer: Trainer): string {
  if (trainer.city && trainer.province) {
    return `${trainer.city} · ${trainer.province}`;
  }

  if (trainer.city) {
    return trainer.city;
  }

  if (trainer.province) {
    return trainer.province;
  }

  return "Locatie volgt";
}

function getTrainerInitials(trainer: Trainer): string {
  if (trainer.initials?.trim()) {
    return trainer.initials.trim().toUpperCase();
  }

  const nameParts = trainer.name.trim().split(" ").filter(Boolean);

  if (nameParts.length === 0) {
    return "GT";
  }

  if (nameParts.length === 1) {
    return nameParts[0].slice(0, 2).toUpperCase();
  }

  return `${nameParts[0][0]}${
    nameParts[nameParts.length - 1][0]
  }`.toUpperCase();
}

function TrainersContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [searchQuery, setSearchQuery] =
    useState<string>(initialQuery);
  const [selectedSport, setSelectedSport] =
    useState<SportFilter>("all");
  const [sortBy, setSortBy] =
    useState<SortOption>("rating");

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] =
    useState<string>("");

  useEffect(() => {
    void loadTrainers();
  }, []);

  const filteredAndSortedTrainers = useMemo(
    (): Trainer[] => {
      const normalizedQuery = searchQuery
        .trim()
        .toLocaleLowerCase("nl-NL");

      const result = trainers.filter((trainer: Trainer) => {
        const trainerSport = trainer.sport.trim();

        const matchesSport =
          selectedSport === "all" ||
          trainerSport === selectedSport ||
          (selectedSport === "Padel" &&
            trainerSport === "Padel & Tennis") ||
          (selectedSport === "Tennis" &&
            trainerSport === "Padel & Tennis");

        if (!matchesSport) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

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

        return (b.rating ?? 0) - (a.rating ?? 0);
      });
    },
    [trainers, searchQuery, selectedSport, sortBy]
  );

  async function loadTrainers(): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
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
            rating,
            city,
            province,
            radius_km,
            price_per_hour,
            image_url
          `
        )
        .eq("is_active", true)
        .eq("approval_status", "approved")
        .order("rating", {
          ascending: false,
          nullsFirst: false,
        })
        .order("name", { ascending: true });

      if (error) {
        console.error(
          "Trainers ophalen fout:",
          error.message
        );

        setErrorMessage(
          "De trainers konden niet worden geladen. Probeer het opnieuw."
        );
        setTrainers([]);
        return;
      }

      setTrainers((data ?? []) as Trainer[]);
    } catch (error) {
      console.error("Onverwachte trainers-fout:", error);

      setErrorMessage(
        "De trainers konden niet worden geladen. Probeer het opnieuw."
      );
      setTrainers([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link
            href="/"
            aria-label="Terug naar GowTrain home"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>

            <span
              aria-hidden="true"
              className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]"
            />
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/trainer-login"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              TRAINER LOGIN →
            </Link>

            <Link
              href="/trainer-worden"
              className="bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
            >
              WORD TRAINER
            </Link>
          </div>
        </div>
      </header>

      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 select-none font-display text-[17rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[26rem] lg:text-[34rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="max-w-4xl">
            <p className="font-display text-lg text-[#FF4B3E]">
              VIND JOUW MATCH
            </p>

            <h1 className="mt-3 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              TRAINERS
              <br />
              BIJ JOU.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Zoek op stad, sport of specialisatie. Bekijk beschikbare
              trainers en boeken maar: Gow!
            </p>
          </div>

          <div className="mt-10 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-4 sm:p-6">
              <label
                htmlFor="trainer-search"
                className="font-display text-base text-[#FF4B3E]"
              >
                WAAR BEN JE NAAR OP ZOEK?
              </label>

              <div className="mt-3 flex border-2 border-white/25 transition focus-within:border-[#D6FF3F]">
                <span
                  aria-hidden="true"
                  className="flex items-center px-4 text-xl text-[#D6FF3F]"
                >
                  ⌕
                </span>

                <input
                  id="trainer-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) =>
                    setSearchQuery(event.target.value)
                  }
                  placeholder="Zoek op stad (bijv. Rotterdam), naam of specialisatie"
                  className="w-full bg-transparent py-4 pr-4 text-white outline-none placeholder:text-[#8A8F94]"
                />
              </div>

              <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-display text-xs text-[#D6FF3F]">
                    SPORT
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {sportFilters.map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        onClick={() =>
                          setSelectedSport(filter.value)
                        }
                        className={`border-2 px-4 py-2.5 font-display text-sm transition ${
                          selectedSport === filter.value
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30 text-white hover:border-white"
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="font-display text-xs text-[#D6FF3F]">
                    SORTEER OP
                  </p>

                  <select
                    value={sortBy}
                    onChange={(event) =>
                      setSortBy(
                        event.target.value as SortOption
                      )
                    }
                    className="mt-2 border-2 border-white/30 bg-[#14171A] px-4 py-2.5 font-display text-sm text-white outline-none focus:border-[#D6FF3F]"
                  >
                    <option value="rating">
                      HOOGSTE RATING ★
                    </option>

                    <option value="price_asc">
                      PRIJS: LAAG → HOOG
                    </option>

                    <option value="price_desc">
                      PRIJS: HOOG → LAAG
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {!loading && (
            <div className="mt-10 flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-5 sm:flex-row sm:items-end">
              <div>
                <p className="font-display text-lg text-[#FF4B3E]">
                  BESCHIKBARE TRAINERS
                </p>

                <h2 className="mt-2 font-display text-4xl sm:text-5xl">
                  {filteredAndSortedTrainers.length}{" "}
                  {filteredAndSortedTrainers.length === 1
                    ? "MATCH."
                    : "MATCHES."}
                </h2>
              </div>

              {(searchQuery || selectedSport !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedSport("all");
                  }}
                  className="w-fit font-display text-base text-[#D6FF3F] transition hover:text-white"
                >
                  × WIS FILTERS
                </button>
              )}
            </div>
          )}

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

          {!loading && errorMessage && (
            <div
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold leading-relaxed text-white"
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

          {!loading &&
            !errorMessage &&
            filteredAndSortedTrainers.length === 0 && (
              <section className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
                <div className="bg-[#14171A] p-6 text-white sm:p-8">
                  <p className="font-display text-4xl text-[#D6FF3F]">
                    NOG GEEN MATCH.
                  </p>

                  <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#B9BEC2]">
                    We vonden geen trainer die bij deze zoekopdracht past.
                    Pas je zoekterm of sportfilter aan.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedSport("all");
                    }}
                    className="mt-7 bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                  >
                    BEKIJK ALLE TRAINERS →
                  </button>
                </div>
              </section>
            )}

          {!loading &&
            !errorMessage &&
            filteredAndSortedTrainers.length > 0 && (
              <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {filteredAndSortedTrainers.map(
                  (trainer: Trainer) => {
                    const hasRating =
                      trainer.rating !== null &&
                      trainer.rating !== undefined &&
                      trainer.rating > 0;

                    return (
                      <article
                        key={trainer.id}
                        className="group border-2 border-white bg-white p-3 text-[#14171A] transition duration-200 hover:-translate-y-2 hover:shadow-[10px_10px_0_0_#FF4B3E]"
                      >
                        <div className="flex h-full flex-col justify-between bg-[#14171A] p-5 text-white">
                          <div>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex min-w-0 items-center gap-4">
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
                                  <p className="font-display text-2xl leading-[0.9]">
                                    {trainer.name}
                                  </p>

                                  <p className="mt-1 text-sm text-[#B9BEC2]">
                                    {trainer.sport}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 flex items-center gap-2">
                              {hasRating ? (
                                <span className="bg-[#D6FF3F] px-2.5 py-1 font-display text-xs text-[#14171A]">
                                  {trainer.rating?.toFixed(1)} ★
                                </span>
                              ) : (
                                <span className="border border-white/25 px-2.5 py-1 font-display text-xs text-[#B9BEC2]">
                                  NIEUW
                                </span>
                              )}

                              <span className="max-w-[200px] truncate bg-[#2A2E31] px-2.5 py-1 font-display text-xs text-white">
                                {getTrainerLocation(trainer)}
                              </span>
                            </div>

                            <div className="mt-6">
                              <p className="font-display text-xs text-[#FF4B3E]">
                                SPECIALISATIE
                              </p>

                              <p className="mt-1 font-display text-xl text-[#D6FF3F]">
                                {trainer.focus}
                              </p>
                            </div>

                            <p className="mt-3 min-h-16 line-clamp-3 text-sm leading-relaxed text-[#B9BEC2]">
                              {trainer.bio
                                ? trainer.bio
                                : "Bekijk het profiel en de beschikbare tijdsloten van deze trainer."}
                            </p>
                          </div>

                          <div className="mt-6 border-t border-white/20 pt-4">
                            <div className="flex items-end justify-between">
                              <div>
                                <span className="block font-display text-xs text-[#8A8F94]">
                                  PRIJS PER UUR
                                </span>

                                <span className="font-display text-4xl text-[#D6FF3F]">
                                  {formatPrice(
                                    trainer.price_per_hour
                                  )}
                                </span>
                              </div>

                              <Link
                                href={`/trainers/${trainer.id}`}
                                className="flex items-center justify-center gap-2 bg-[#FF4B3E] px-6 py-3 font-display text-xl text-white transition group-hover:bg-[#D6FF3F] group-hover:!text-[#14171A]"
                              >
                                GOW!
                                <span aria-hidden="true">
                                  →
                                </span>
                              </Link>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  }
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