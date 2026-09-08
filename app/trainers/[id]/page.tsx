"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type OfferTab = "slots" | "packages";

type Trainer = {
  id: string;
  initials: string;
  name: string;
  sport: string;
  focus: string;
  bio: string | null;
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_label: string | null;
  radius_km: number | null;
  price_per_hour: number;
  image_url: string | null;
};

type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address_line: string;
  postal_code: string | null;
};

type AvailabilitySlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  sport: "padel" | "tennis";
  max_participants: number;
  price_cents: number;
  currency: string;
  venue: VenueSummary | null;
};

type TrainerPackage = {
  id: string;
  title: string;
  sport: "padel" | "tennis";
  lesson_count: number;
  duration_minutes: number;
  starts_at: string;
  price_cents: number;
  currency: string;
  max_participants: number;
  venue: VenueSummary | null;
};

function getTrainerInitials(trainer: Trainer): string {
  if (trainer.initials?.trim()) {
    return trainer.initials.trim().toUpperCase();
  }

  const nameParts = trainer.name.trim().split(" ").filter(Boolean);

  if (nameParts.length === 0) return "GT";
  if (nameParts.length === 1) return nameParts[0].slice(0, 2).toUpperCase();

  return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(value))
    .replace(".", "")
    .toUpperCase();
}

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(new Date(value))
    .toUpperCase();
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function getLocation(trainer: Trainer): string {
  if (trainer.city && trainer.province) {
    return `${trainer.city} · ${trainer.province}`;
  }

  if (trainer.city) return trainer.city;
  if (trainer.province) return trainer.province;
  if (trainer.distance_label) return trainer.distance_label;

  return "Locatie volgt";
}

