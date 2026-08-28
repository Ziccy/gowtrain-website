"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

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
            rating,
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
        console.error("Trainer detail ophalen fout:", trainerError?.message);
        setTrainer(null);
        setSlots([]);
        setErrorMessage("Deze trainer is niet gevonden of momenteel niet actief.");
        return;
      }

      setTrainer(trainerData as Trainer);

      /* Eerstvolgende 3 beschikbare tijdsloten ophalen */
      const { data: slotData, error: slotError } = await supabase
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
              id,
              name,
              city,
              address_line,
              postal_code
            )
          `
        )
        .eq("trainer_id", selectedTrainerId)
        .eq("status", "available")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(3);

      if (slotError) {
        console.error("Trainer slots ophalen fout:", slotError.message);
        setSlots([]);
      } else {
        setSlots((slotData ?? []) as unknown as AvailabilitySlot[]);
      }
    } catch (error) {
      console.error("Onverwachte trainerdetail-fout:", error);
      setTrainer(null);
      setSlots([]);
      setErrorMessage("De trainer kon niet worden geladen. Vernieuw de pagina.");
    } finally {
      setLoading(false);
    }
  }

  /* BRANDBOOK BRANDED LOADER */
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
            PROFIEL LADEN...
          </p>
        </div>
      </main>
    );
  }

  /* TRAINER NIET GEVONDEN STATE */
  if (!trainer || errorMessage) {
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

            <Link
              href="/trainers"
              className="font-display text-sm text-white transition hover:text-[#D6FF3F]"
            >
              ← OVERZICHT TRAINERS
            </Link>
          </div>
        </header>

        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">TRAINER NIET GEVONDEN</p>
              <h1 className="mt-4 font-display text-5xl leading-[0.85] sm:text-6xl">
                DEZE MATCH IS EVEN WEG.
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                {errorMessage || "Deze trainer is niet meer beschikbaar. Bekijk andere trainers in de buurt."}
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

  const hasRating =
    trainer.rating !== null &&
    trainer.rating !== undefined &&
    trainer.rating > 0;

  const firstName = trainer.name.trim().split(" ")[0].toUpperCase();

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
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

          <Link
            href="/trainers"
            className="font-display text-sm text-white transition hover:text-[#D6FF3F]"
          >
            ← ALLE TRAINERS
          </Link>
        </div>
      </header>

      {/* PROFIEL HERO */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 select-none font-display text-[17rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[26rem] lg:text-[34rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          {/* Profiel Header Blok */}
          <section className="border-b-2 border-white/20 pb-10">
            <p className="font-display text-lg text-[#FF4B3E]">TRAINERPROFIEL</p>

            <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A] sm:h-36 sm:w-36">
                  {trainer.image_url ? (
                    <img
                      src={trainer.image_url}
                      alt={`Profielfoto van ${trainer.name}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="font-display text-4xl text-[#D6FF3F] sm:text-5xl">
                      {getTrainerInitials(trainer)}
                    </span>
                  )}
                </div>

                <div>
                  <span className="bg-[#FF4B3E] px-3 py-1 font-display text-xs text-white uppercase">
                    {trainer.sport}
                  </span>

                  <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                    {trainer.name}
                  </h1>

                  <p className="mt-3 font-display text-xl text-[#D6FF3F]">
                    {trainer.focus}
                  </p>
                </div>
              </div>

              {/* Rating & Prijs badges */}
              <div className="flex flex-wrap gap-3">
                {hasRating ? (
                  <div className="bg-[#D6FF3F] px-4 py-3 text-[#14171A]">
                    <p className="font-display text-2xl leading-none">
                      {trainer.rating?.toFixed(1)} ★
                    </p>
                    <p className="mt-1 font-display text-xs">RATING</p>
                  </div>
                ) : (
                  <div className="border-2 border-white/25 px-4 py-3 text-white">
                    <p className="font-display text-2xl leading-none">NIEUW</p>
                    <p className="mt-1 font-display text-xs text-[#B9BEC2]">OP GOWTRAIN</p>
                  </div>
                )}

                <div className="border-2 border-white px-4 py-3">
                  <p className="font-display text-2xl leading-none text-[#D6FF3F]">
                    €{Number(trainer.price_per_hour).toFixed(0)}
                  </p>
                  <p className="mt-1 font-display text-xs text-[#B9BEC2]">PER UUR</p>
                </div>
              </div>
            </div>
          </section>

          {/* Snel overzicht (Stats) */}
          <section className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A]">
              <p className="font-display text-xs">SPORT</p>
              <p className="mt-1 font-display text-2xl">{trainer.sport}</p>
            </div>

            <div className="border-2 border-white bg-white p-5 text-[#14171A]">
              <p className="font-display text-xs text-[#53595E]">REGIO</p>
              <p className="mt-1 font-display text-2xl truncate">
                {getLocation(trainer)}
              </p>
            </div>

            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white">
              <p className="font-display text-xs">WERKGEBIED</p>
              <p className="mt-1 font-display text-2xl">
                {trainer.radius_km ? `${trainer.radius_km} KM REISAFSTAND` : "LOKAAL"}
              </p>
            </div>
          </section>

          {/* MAIN CONTENT GRID */}
          <div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            
            {/* LINKER KOLOM: BESCHIKBAARHEID (1-TIK BOEKEN) */}
            <section>
              <p className="font-display text-lg text-[#FF4B3E]">BESCHIKBARE MOMENTEN</p>
              <h2 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl">
                EERSTVOLGENDE LES.
              </h2>

              {slots.length > 0 ? (
                <div className="mt-6 space-y-4">
                  {slots.map((slot) => (
                    <article
                      key={slot.id}
                      className="group border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E] transition duration-200 hover:-translate-y-1"
                    >
                      <div className="bg-[#14171A] p-5 text-white">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className="bg-[#D6FF3F] px-2.5 py-1 font-display text-xs text-[#14171A]">
                              {formatDate(slot.starts_at)}
                            </span>
                            <p className="mt-3 font-display text-3xl">
                              {formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="font-display text-3xl text-[#D6FF3F]">
                              {formatEuro(slot.price_cents, slot.currency)}
                            </p>
                            <p className="mt-1 font-display text-xs text-[#B9BEC2]">
                              INCL. BAANHUUR
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-white/20 pt-4">
                          <div>
                            <p className="font-display text-xs text-[#8A8F94]">LOCATIE</p>
                            <p className="mt-1 font-display text-sm text-white">
                              {getVenueLabel(slot.venue)}
                            </p>
                            {slot.venue?.address_line && (
                              <p className="text-xs text-[#B9BEC2]">
                                {slot.venue.address_line}, {slot.venue.city}
                              </p>
                            )}
                          </div>

                          {/* DIRECTE GOW! BOEKINGSKNOP PER SLOT */}
                          <Link
                            href={`/boeken/${trainer.id}?slot=${slot.id}`}
                            className="bg-[#FF4B3E] px-6 py-3 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                          >
                            GOW! →
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}

                  <div className="mt-6 pt-2">
                    <Link
                      href={`/boeken/${trainer.id}`}
                      className="inline-flex w-full items-center justify-center gap-3 bg-[#D6FF3F] px-6 py-5 font-display text-xl !text-[#14171A] transition hover:bg-white"
                    >
                      BEKIJK ALLE DAGEN & TIJDEN. GOW! →
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="mt-6 border-2 border-white bg-white p-3 text-[#14171A]">
                  <div className="bg-[#14171A] p-6 text-white">
                    <p className="font-display text-3xl text-[#D6FF3F]">GEEN GEPLANDE SLOTS.</p>
                    <p className="mt-3 leading-relaxed text-[#B9BEC2]">
                      {firstName} heeft momenteel geen openstaande tijdsloten. Kom later terug of bekijk andere trainers.
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* RECHTER KOLOM: OVER DE TRAINER */}
            <section>
              <p className="font-display text-lg text-[#FF4B3E]">
                OVER {trainer.name.toUpperCase()}
              </p>
              <h2 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl">
                JOUW VOLGENDE<br />
                STAP OP DE BAAN.
              </h2>

              <div className="mt-6 border-l-2 border-[#D6FF3F] pl-5">
                <p className="font-display text-2xl text-[#D6FF3F]">
                  {trainer.focus}
                </p>
              </div>

              <div className="mt-6 text-lg leading-relaxed text-[#D7D9DA]">
                {trainer.bio ? (
                  <p className="whitespace-pre-line">{trainer.bio}</p>
                ) : (
                  <p className="italic text-[#8A8F94]">
                    {trainer.name} heeft nog geen uitgebreide biografie ingevuld. Bekijk de tijdsloten hiernaast en boek je eerste les!
                  </p>
                )}
              </div>

              <div className="mt-10 border-t border-white/20 pt-6">
                <p className="font-display text-xs text-[#FF4B3E]">TRAININGSREGIO</p>
                <p className="mt-2 font-display text-3xl text-white">
                  {getLocation(trainer)}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                  De exacte locatie (club/baan) en details worden direct bij je boeking bevestigd.
                </p>
              </div>

              {slots.length > 0 ? (
                <Link
                  href={`/boeken/${trainer.id}`}
                  className="mt-8 flex w-full items-center justify-center gap-3 border-2 border-white px-6 py-5 font-display text-xl text-white transition hover:bg-white hover:!text-[#14171A]"
                >
                  TRAINEN MET {firstName}. GOW! →
                </Link>
              ) : (
                <Link
                  href="/trainers"
                  className="mt-8 flex w-full items-center justify-center gap-3 border-2 border-white px-6 py-5 font-display text-xl text-white transition hover:bg-white hover:text-[#14171A]"
                >
                  ZOEK ANDERE TRAINERS →
                </Link>
              )}
            </section>

          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}