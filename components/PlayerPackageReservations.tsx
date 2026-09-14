"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type PackageReservation = {
  attemptId: string;
  packageId: string;
  packageTitle: string;
  lessonCount: number | null;
  status: string;
  checkoutMode: string;
  totalPriceCents: number;
  currency: string;
  reservationExpiresAt: string;
  stripeSessionExpiresAt: string | null;
  createdAt: string;
  canResume: boolean;
  resumeUrl: string | null;
};

type Props = {
  refreshing?: boolean;
};

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDeadline(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Onbekend";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function canResumeNow(
  reservation: PackageReservation,
  now: number
): boolean {
  if (
    !reservation.canResume ||
    reservation.checkoutMode !== "embedded" ||
    !["reserved", "open"].includes(reservation.status)
  ) {
    return false;
  }

  const deadline = Date.parse(reservation.reservationExpiresAt);

  if (!Number.isFinite(deadline) || deadline <= now) {
    return false;
  }

  if (reservation.status === "open") {
    const sessionDeadline = Date.parse(
      reservation.stripeSessionExpiresAt ?? ""
    );

    if (
      !Number.isFinite(sessionDeadline) ||
      sessionDeadline <= now
    ) {
      return false;
    }
  }

  return true;
}

function getExplanation(
  reservation: PackageReservation,
  canResume: boolean
): string {
  if (canResume) {
    return "Dit pakket is voor jou gereserveerd. Hervat je betaling om de aankoop af te ronden.";
  }

  if (reservation.status === "payment_processing") {
    return "De betaling is nog in verwerking. Start geen nieuwe betaling. Controleer over even opnieuw.";
  }

  if (reservation.status === "creating") {
    return "De uitkomst van het openen van de betaalpagina moet nog worden gecontroleerd. Dit betekent niet automatisch dat er is betaald.";
  }

  if (reservation.status === "review_required") {
    return "Deze betaalpoging heeft aanvullende controle nodig. Neem contact op met Gowtrain voordat je opnieuw betaalt.";
  }

  if (reservation.checkoutMode !== "embedded") {
    return "Deze reservering gebruikt een andere betaalweergave. Deze pagina kan die betaling momenteel niet hervatten.";
  }

  return "De reserveringstermijn is verstreken of kan niet worden vastgesteld. De definitieve betaalstatus moet nog worden gecontroleerd. Heb je betaald? Betaal dan niet opnieuw.";
}

export default function PlayerPackageReservations({
  refreshing = false,
}: Props) {
  const [reservations, setReservations] =
    useState<PackageReservation[]>([]);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  /*
   * Werk de deadlineweergave bij zonder steeds de API aan te roepen.
   */
  useEffect(() => {
    const updateClock = () => setNow(Date.now());

    const interval = window.setInterval(updateClock, 10_000);
    window.addEventListener("focus", updateClock);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateClock);
    };
  }, []);

  /*
   * Laden bij openen, bij de eigen herlaadknop en zodra
   * de algemene knop 'Ververs' klaar is.
   */
  useEffect(() => {
    if (refreshing) return;

    let cancelled = false;
    const controller = new AbortController();

    async function loadReservations(): Promise<void> {
      setLoading(true);
      setErrorMessage("");

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (cancelled) return;

        if (sessionError || !session?.access_token) {
          setReservations([]);
          setErrorMessage(
            "Log opnieuw in om je pakketreserveringen te bekijken."
          );
          return;
        }

        const response = await fetch("/api/package-reservations", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
          signal: controller.signal,
        });

        const result = (await response.json()) as {
          reservations?: PackageReservation[];
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(
            result.error ||
              "Je pakketreserveringen konden niet worden geladen."
          );
        }

        if (!Array.isArray(result.reservations)) {
          throw new Error(
            "De server gaf geen geldig reserveringsoverzicht terug."
          );
        }

        setReservations(result.reservations);
        setNow(Date.now());
      } catch (error: unknown) {
        if (cancelled) return;

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Je pakketreserveringen konden niet worden geladen."
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReservations();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshing, reloadCount]);

  if (
    !loading &&
    !refreshing &&
    !errorMessage &&
    reservations.length === 0
  ) {
    return null;
  }

  const busy = loading || refreshing;

  return (
    <section className="mt-10" aria-labelledby="package-reservations-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="package-reservations-title"
          className="font-display text-lg text-[#FF4B3E]"
        >
          JE PAKKETRESERVERINGEN
        </h2>

        <button
          type="button"
          disabled={busy}
          onClick={() => setReloadCount((value) => value + 1)}
          className="border border-white/30 px-3 py-2 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
        >
          {busy ? "CONTROLEREN..." : "↻ CONTROLEER STATUS"}
        </button>
      </div>

      <p className="mt-2 text-sm text-[#B9BEC2]">
        Na succesvolle betaling verschijnen de afzonderlijke lessen
        in je boekingenoverzicht.
      </p>

      {errorMessage && (
        <div
          role="alert"
          className="mt-4 border-2 border-[#FF4B3E] px-4 py-3 text-sm text-white"
        >
          {errorMessage}
        </div>
      )}

      {busy && (
        <p role="status" className="mt-4 text-sm text-[#B9BEC2]">
          Pakketreserveringen controleren...
        </p>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {reservations.map((reservation) => {
          const canResume = canResumeNow(reservation, now);

          const label = canResume
            ? "VOOR JOU GERESERVEERD"
            : reservation.status === "payment_processing"
              ? "BETALING IN VERWERKING"
              : "STATUS NOG TE CONTROLEREN";

          // Bouw de interne link zelf op; gebruik geen willekeurige URL.
          const resumeHref =
            `/boeken/checkout?packageId=${
              encodeURIComponent(reservation.packageId)
            }`;

          return (
            <article
              key={reservation.attemptId}
              className="border-2 border-white bg-white p-3 shadow-[6px_6px_0_0_#FF4B3E]"
            >
              <div className="h-full bg-[#14171A] p-5 text-white">
                <span className="inline-block bg-white px-3 py-1.5 font-display text-xs text-[#14171A]">
                  {label}
                </span>

                <h3 className="mt-4 break-words font-display text-3xl">
                  {reservation.packageTitle}
                </h3>

                <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-y border-white/20 py-4">
                  <p className="text-sm text-[#B9BEC2]">
                    {reservation.lessonCount !== null
                      ? `${reservation.lessonCount} lessen`
                      : "Lespakket"}
                  </p>

                  <div className="text-right">
                    <p className="font-display text-3xl text-[#D6FF3F]">
                      {formatPrice(
                        reservation.totalPriceCents,
                        reservation.currency
                      )}
                    </p>
                    <p className="text-xs text-[#8A8F94]">
                      PAKKETBEDRAG
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-[#D7D9DA]">
                  {getExplanation(reservation, canResume)}
                </p>

                {canResume && (
                  <>
                    <p className="mt-3 text-xs text-[#B9BEC2]">
                      Reservering tot{" "}
                      {formatDeadline(reservation.reservationExpiresAt)}
                      {" "}(Nederlandse tijd).
                    </p>

                    {!busy && !errorMessage && (
                      <Link
                        href={resumeHref}
                        prefetch={false}
                        onClick={(event) => {
                          // Controleer ook op het klikmoment.
                          if (!canResumeNow(reservation, Date.now())) {
                            event.preventDefault();
                            setNow(Date.now());
                          }
                        }}
                        className="mt-6 flex w-full items-center justify-center bg-[#D6FF3F] px-5 py-4 text-center font-display text-lg !text-[#14171A] transition hover:bg-white"
                      >
                        BETALING HERVATTEN →
                      </Link>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}