function getVenueLabel(venue: VenueSummary | null): string {
  if (!venue) return "LOCATIE VOLGT";
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

export default function TrainerDetailPage() {
  const params = useParams<{ id: string }>();
  const trainerId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [trainer, setTrainer] = useState<Trainer | null>();
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [packages, setPackages] = useState<TrainerPackage[]>([]);

  // TAB SWITCHER FOR LESSONS VS PACKAGES
  const [activeOfferTab, setActiveOfferTab] = useState<OfferTab>("slots");

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!trainerId) {
      setLoading(false);
      setErrorMessage("Deze trainer kon niet worden gevonden.");
      return;
    }

    void loadTrainer(trainerId);
  }, [trainerId]);

  async function loadTrainer(selectedTrainerId: string): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: trainerData, error: trainerError } = await supabase
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
            latitude,
            longitude,
            distance_label,
            radius_km,
            price_per_hour,
            image_url
          `
        )
        .eq("id", selectedTrainerId)
        .eq("is_active", true)
        .eq("approval_status", "approved")
        .single();

      if (trainerError || !trainerData) {
        setTrainer(null);
        setSlots([]);
        setPackages([]);
        setErrorMessage("Deze trainer is niet gevonden of momenteel niet actief.");
        return;
      }

      setTrainer(trainerData as Trainer);

      const minBookingTime = new Date(
        Date.now() + 2 * 60 * 60 * 1000
      ).toISOString();

      // 2. Losse tijdsloten ophalen
      const { data: slotData } = await supabase
        .from("availability_slots")
        .select(
          `
            id,
            starts_at,
            ends_at,
            sport,
            max_participants,
            price_cents,
            currency,
            venue:venues!availability_slots_location_id_fkey (
              id, name, city, address_line, postal_code
            )
          `
        )
        .eq("trainer_id", selectedTrainerId)
        .eq("status", "available")
        .gte("starts_at", minBookingTime)
        .order("starts_at", { ascending: true })
        .limit(3);

      setSlots((slotData ?? []) as unknown as AvailabilitySlot[]);

      // 3. Lespakketten ophalen
      const { data: packageData } = await supabase
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
            max_participants,
            venue:venues!trainer_packages_location_id_fkey (
              id, name, city, address_line, postal_code
            )
          `
        )
        .eq("trainer_id", selectedTrainerId)
        .eq("is_active", true)
        .gte("starts_at", minBookingTime)
        .order("starts_at", { ascending: true });

      setPackages((packageData ?? []) as unknown as TrainerPackage[]);
    } catch {
      setTrainer(null);
      setSlots([]);
      setPackages([]);
      setErrorMessage("De trainer kon niet worden geladen.");
    } finally {
      setLoading(false);
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
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">PROFIEL LADEN...</p>
        </div>
      </main>
    );
  }

  if (!trainer || errorMessage) {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <SiteHeader />
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">TRAINER NIET GEVONDEN</p>
              <h1 className="mt-4 font-display text-5xl leading-[0.85] sm:text-6xl">DEZE MATCH IS EVEN WEG.</h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                {errorMessage || "Deze trainer is niet meer beschikbaar."}
              </p>
              <Link
                href="/trainers"
                className="mt-8 inline-flex bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
              >
                BEKIJK ALLE TRAINERS →
              </Link>
            </div>
          </div>
        </section>
        <SiteFooter />
      </main>
    );
  }

  const firstName = trainer.name.trim().split(" ")[0].toUpperCase();

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      {/* PROFIEL BODY */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14 lg:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 select-none font-display text-[17rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[26rem] lg:text-[34rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          {/* PROFIEL HEADER BANNER */}
          <section className="border-b-2 border-white/20 pb-8 sm:pb-10">
            <div className="flex items-center justify-between gap-4">
              <p className="font-display text-lg text-[#FF4B3E]">TRAINERPROFIEL</p>
              <Link
                href="/trainers"
                className="font-display text-xs text-[#B9BEC2] hover:text-[#D6FF3F] transition"
              >
                ← TERUG NAAR ALLE TRAINERS
              </Link>
            </div>

            <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A] sm:h-32 sm:w-32">
                  {trainer.image_url ? (
                    <img
                      src={trainer.image_url}
                      alt={`Profielfoto van ${trainer.name}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="font-display text-3xl text-[#D6FF3F] sm:text-5xl">
                      {getTrainerInitials(trainer)}
                    </span>
                  )}
                </div>

                <div>
                  <span className="bg-[#FF4B3E] px-3 py-1 font-display text-xs uppercase text-white">
                    {trainer.sport}
                  </span>

                  <h1 className="mt-2 font-display text-4xl leading-[0.85] sm:text-6xl lg:text-7xl">
                    {trainer.name}
                  </h1>

                  <p className="mt-2 font-display text-lg text-[#D6FF3F] sm:text-xl">
                    {trainer.focus}
                  </p>
                </div>
              </div>

              {/* PRIJS PER UUR */}
              <div className="flex shrink-0 items-center gap-3">
                <div className="border-2 border-white bg-[#14171A] px-5 py-3 shadow-[4px_4px_0_0_#FF4B3E]">
                  <p className="font-display text-3xl leading-none text-[#D6FF3F]">
                    €{Number(trainer.price_per_hour).toFixed(0)}
                  </p>
                  <p className="mt-1 font-display text-[10px] text-[#B9BEC2]">
                    PER UUR (INCL. BAAN)
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* AANBOD TAB SWITCHER */}
          <div className="mt-8 flex flex-wrap items-center gap-3 border-b-2 border-white/20 pb-4">
            <button
              type="button"
              onClick={() => setActiveOfferTab("slots")}
              className={`border-2 px-5 py-3 font-display text-base sm:text-lg transition ${
                activeOfferTab === "slots"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              LOSSE LESSEN &amp; AGENDA
            </button>

            {packages.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveOfferTab("packages")}
                className={`border-2 px-5 py-3 font-display text-base sm:text-lg transition ${
                  activeOfferTab === "packages"
                    ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                    : "border-white/30 text-white hover:border-white"
                }`}
              >
                COMPLETE TRAJECTEN ({packages.length})
              </button>
            )}
          </div>

          {/* TAB 1: LOSSE LESSEN & HOOFD-AGENDA (STANDAARD ZICHTBAAR) */}
          {activeOfferTab === "slots" && (
            <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:items-start">
              
              {/* LINKERKOLOM: PAKKET BANNER + OVER DE TRAINER */}
              <div className="space-y-6">
                
                {/* 💡 MOOI INKTZWART BLOK MET GELE RAND BOVEN 'OVER DE TRAINER' */}
                {packages.length > 0 && (
                  <div className="border-2 border-[#D6FF3F] bg-[#14171A] p-5 text-white shadow-[6px_6px_0_0_#D6FF3F]">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <span className="bg-[#D6FF3F] px-2.5 py-0.5 font-display text-[10px] text-[#14171A]">
                          MEESTE VOORDEEL
                        </span>
                        <p className="font-display text-2xl text-[#D6FF3F] mt-2">
                          COMPLETE LESPAKKETTEN &amp; TRAJECTEN
                        </p>
                        <p className="text-xs text-[#B9BEC2] mt-1 leading-relaxed">
                          {firstName} biedt ook {packages.length} complete {packages.length === 1 ? "lespakket" : "lespakketten"} aan voor meerdere weken.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveOfferTab("packages")}
                        className="shrink-0 bg-[#D6FF3F] px-5 py-3 font-display text-sm !text-[#14171A] hover:bg-white transition shadow-[3px_3px_0_0_#FF4B3E]"
                      >
                        BEKIJK TRAJECTEN →
                      </button>
                    </div>
                  </div>
                )}

                {/* OVER DE TRAINER */}
                <section className="border-2 border-white/20 bg-[#14171A] p-6 sm:p-8 shadow-[6px_6px_0_0_#FF4B3E]">
                  <p className="font-display text-lg text-[#FF4B3E]">OVER {trainer.name.toUpperCase()}</p>
                  <h2 className="mt-1 font-display text-4xl leading-[0.85] sm:text-5xl">
                    JOUW VOLGENDE STAP OP DE BAAN.
                  </h2>

                  <div className="mt-5 border-l-2 border-[#D6FF3F] pl-4">
                    <p className="font-display text-xl text-[#D6FF3F]">
                      {trainer.focus}
                    </p>
                  </div>

                  <div className="mt-5 text-base leading-relaxed text-[#D7D9DA]">
                    {trainer.bio ? (
                      <p className="whitespace-pre-line">{trainer.bio}</p>
                    ) : (
                      <p className="italic text-[#8A8F94]">
                        {trainer.name} heeft nog geen uitgebreide biografie ingevuld.
                      </p>
                    )}
                  </div>

                  <div className="mt-8 border-t border-white/20 pt-5">
                    <p className="font-display text-xs text-[#FF4B3E]">TRAININGSREGIO</p>
                    <p className="mt-1 font-display text-2xl text-white">
                      {getLocation(trainer)}
                    </p>
                  </div>
                </section>

              </div>

              {/* RECHTERKOLOM: BOEKINGSOPTIES (DIRECT BOEKEN VOOROP!) */}
              <section className="space-y-6">
                
                {/* HOOFD CTA KNOP */}
                <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-6 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
                  <p className="font-display text-xs text-[#FF4B3E]">DIRECT BOEKEN</p>
                  <h3 className="mt-1 font-display text-3xl">KIES EEN DATUM & TIJD</h3>
                  <p className="mt-2 text-xs font-semibold text-[#14171A]/80 leading-relaxed">
                    Bekijk alle beschikbare dagen, tijden en locaties in de volledige agenda van {firstName}.
                  </p>

                  <Link
                    href={`/boeken/${trainer.id}`}
                    className="mt-5 flex items-center justify-center gap-2 bg-[#14171A] px-6 py-4 font-display text-xl !text-[#D6FF3F] hover:bg-white hover:!text-[#14171A] transition shadow-[4px_4px_0_0_#FF4B3E]"
                  >
                    BEKIJK ALLE DAGEN & TIJDEN. GOW! →
                  </Link>
                </div>

                {/* LOSSE BINNENKORT BESCHIKBARE LESSEN */}
                <div>
                  <p className="font-display text-sm text-[#FF4B3E]">EERSTVOLGENDE LOSSE SLOTS</p>

                  {slots.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {slots.map((slot) => (
                        <article
                          key={slot.id}
                          className="group border-2 border-white bg-white p-2.5 text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E] transition hover:-translate-y-0.5"
                        >
                          <div className="bg-[#14171A] p-4 text-white">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <span className="bg-[#D6FF3F] px-2 py-0.5 font-display text-[11px] text-[#14171A]">
                                  {formatDate(slot.starts_at)}
                                </span>
                                <p className="mt-2 font-display text-2xl">
                                  {formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}
                                </p>
                              </div>

                              <div className="text-right">
                                <p className="font-display text-2xl text-[#D6FF3F]">
                                  {formatEuro(slot.price_cents, slot.currency)}
                                </p>
                                <p className="text-[9px] text-[#8A8F94]">INCL. BAANHUUR</p>
                              </div>
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/20 pt-3">
                              <p className="text-xs text-[#B9BEC2] truncate">
                                {getVenueLabel(slot.venue)}
                              </p>

                              <Link
                                href={`/boeken/${trainer.id}?slot=${slot.id}`}
                                className="shrink-0 bg-[#FF4B3E] px-4 py-2 font-display text-sm text-white hover:bg-[#D6FF3F] hover:!text-[#14171A] transition"
                              >
                                GOW! →
                              </Link>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 border-2 border-white/20 bg-[#14171A] p-5 text-center text-[#B9BEC2]">
                      <p className="font-display text-lg text-[#D6FF3F]">GEEN LOSSE SLOTS DIT WEEKEND.</p>
                      <p className="mt-1 text-xs">Klik hierboven op 'Bekijk Alle Dagen & Tijden' voor alle opties.</p>
                    </div>
                  )}
                </div>

              </section>

            </div>
          )}

          {/* TAB 2: COMPLETE LESPAKKETTEN & TRAJECTEN */}
          {activeOfferTab === "packages" && packages.length > 0 && (
            <div className="mt-8 space-y-6">
              <div className="flex items-center gap-3">
                <span className="bg-[#D6FF3F] px-3 py-1 font-display text-xs text-[#14171A]">
                  MEESTE VOORDEEL
                </span>
                <p className="font-display text-base text-[#D6FF3F]">
                  COMPLETE TRAJECTEN VAN {firstName}
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {packages.map((pkg) => {
                  const perLessonCents = Math.round(pkg.price_cents / pkg.lesson_count);

                  return (
                    <article
                      key={pkg.id}
                      className="border-2 border-[#D6FF3F] bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]"
                    >
                      <div className="flex h-full flex-col justify-between bg-[#14171A] p-5 text-white">
                        <div>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <span className="bg-[#FF4B3E] px-2.5 py-1 font-display text-xs text-white">
                                {pkg.lesson_count} LESSEN TRAJECT
                              </span>
                              <h3 className="mt-2 font-display text-2xl text-white">
                                {pkg.title}
                              </h3>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="font-display text-2xl text-[#D6FF3F]">
                                {formatEuro(pkg.price_cents, pkg.currency)}
                              </p>
                              <p className="text-[10px] text-[#8A8F94]">
                                {formatEuro(perLessonCents, pkg.currency)} / LES
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 space-y-1.5 border-y border-white/20 py-3 text-xs text-[#B9BEC2]">
                            <p><b>Startdatum:</b> {formatFullDate(pkg.starts_at)} om {formatTime(pkg.starts_at)}</p>
                            <p><b>Duur:</b> {pkg.duration_minutes} min per les ({pkg.lesson_count} weken lang)</p>
                            <p><b>Locatie:</b> {getVenueLabel(pkg.venue)}</p>
                            <p><b>Groep:</b> Max. {pkg.max_participants} {pkg.max_participants === 1 ? "speler (privé)" : "spelers"}</p>
                          </div>
                        </div>

                        <Link
                          href={`/boeken/pakket/${pkg.id}`}
                          className="mt-5 flex items-center justify-center gap-2 bg-[#D6FF3F] px-5 py-3.5 font-display text-lg !text-[#14171A] transition hover:bg-white"
                        >
                          BOEK TRAJECT. GOW! →
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}