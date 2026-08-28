"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

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

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function BookingSuccesContent() {
  const searchParams = useSearchParams();
  const checkoutSessionId = searchParams.get("session_id");

  const [booking, setBooking] = useState<Booking | null>();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!checkoutSessionId) {
      setLoading(false);
      setErrorMessage("De betaalbevestiging kon niet worden gevonden.");
      return;
    }

    void loadBooking(checkoutSessionId);
  }, [checkoutSessionId]);

  async function loadBooking(sessionId: string): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
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

            trainers (
              id,
              name
            ),

            availability_slots (
              starts_at,
              ends_at,
              sport,

              venues (
                name,
                city,
                address_line,
                postal_code
              )
            )
          `
        )
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();

      if (error) {
        console.error("Bevestigde booking ophalen fout:", error.message);

        setErrorMessage(
          "Je boekingsbevestiging kon niet worden geladen. Controleer Mijn boekingen."
        );

        return;
      }

      if (!data) {
        setErrorMessage(
          "Je betaling wordt nog verwerkt. Vernieuw deze pagina over een paar seconden."
        );

        return;
      }

      setBooking(data as unknown as Booking);
    } catch (error) {
      console.error("Onverwachte bevestigingsfout:", error);

      setErrorMessage(
        "Je boekingsbevestiging kon niet worden geladen. Controleer Mijn boekingen."
      );
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="text-center">
          <p className="font-display text-5xl text-[#D6FF3F]">GOW!</p>

          <p className="mt-4 font-display text-lg text-[#FF4B3E]">
            BETALING CONTROLEREN...
          </p>
        </div>
      </main>
    );
  }

  const isConfirmed = booking?.status === "confirmed";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link
            href="/"
            className="group inline-flex items-center gap-2"
            aria-label="Terug naar GowTrain home"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>

            <span
              aria-hidden="true"
              className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform group-hover:translate-x-1"
            />
          </Link>

          <Link
            href="/mijn-boekingen"
            className="font-display text-sm text-white transition hover:text-[#D6FF3F]"
          >
            MIJN BOEKINGEN →
          </Link>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-3xl">
          {isConfirmed && booking?.availability_slots ? (
            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E] sm:p-8">
              <p className="font-display text-lg">BETAALD. BEVESTIGD.</p>

              <h1 className="mt-4 font-display text-5xl leading-[0.85] sm:text-6xl">
                JE STAAT
                <br />
                OP DE BAAN.
              </h1>

              <p className="mt-6 max-w-2xl text-lg font-semibold leading-relaxed">
                Je training bij {booking.trainers?.name || "je trainer"} is
                definitief geboekt. Tijd om te Gow!en.
              </p>

              <div className="mt-8 border-y-2 border-[#14171A]/20 py-5">
                <p className="font-display text-2xl">
                  {formatDate(booking.availability_slots.starts_at)}
                </p>

                <p className="mt-2 font-display text-4xl">
                  {formatTime(booking.availability_slots.starts_at)} –{" "}
                  {formatTime(booking.availability_slots.ends_at)}
                </p>

                <p className="mt-4 font-display text-lg">
                  {booking.availability_slots.sport.toUpperCase()} ·{" "}
                  {booking.participant_count}{" "}
                  {booking.participant_count === 1 ? "SPELER" : "SPELERS"}
                </p>

                <p className="mt-2 font-display text-2xl">
                  {formatEuro(
                    booking.total_price_cents,
                    booking.currency
                  )}
                </p>

                <p className="mt-1 text-sm font-semibold">
                  Inclusief training en baanhuur.
                </p>
              </div>

              {booking.availability_slots.venues ? (
                <div className="mt-6">
                  <p className="font-display text-sm">LOCATIE</p>

                  <p className="mt-2 font-display text-xl">
                    {booking.availability_slots.venues.city.toUpperCase()} —{" "}
                    {booking.availability_slots.venues.name}
                  </p>

                  <p className="mt-2 font-semibold leading-relaxed">
                    {booking.availability_slots.venues.address_line}
                    <br />
                    {booking.availability_slots.venues.postal_code
                      ? `${booking.availability_slots.venues.postal_code} `
                      : ""}
                    {booking.availability_slots.venues.city}
                  </p>
                </div>
              ) : null}

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/mijn-boekingen"
                  className="inline-flex items-center justify-center bg-[#14171A] px-5 py-4 font-display text-base !text-white transition hover:bg-white hover:!text-[#14171A]"
                >
                  MIJN BOEKINGEN →
                </Link>

                <Link
                  href="/trainers"
                  className="inline-flex items-center justify-center border-2 border-[#14171A] bg-transparent px-5 py-4 font-display text-base !text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
                >
                  BEKIJK MEER TRAINERS
                </Link>
              </div>
            </div>
          ) : (
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-6 text-white sm:p-8">
                <p className="font-display text-lg text-[#FF4B3E]">
                  BETALING WORDT VERWERKT
                </p>

                <h1 className="mt-4 font-display text-5xl leading-[0.85] sm:text-6xl">
                  NOG HEEL
                  <br />
                  EVEN.
                </h1>

                <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#B9BEC2]">
                  {errorMessage ||
                    "Je betaling wordt gecontroleerd. Vernieuw deze pagina over een paar seconden of bekijk Mijn boekingen."}
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      if (checkoutSessionId) {
                        void loadBooking(checkoutSessionId);
                      }
                    }}
                    className="bg-[#D6FF3F] px-5 py-4 font-display text-base !text-[#14171A] font-bold transition hover:bg-white"
                  >
                    ↻ OPNIEUW CONTROLEREN
                  </button>

                  <Link
                    href="/mijn-boekingen"
                    className="inline-flex items-center justify-center border-2 border-white bg-transparent px-5 py-4 font-display text-base !text-white transition hover:bg-white hover:!text-[#14171A]"
                  >
                    MIJN BOEKINGEN →
                  </Link>
                </div>
              </div>
            </div>
          )}
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

        <p className="mt-4 font-display text-lg text-[#FF4B3E]">
          BETALING CONTROLEREN...
        </p>
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