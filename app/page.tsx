"use client";

import { useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type ShowcaseItem = {
  id: string;
  type: "slot" | "package";
  trainerId: string;
  trainerName: string;
  trainerInitials: string;
  trainerImage: string | null;
  trainerRating: number | null;
  sport: string;
  titleOrFocus: string;
  dateLabel: string;
  timeLabel: string;
  locationLabel: string;
  priceLabel: string;
  subPriceLabel?: string;
  href: string;
};

const steps = [
  {
    number: "01",
    title: "ZOEK.",
    text: "Vind padel- en tennistrainers direct bij jou in de buurt.",
  },
  {
    number: "02",
    title: "KIES.",
    text: "Vergelijk specialisaties, uurtarieven en live beschikbaarheid.",
  },
  {
    number: "03",
    title: "GOW!",
    text: "Boek direct met één tik. Geen heen-en-weer ge-app. De baan op.",
  },
];

const trainerBenefits = [
  "Direct zichtbaar voor actieve spelers in jouw regio.",
  "Geen WhatsApp-chaos meer: lessen en betalingen via de app.",
  "Geen maandelijkse kosten, slechts 5% commissie per boeking.",
  "Volledige controle over je eigen agenda en uurtarief.",
];

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

function formatEuro(cents: number): string {
  return `€${Math.round(cents / 100)}`;
}

export default function Home() {
  const [showcaseItems, setShowcaseItems] = useState<ShowcaseItem[]>([]);
  const [loadingShowcase, setLoadingShowcase] = useState<boolean>(true);

  // CARROUSEL REF & SCROLL FUNCTIE
  const carouselRef = useRef<HTMLDivElement | null>(null);

  const scrollCarousel = (direction: "left" | "right") => {
    if (carouselRef.current) {
      const scrollAmount = direction === "left" ? -380 : 380;
      carouselRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  useEffect(() => {
    void loadDynamicShowcase();
  }, []);

  async function loadDynamicShowcase(): Promise<void> {
    setLoadingShowcase(true);
    const items: ShowcaseItem[] = [];

    try {
      // 1. Losse tijdsloten ophalen uit Supabase
      const { data: slotData } = await supabase
        .from("availability_slots")
        .select(
          `
            id,
            starts_at,
            ends_at,
            sport,
            price_cents,
            trainer:trainers (
              id, name, initials, rating, image_url, focus
            ),
            venue:venues!availability_slots_location_id_fkey (
              name, city
            )
          `
        )
        .eq("status", "available")
        .gte("starts_at", new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString())
        .order("starts_at", { ascending: true })
        .limit(10);

      if (slotData && slotData.length > 0) {
        slotData.forEach((slot: any) => {
          if (slot.trainer) {
            items.push({
              id: slot.id,
              type: "slot",
              trainerId: slot.trainer.id,
              trainerName: slot.trainer.name,
              trainerInitials: slot.trainer.initials || slot.trainer.name.slice(0, 2).toUpperCase(),
              trainerImage: slot.trainer.image_url,
              trainerRating: slot.trainer.rating,
              sport: slot.sport.toUpperCase(),
              titleOrFocus: slot.trainer.focus || "Padel & Tennis",
              dateLabel: `${formatDate(slot.starts_at)} · ${formatTime(slot.starts_at)} - ${formatTime(slot.ends_at)}`,
              timeLabel: formatTime(slot.starts_at),
              locationLabel: slot.venue ? `${slot.venue.city} — ${slot.venue.name}` : "Locatie volgt",
              priceLabel: formatEuro(slot.price_cents),
              href: `/boeken/${slot.trainer.id}?slot=${slot.id}`,
            });
          }
        });
      }

      // 2. Lespakketten ophalen uit Supabase
      const { data: packageData } = await supabase
        .from("trainer_packages")
        .select(
          `
            id,
            title,
            sport,
            lesson_count,
            starts_at,
            price_cents,
            trainer:trainers (
              id, name, initials, rating, image_url, focus
            ),
            venue:venues!trainer_packages_location_id_fkey (
              name, city
            )
          `
        )
        .eq("is_active", true)
        .gte("starts_at", new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString())
        .order("starts_at", { ascending: true })
        .limit(10);

      if (packageData && packageData.length > 0) {
        packageData.forEach((pkg: any) => {
          if (pkg.trainer) {
            items.push({
              id: pkg.id,
              type: "package",
              trainerId: pkg.trainer.id,
              trainerName: pkg.trainer.name,
              trainerInitials: pkg.trainer.initials || pkg.trainer.name.slice(0, 2).toUpperCase(),
              trainerImage: pkg.trainer.image_url,
              trainerRating: pkg.trainer.rating,
              sport: pkg.sport.toUpperCase(),
              titleOrFocus: pkg.title,
              dateLabel: `${pkg.lesson_count}-WEKEN TRAJECT (Start: ${formatDate(pkg.starts_at)})`,
              timeLabel: formatTime(pkg.starts_at),
              locationLabel: pkg.venue ? `${pkg.venue.city} — ${pkg.venue.name}` : "Locatie volgt",
              priceLabel: formatEuro(pkg.price_cents),
              subPriceLabel: `${formatEuro(Math.round(pkg.price_cents / pkg.lesson_count))} / les`,
              href: `/boeken/pakket/${pkg.id}`,
            });
          }
        });
      }

      setShowcaseItems(items);
    } catch (error) {
      console.error("Fout bij laden homepage showcase:", error);
    } finally {
      setLoadingShowcase(false);
    }
  }

  return (
    <main className="overflow-hidden bg-[#14171A] text-white">
      {/* HERO */}
      <section
        id="home"
        className="relative isolate min-h-screen overflow-hidden bg-[#14171A]"
      >
        {/* Green glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[-25rem] top-1/2 h-[52rem] w-[52rem] -translate-y-1/2 rounded-full bg-[#D6FF3F] opacity-[0.08] blur-[180px]"
        />

        {/* Groot GOW op achtergrond */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 bottom-[-5rem] z-0 select-none font-display text-[19rem] leading-none text-[#D6FF3F] opacity-[0.05] sm:text-[27rem] lg:text-[38rem]"
        >
          GOW
        </div>

        {/* Padelbaan Decoratie */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-8%] right-[-28%] z-0 hidden h-[86%] w-[72%] border-[3px] border-[#D6FF3F]/20 lg:block"
        >
          <div className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 bg-[#D6FF3F]/20" />
          <div className="absolute left-0 top-[32%] h-[3px] w-full bg-[#D6FF3F]/20" />
          <div className="absolute left-0 top-[68%] h-[3px] w-full bg-[#D6FF3F]/20" />
          <div className="absolute left-[25%] top-0 h-full w-[3px] bg-[#D6FF3F]/10" />
          <div className="absolute right-[25%] top-0 h-full w-[3px] bg-[#D6FF3F]/10" />
        </div>

        <SiteHeader />

        {/* HERO CONTENT */}
        <div className="relative z-10 mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:pb-24 lg:pt-20">
          <div className="grid items-end gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            {/* Linkerkant */}
            <div className="max-w-4xl">
              <h1 className="font-display text-[4.2rem] leading-[0.82] tracking-[-0.03em] sm:text-[6.5rem] md:text-[8rem] lg:text-[9.2rem]">
                ÉÉN TIK.
                <br />
                EN JE STAAT
                <br />
                OP DE BAAN.
              </h1>

              <div className="mt-8 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
                <p className="font-display text-3xl leading-[0.9] text-[#D6FF3F] sm:text-4xl">
                  TRAINERS VINDEN.
                  <br />
                  BOEKEN. GOW!
                </p>

                <p className="max-w-sm border-l-2 border-[#FF4B3E] pl-5 text-base leading-relaxed text-[#D7D9DA] sm:text-lg">
                  Koppel direct met padel- en tennistrainers in jouw buurt. Kies je tijdslot en sta vandaag nog op de baan.
                </p>
              </div>

              {/* Directe Zoekbalk + Populaire Steden Snelselectie */}
              <div className="mt-8 max-w-xl">
                <form action="/trainers" method="GET">
                  <div className="flex flex-col border-2 border-white bg-white p-2 shadow-[8px_8px_0_0_#FF4B3E] sm:flex-row sm:items-center">
                    <input
                      type="text"
                      name="q"
                      placeholder="Zoek op stad of gemeente..."
                      className="w-full bg-transparent px-4 py-3 text-[#14171A] outline-none font-sans font-medium placeholder:text-[#8A8F94]"
                    />
                    <button
                      type="submit"
                      className="mt-2 w-full bg-[#FF4B3E] px-6 py-3 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A] sm:mt-0 sm:w-auto"
                    >
                      ZOEKEN. GOW!
                    </button>
                  </div>
                </form>

                {/* 📍 POPULAIRE STEDEN SNELSELECTIE */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="font-display text-xs text-[#D6FF3F]">POPULAIR:</span>
                  {[
                    "Roermond",
                    "Maastricht",
                    "Venlo",
                    "Eindhoven",
                    "Amsterdam",
                    "Utrecht",
                  ].map((city) => (
                    <a
                      key={city}
                      href={`/trainers?q=${encodeURIComponent(city)}`}
                      className="border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    >
                      {city.toUpperCase()}
                    </a>
                  ))}
                </div>
              </div>

              {/* Hero CTA buttons */}
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <a
                  href="/trainers"
                  className="inline-flex items-center justify-center gap-4 bg-[#FF4B3E] px-7 py-4 font-display text-xl text-white transition duration-200 hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                >
                  BEKIJK ALLE TRAINERS
                  <span aria-hidden="true" className="text-inherit">→</span>
                </a>

                <a
                  href="/trainer-worden"
                  className="inline-flex items-center justify-center gap-4 border-2 border-white px-7 py-4 font-display text-xl text-white transition duration-200 hover:-translate-y-1 hover:bg-white hover:!text-[#14171A]"
                >
                  WORD TRAINER
                  <span aria-hidden="true" className="text-inherit">→</span>
                </a>
              </div>
            </div>

            {/* TRAINERKAART (Brandbook Pagina 13 stijl) */}
            <div className="relative mx-auto hidden w-full max-w-md lg:block lg:translate-x-14 lg:-translate-y-16">
              <div className="absolute -left-7 -top-7 h-28 w-28 border-l-[3px] border-t-[3px] border-[#D6FF3F]" />

              <div className="relative border-2 border-white bg-white p-3 text-[#14171A] shadow-[12px_12px_0_0_#FF4B3E]">
                <div className="bg-[#14171A] p-6 text-white">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#14171A] border-2 border-[#D6FF3F] font-display text-xl text-[#D6FF3F]">
                        TP
                      </div>
                      <div>
                        <p className="font-display text-2xl">TOM PEETERS</p>
                        <p className="mt-1 text-sm text-[#B9BEC2]">
                          Padel · Tactiek &amp; gevorderden
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Rating & Afstand Badge uit Brandbook Pagina 13 */}
                  <div className="mt-4 flex gap-2">
                    <span className="bg-[#D6FF3F] px-3 py-1 font-display text-sm text-[#14171A]">
                      4.8 ★
                    </span>
                    <span className="bg-black px-3 py-1 font-display text-sm text-white">
                      0.8 KM
                    </span>
                  </div>

                  <div className="mt-6 flex items-end justify-between border-t border-white/20 pt-4">
                    <div>
                      <p className="text-xs text-[#8A8F94]">PRIJS PER LES</p>
                      <p className="font-display text-4xl text-[#D6FF3F]">€80</p>
                    </div>

                    <a
                      href="/trainers"
                      className="bg-[#FF4B3E] px-8 py-3 font-display text-xl text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    >
                      GOW!
                    </a>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 font-display text-sm text-[#D6FF3F] lg:flex">
          SCROLL OM TE STARTEN
          <span className="h-8 w-[2px] bg-[#D6FF3F]" />
        </div>
      </section>

      {/* VOOR SPELERS */}
      <section id="spelers" className="bg-white py-20 text-[#14171A] sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                VOOR SPELERS
              </p>

              <h2 className="mt-4 font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
                ZOEK.<br />
                BOEK.<br />
                GOW!
              </h2>

              <p className="mt-7 max-w-sm text-lg leading-relaxed text-[#53595E]">
                Geen eindeloos ge-app via WhatsApp of Instagram. Vind direct je trainer en claim je tijdslot.
              </p>
            </div>

            <div className="grid gap-0 border-l-2 border-[#14171A] sm:grid-cols-3 sm:border-l-0">
              {steps.map((step, index) => (
                <article
                  key={step.number}
                  className={`border-b-2 border-[#14171A] p-6 last:border-b-0 sm:border-b-0 sm:p-7 ${
                    index !== steps.length - 1 ? "sm:border-r-2" : ""
                  }`}
                >
                  <p className="font-display text-5xl text-[#FF4B3E]">
                    {step.number}
                  </p>

                  <h3 className="mt-10 font-display text-4xl">{step.title}</h3>

                  <p className="mt-4 leading-relaxed text-[#53595E]">
                    {step.text}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-14 flex flex-col justify-between gap-6 border-t-2 border-[#14171A] pt-7 sm:flex-row sm:items-center">
            <p className="font-display text-2xl">
              JOUW VOLGENDE LES BEGINT MET ÉÉN TIK.
            </p>

            <a
              href="/trainers"
              className="inline-flex w-fit items-center gap-3 bg-[#14171A] px-6 py-4 font-display text-lg !text-white transition hover:bg-[#FF4B3E] hover:!text-white"
            >
              VIND EEN TRAINER
              <span aria-hidden="true" className="text-inherit">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* DOWNLOAD DE APP */}
      <section
        id="download"
        className="relative overflow-hidden bg-[#14171A] py-20 text-white sm:py-28"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-24 select-none font-display text-[18rem] leading-none text-[#D6FF3F] opacity-[0.06] sm:text-[28rem]"
        >
          APP
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div>
            <p className="font-display text-lg text-[#FF4B3E]">
              ALLES IN ÉÉN APP
            </p>

            <h2 className="mt-4 max-w-4xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              JOUW TRAINING.<br />
              JOUW MOMENT.<br />
              GOW!
            </h2>

            <p className="mt-8 max-w-xl text-lg leading-relaxed text-[#D7D9DA] sm:text-xl">
              Zoek trainers, vergelijk specialisaties, bekijk beschikbaarheid en
              boek je les. Alles regel je snel en overzichtelijk in de GowTrain-app.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a
                href="#"
                className="inline-flex items-center justify-center gap-3 bg-white px-6 py-4 font-display text-lg !text-[#14171A] transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                DOWNLOAD VOOR IOS
                <span aria-hidden="true" className="text-inherit">→</span>
              </a>

              <a
                href="#"
                className="inline-flex items-center justify-center gap-3 border-2 border-white px-6 py-4 font-display text-lg text-white transition hover:-translate-y-1 hover:bg-white hover:!text-[#14171A]"
              >
                DOWNLOAD VOOR ANDROID
                <span aria-hidden="true" className="text-inherit">→</span>
              </a>
            </div>

            <p className="mt-5 text-sm text-[#8A8F94]">
              Binnenkort beschikbaar in de App Store en Google Play Store.
            </p>
          </div>

          {/* iPhone-preview */}
          <div className="relative mx-auto h-[560px] w-full max-w-[380px] overflow-hidden">
            <div className="relative min-h-[760px] rounded-t-[3.5rem] border-x-[8px] border-t-[8px] border-[#2A2E31] bg-[#14171A] p-[7px]">
              <div
                aria-hidden="true"
                className="absolute left-1/2 top-5 z-20 h-[26px] w-[118px] -translate-x-1/2 rounded-full bg-[#050607]"
              />

              <div className="h-[745px] overflow-hidden rounded-t-[2.85rem] bg-[#14171A]">
                <img
                  src="/images/gowtrain-app.png"
                  alt="GowTrain app waarin je een trainer en beschikbaar moment kiest"
                  className="h-full w-full object-cover object-top"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 🎾 DYNAMISCHE CARROUSEL: LIVE AANBOD (MAX 6 ITEMS) */}
      <section
        id="trainers-overzicht"
        className="bg-[#D6FF3F] py-20 text-[#14171A] sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          
          {/* KOP & PIJLTJES NAVIGATIE */}
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                LIVE AANBOD
              </p>

              <h2 className="mt-4 font-display text-6xl leading-[0.83] sm:text-7xl">
                TRAINERS &amp;<br />
                LESSEN BIJ JOU.
              </h2>
            </div>

            <div className="flex items-center justify-between gap-4 md:justify-end">
              <p className="hidden max-w-xs text-sm font-semibold text-[#303438] lg:block">
                Swipe of gebruik de pijlen om beschikbare lessen en trajecten te bekijken.
              </p>

              {/* CARROUSEL PIJLEN */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollCarousel("left")}
                  aria-label="Vorige opties"
                  className="flex h-12 w-12 items-center justify-center border-2 border-[#14171A] bg-white font-display text-2xl text-[#14171A] transition hover:bg-[#14171A] hover:text-white"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => scrollCarousel("right")}
                  aria-label="Volgende opties"
                  className="flex h-12 w-12 items-center justify-center border-2 border-[#14171A] bg-[#FF4B3E] font-display text-2xl text-white transition hover:bg-[#14171A]"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          {/* CARROUSEL CONTAINER */}
          <div
            ref={carouselRef}
            className="mt-12 flex snap-x snap-mandatory gap-6 overflow-x-auto pb-6 scrollbar-none [scroll-behavior:smooth]"
          >
            {showcaseItems.length > 0 ? (
              showcaseItems.slice(0, 9).map((item) => (
                <article
                  key={item.id}
                  className="group w-[300px] shrink-0 snap-start border-2 border-[#14171A] bg-white p-4 transition duration-200 hover:-translate-y-2 hover:shadow-[8px_8px_0_0_#14171A] sm:w-[360px]"
                >
                  <div className="flex h-full flex-col justify-between bg-[#14171A] p-5 text-white">
                    <div>
                      {/* TYPE BADGE: LES OF PAKKET */}
                      <div className="flex items-start justify-between gap-4">
                        <span
                          className={`px-3 py-1 font-display text-xs ${
                            item.type === "package"
                              ? "bg-[#D6FF3F] text-[#14171A]"
                              : "bg-[#FF4B3E] text-white"
                          }`}
                        >
                          {item.type === "package" ? "LESPAKKET" : "LOSSE LES"}
                        </span>

                        {item.trainerRating ? (
                          <span className="font-display text-sm text-[#D6FF3F]">
                            {item.trainerRating.toFixed(1)} ★
                          </span>
                        ) : (
                          <span className="font-display text-xs text-[#8A8F94]">NEW</span>
                        )}
                      </div>

                      {/* TRAINER & TITEL */}
                      <div className="pt-5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#D6FF3F] bg-[#14171A] font-display text-sm text-[#D6FF3F]">
                            {item.trainerInitials}
                          </div>
                          <div>
                            <p className="font-display text-lg leading-none text-white">
                              {item.trainerName}
                            </p>
                            <p className="mt-1 text-[11px] text-[#B9BEC2]">
                              {item.sport}
                            </p>
                          </div>
                        </div>

                        <h3 className="mt-4 min-h-[3.5rem] font-display text-2xl text-[#D6FF3F] line-clamp-2">
                          {item.titleOrFocus}
                        </h3>

                        <p className="mt-2 text-xs text-white">
                          🗓️ {item.dateLabel}
                        </p>

                        <p className="mt-1 text-xs text-[#B9BEC2] truncate">
                          📍 {item.locationLabel}
                        </p>
                      </div>
                    </div>

                    {/* PRIJS & CTA */}
                    <div className="mt-6 border-t border-white/20 pt-4">
                      <div className="flex items-end justify-between">
                        <div>
                          <span className="block text-[10px] text-[#8A8F94]">PRIJS</span>
                          <span className="font-display text-3xl text-[#D6FF3F]">
                            {item.priceLabel}
                          </span>
                          {item.subPriceLabel && (
                            <span className="block text-[10px] text-[#B9BEC2]">
                              {item.subPriceLabel}
                            </span>
                          )}
                        </div>

                        <a
                          href={item.href}
                          className="bg-[#FF4B3E] px-6 py-3 font-display text-base text-white transition group-hover:bg-[#D6FF3F] group-hover:!text-[#14171A]"
                        >
                          GOW! →
                        </a>
                      </div>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              /* FALLBACK KAARTEN */
              <>
                <article className="w-[320px] shrink-0 border-2 border-[#14171A] bg-white p-4">
                  <div className="bg-[#14171A] p-5 text-white">
                    <span className="bg-[#D6FF3F] px-3 py-1 font-display text-xs text-[#14171A]">TOM PEETERS</span>
                    <h3 className="font-display text-3xl mt-4">TOM PEETERS</h3>
                    <p className="text-sm text-[#B9BEC2]">Padel · Tactiek &amp; Gevorderden</p>
                    <a href="/trainers" className="mt-6 block bg-[#FF4B3E] py-3 text-center font-display text-lg text-white">BEKIJK TRAINER →</a>
                  </div>
                </article>
                <article className="w-[320px] shrink-0 border-2 border-[#14171A] bg-white p-4">
                  <div className="bg-[#14171A] p-5 text-white">
                    <span className="bg-[#FF4B3E] px-3 py-1 font-display text-xs text-white">SARAH VERMEULEN</span>
                    <h3 className="font-display text-3xl mt-4">SARAH VERMEULEN</h3>
                    <p className="text-sm text-[#B9BEC2]">Tennis · Beginners &amp; Techniek</p>
                    <a href="/trainers" className="mt-6 block bg-[#FF4B3E] py-3 text-center font-display text-lg text-white">BEKIJK TRAINER →</a>
                  </div>
                </article>
              </>
            )}
          </div>

          <div className="mt-10 text-center">
            <a
              href="/trainers"
              className="inline-flex items-center gap-3 border-2 border-[#14171A] px-7 py-4 font-display text-lg text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
            >
              BEKIJK ALLE TRAINERS &amp; AANBOD
              <span aria-hidden="true" className="text-inherit">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* VOOR TRAINERS */}
      <section
        id="trainers"
        className="relative overflow-hidden bg-[#FF4B3E] py-20 text-white sm:py-28"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-24 select-none font-display text-[19rem] leading-none text-white opacity-[0.1] sm:text-[28rem]"
        >
          +
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_0.85fr] lg:items-end">
          <div>
            <p className="font-display text-lg text-[#14171A]">
              VOOR TRAINERS
            </p>

            <h2 className="mt-4 max-w-3xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
              MEER LESGEVEN.<br />
              MINDER GEDOE.
            </h2>

            <p className="mt-8 max-w-xl text-lg leading-relaxed text-white/90 sm:text-xl">
              GowTrain helpt je zichtbaar te worden, je agenda te vullen en boekingen overzichtelijk te houden. Geen abonnementen, slechts 5% commissie per les.
            </p>

            <a
              href="/trainer-worden"
              className="mt-9 inline-flex items-center gap-4 bg-[#14171A] px-7 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
            >
              WORD TRAINER. GOW! <span aria-hidden="true">→</span>
            </a>
          </div>

          <div className="border-2 border-[#14171A] bg-[#14171A] p-6 sm:p-8 shadow-[8px_8px_0_0_#14171A]">
            <p className="font-display text-3xl text-[#D6FF3F]">
              JIJ FOCUST OP DE BAAN.
            </p>

            <ul className="mt-8 space-y-5">
              {trainerBenefits.map((benefit, index) => (
                <li key={benefit} className="flex gap-4 text-lg leading-snug">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-[#D6FF3F] font-display text-sm text-[#14171A]">
                    0{index + 1}
                  </span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>

            <div className="mt-9 border-t border-white/20 pt-6">
              <p className="font-display text-xl text-[#D7D9DA]">
                JOUW AGENDA. JOUW PROFIEL. JOUW GROWTH.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* OVER GOWTRAIN */}
      <section
        id="over-gowtrain"
        className="bg-[#14171A] py-20 text-white sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                OVER GOWTRAIN
              </p>

              <h2 className="mt-4 font-display text-6xl leading-[0.83] sm:text-7xl">
                KLAAR?<br />
                GOW!
              </h2>
            </div>

            <div className="max-w-2xl">
              <p className="text-xl leading-relaxed text-[#E3E5E6] sm:text-2xl">
                GowTrain brengt padel- en tennistrainers en spelers direct samen op één platform. Snel zoeken, transparant vergelijken en boeken zonder omwegen.
              </p>

              <div className="mt-12 grid gap-5 sm:grid-cols-2">
                <div className="border-l-2 border-[#D6FF3F] pl-5">
                  <p className="font-display text-4xl text-[#D6FF3F]">
                    DIRECT
                  </p>
                  <p className="mt-2 leading-relaxed text-[#B9BEC2]">
                    Van zoeken naar boeken in een paar tikken.
                  </p>
                </div>

                <div className="border-l-2 border-[#FF4B3E] pl-5">
                  <p className="font-display text-4xl text-[#FF4B3E]">
                    BETROUWBAAR
                  </p>
                  <p className="mt-2 leading-relaxed text-[#B9BEC2]">
                    Duidelijke afspraken, transparante prijzen en geverifieerde profielen.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EIND CTA */}
      <section className="bg-white py-20 text-[#14171A] sm:py-28">
        <div className="mx-auto flex max-w-7xl flex-col items-center px-5 text-center sm:px-8">
          <p className="font-display text-lg text-[#FF4B3E]">
            DOWNLOAD DE APP. GOW!
          </p>

          <h2 className="mt-4 w-full max-w-5xl font-display text-6xl leading-[0.83] sm:text-7xl lg:text-8xl">
            <span className="block text-center">JOUW VOLGENDE</span>
            <span className="block text-center">TRAINING BEGINT HIER.</span>
          </h2>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="#"
              className="inline-flex w-full items-center justify-center gap-4 bg-[#FF4B3E] px-8 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#14171A] hover:!text-white sm:w-auto"
            >
              DOWNLOAD VOOR IOS
              <span aria-hidden="true" className="text-inherit">→</span>
            </a>

            <a
              href="#"
              className="inline-flex w-full items-center justify-center gap-4 border-2 border-[#14171A] px-8 py-5 font-display text-xl text-[#14171A] transition hover:-translate-y-1 hover:bg-[#14171A] hover:!text-white sm:w-auto"
            >
              DOWNLOAD VOOR ANDROID
              <span aria-hidden="true" className="text-inherit">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <SiteFooter />
    </main>
  );
}