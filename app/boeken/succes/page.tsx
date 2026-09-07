"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

import {
  getWhatsAppShareUrl,
  getGoogleCalendarUrl,
  downloadIcsFile,
} from "@/lib/calendar-share";

type BookingStatus =
  | "payment_pending"
  | "confirmed"
  | "cancelled"
  | "refunded"
  | "completed";

type Booking = {
  id: string;
  status: BookingStatus;
  participant_count: number;
  total_price_cents: number;
  currency: string;
  paid_at: string | null;

  trainers: {
    id: string;
    name: string;
  } | null;

  availability_slots: {
    starts_at: string;
    ends_at: string;
    sport: string;

    venues: {
      name: string;
      city: string;
      address_line: string;
      postal_code: string | null;
    } | null;
  } | null;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
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

function BookingSuccesContent() {
  const searchParams = useSearchParams();
  const checkoutSessionId = searchParams.get("session_id");
  const packageId = searchParams.get("package_id");

  const [booking, setBooking] = useState<Booking | null>();
  const [isPackage, setIsPackage] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void verifyAndLoadConfirmation();
  }, [checkoutSessionId, packageId]);

  async function verifyAndLoadConfirmation(): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (packageId && userId) {
        setIsPackage(true);

        await supabase.rpc("confirm_package_purchase", {
          p_package_id: packageId,
          p_player_id: userId,
        });

        const { data: packageBooking } = await supabase
          .from("bookings")
          .select(
            `
              id,
              status,
              participant_count,
              total_price_cents,
              currency,
              paid_at,
              trainers ( id, name ),
              availability_slots!inner (
                starts_at,
                ends_at,
                sport,
                package_id,
                venues ( name, city, address_line, postal_code )
              )
            `
          )
          .eq("player_id", userId)
          .eq("availability_slots.package_id", packageId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (packageBooking) {
          setBooking(packageBooking as unknown as Booking);
        }
        setLoading(false);
        return;
      }

      if (checkoutSessionId) {
        const { data, error } = await supabase
          .from("bookings")
          .select(
            `
              id,
              status,
              participant_count,
              total_price_cents,
              currency,
              paid_at,
              trainers ( id, name ),
              availability_slots (
                starts_at,
                ends_at,
                sport,
                venues ( name, city, address_line, postal_code )
              )
            `
          )
          .eq("stripe_checkout_session_id", checkoutSessionId)
          .maybeSingle();

        if (error || !data) {
          setErrorMessage("Je betaling wordt verwerkt.");
          return;
        }

        setBooking(data as unknown as Booking);
      }
    } catch (error) {
      console.error("Onverwachte bevestigingsfout:", error);
      setErrorMessage("Je boekingsbevestiging kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F]">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">BETALING CONTROLEREN...</p>
        </div>
      </main>
    );
  }

  const isConfirmed = isPackage || booking?.status === "confirmed";

  // Data voor WhatsApp & Agenda
  const slot = booking?.availability_slots;
  const trainerName = booking?.trainers?.name || "de trainer";
  const venueName = slot?.venues ? `${slot.venues.city} — ${slot.venues.name}` : "de club";
  const dateLabel = slot ? formatDate(slot.starts_at) : "";
  const timeLabel = slot ? `${formatTime(slot.starts_at)} - ${formatTime(slot.ends_at)}` : "";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* 💡 UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:py-16">
        <div className="w-full max-w-7xl">
          <div className="mx-auto max-w-3xl">
            {isConfirmed ? (
              <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-8">
                <p className="font-display text-lg">
                  {isPackage ? "LESPAKKET GEBOEKT!" : "BETAALD. BEVESTIGD."}
                </p>

                <h1 className="mt-3 font-display text-5xl leading-[0.85] sm:text-6xl">
                  JE STAAT<br />OP DE BAAN.
                </h1>

                <p className="mt-5 max-w-2xl text-base font-semibold leading-relaxed">
                  {isPackage
                    ? `Gefeliciteerd! Je hebt je lespakket bij ${trainerName} succesvol afgerekend. Alle lessen van jouw traject staan in je overzicht.`
                    : `Je training bij ${trainerName} is definitief geboekt. Tijd om te Gow!en.`}
                </p>

                {slot && (
                  <div className="mt-6 border-y-2 border-[#14171A]/20 py-5">
                    <p className="font-display text-xs text-[#FF4B3E]">EERSTE LES VAN JOUW TRAJECT</p>
                    <p className="mt-1 font-display text-xl">{formatDate(slot.starts_at)}</p>
                    <p className="mt-1 font-display text-3xl">
                      {formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}
                    </p>
                  </div>
                )}

                {/* WHATSAPP & AGENDA KNOPPEN BLOK */}
                {slot && (
                  <div className="mt-6 space-y-3">
                    <p className="font-display text-xs text-[#14171A] opacity-80 uppercase">DEEL OF BEWAAR JE LES:</p>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <a
                        href={getWhatsAppShareUrl(trainerName, slot.sport, dateLabel, timeLabel, venueName)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 bg-[#14171A] px-4 py-3.5 font-display text-sm !text-white transition hover:bg-white hover:!text-[#14171A]"
                      >
                        DEEL VIA WHATSAPP
                      </a>

                      <a
                        href={getGoogleCalendarUrl(
                          `GowTrain ${slot.sport.toUpperCase()} les bij ${trainerName}`,
                          slot.starts_at,
                          slot.ends_at,
                          venueName,
                          `GowTrain les bij ${trainerName} op ${venueName}.`
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 border-2 border-[#14171A] bg-transparent px-4 py-3.5 font-display text-sm !text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
                      >
                        ZET IN GOOGLE CALENDAR
                      </a>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        downloadIcsFile(
                          `GowTrain ${slot.sport.toUpperCase()} les bij ${trainerName}`,
                          slot.starts_at,
                          slot.ends_at,
                          venueName,
                          `GowTrain les bij ${trainerName} op ${venueName}.`
                        )
                      }
                      className="w-full text-center font-display text-xs text-[#14171A] underline underline-offset-4 hover:text-[#FF4B3E]"
                    >
                      Download .ics voor Apple Calendar / Outlook
                    </button>
                  </div>
                )}

                {/* NAVIGATIE */}
                <div className="mt-8 pt-4 border-t-2 border-[#14171A]/20 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/mijn-boekingen"
                    className="inline-flex items-center justify-center bg-[#14171A] px-6 py-4 font-display text-lg !text-white transition hover:bg-white hover:!text-[#14171A]"
                  >
                    BEKIJK AL JE LESDATUMS →
                  </Link>

                  <Link
                    href="/trainers"
                    className="inline-flex items-center justify-center border-2 border-[#14171A] bg-transparent px-5 py-4 font-display text-base !text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
                  >
                    MEER TRAINERS
                  </Link>
                </div>

              </div>
            ) : (
              <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E]">
                <div className="bg-[#14171A] p-6 text-white sm:p-8">
                  <p className="font-display text-lg text-[#FF4B3E]">BETALING WORDT VERWERKT</p>
                  <h1 className="mt-3 font-display text-5xl leading-[0.83]">NOG HEEL EVEN...</h1>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-[#B9BEC2]">
                    {errorMessage || "Je betaling wordt gecontroleerd. Bekijk je overzicht op Mijn boekingen."}
                  </p>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/mijn-boekingen"
                      className="inline-flex items-center justify-center bg-[#D6FF3F] px-6 py-4 font-display text-lg !text-[#14171A] font-bold"
                    >
                      NAAR MIJN BOEKINGEN →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function BookingSuccesFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
      <div className="text-center">
        <p className="font-display text-5xl text-[#D6FF3F]">GOW!</p>
        <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">BETALING CONTROLEREN...</p>
      </div>
    </main>
  );
}

export default function BookingSuccesPage() {
  return (
    <Suspense fallback={<BookingSuccesFallback />}>
      <BookingSuccesContent />
    </Suspense>
  );
}