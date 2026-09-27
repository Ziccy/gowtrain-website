"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type Item = {
  id: string;
  booking_id: string;
  channel: string;
  status: string;
  amount_cents: number;
  currency: string;
  stripe_livemode: boolean;
  reservation_expires_at: string;
  first_stripe_request_at: string | null;
  payment_verified_at: string | null;
  booking_confirmed_at: string | null;
  cancellation_verified_at: string | null;
  review_code: string | null;
  created_at: string;
  updated_at: string;
};

type Filter = "review" | "unfinished";

const STATUS_LABELS: Record<string, string> = {
  reserved: "Gereserveerd; aanmaak nog niet voorbereid",
  creating: "Stripe-aanmaak voorbereid; koppeling nog niet bevestigd",
  open: "Betaalobject gekoppeld",
  processing: "In verwerking",
  needs_review: "Handmatige beoordeling nodig",
  succeeded: "Betaling toegepast op boeking",
  cancelled: "Betaalpoging afgesloten",
};

const REVIEW_LABELS: Record<string, string> = {
  EXISTING_PAYMENT_REVIEW:
    "Er stond al een betaaluitzondering open.",
  PAYMENT_AFTER_ATTEMPT_CLOSURE:
    "Een geslaagde betaling is gevonden bij een eerder afgesloten of afwijkende poging.",
  REFUND_OR_DISPUTE_REQUIRES_REVIEW:
    "De betaling bevat een refund, dispute of niet bevestigde controle daarvan.",
  BOOKING_CONTEXT_CHANGED:
    "De boekingskoppeling, prijs of deelnemersgegevens wijken af.",
  BOOKING_STATE_REQUIRES_REVIEW:
    "De boeking heeft een status of betaalreferentie die automatische bevestiging verhindert.",
  RESERVATION_CONTEXT_CHANGED:
    "Het slot of de reserveringsplanning is gewijzigd.",
  PAYMENT_APPLICATION_AFTER_LESSON_START:
    "De betaling werd verwerkt nadat de les al gestart was.",
  BOOKING_TERMS_OR_AMOUNTS_CHANGED:
    "De vastgelegde voorwaarden of financiële verdeling wijken af.",
  CONFLICTING_SLOT_BOOKING:
    "Er bestaat een andere relevante boeking voor hetzelfde tijdslot.",
  PAYMENT_LINKED_TO_OTHER_BOOKING:
    "De PaymentIntent staat bij een andere boeking geregistreerd.",
  EXISTING_REFUND_REGISTRATION:
    "Er bestaat al een refundregistratie voor deze les.",
};

function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "Niet vastgelegd";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export default function SingleLessonPaymentsPage() {
  const [filter, setFilter] = useState<Filter>("review");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Item[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const sequence = useRef(0);

  const load = useCallback(async () => {
    const run = ++sequence.current;

    setLoading(true);
    setError("");
    setItems([]);
    setHasMore(false);
    setCheckedAt(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Log in met je beheeraccount.");
      }

      const response = await fetch(
        `/api/admin/single-lesson-payments?filter=${filter}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Het overzicht kon niet worden geladen."
        );
      }

      if (
        !body ||
        !Array.isArray(body.items) ||
        typeof body.hasMore !== "boolean" ||
        typeof body.checkedAt !== "string" ||
        !Number.isFinite(Date.parse(body.checkedAt))
      ) {
        throw new Error("Het overzicht heeft een ongeldig formaat.");
      }

      if (sequence.current !== run) return;

      setItems(body.items as Item[]);
      setHasMore(body.hasMore);
      setCheckedAt(body.checkedAt);
    } catch (caught: unknown) {
      if (sequence.current === run) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Het overzicht kon niet worden geladen."
        );
      }
    } finally {
      if (sequence.current === run) {
        setLoading(false);
      }
    }
  }, [filter, page]);

  useEffect(() => {
    void load();

    return () => {
      sequence.current += 1;
    };
  }, [load]);

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-10 sm:py-14">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="font-display text-lg text-[#FF4B3E]">
            ADMIN · LOSSE-LESBETALINGEN
          </p>

          <h1 className="mt-3 font-display text-4xl sm:text-5xl">
            BETALINGEN &amp; UITZONDERINGEN.
          </h1>

          <div className="mt-6 border border-white/25 p-4 text-sm leading-relaxed text-[#B9BEC2]">
            <p>
              Dit overzicht toont uitsluitend de nieuwe betaalregistratie
              voor losse lessen. Oude webbetalingen en pakketaankopen
              vallen er niet onder.
            </p>

            <p className="mt-3">
              Een verlopen reservering of oude voorbereiding bewijst
              niet dat een betaling mislukt is. Maak niet zomaar een
              nieuwe PaymentIntent, geef geen slot handmatig vrij en
              start geen refund zonder de actuele Stripe-uitkomst en
              boekingsadministratie te controleren.
            </p>

            <p className="mt-3">
              Dit scherm leest alleen gegevens. Het verstuurt geen
              waarschuwingen en biedt nog geen herstelacties.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/admin"
              className="border border-white/30 px-4 py-3 font-display text-sm"
            >
              ← ADMIN HUB
            </Link>

            <select
              aria-label="Betaaloverzicht filteren"
              value={filter}
              disabled={loading}
              onChange={(event) => {
                const next = event.target.value;

                if (next === "review" || next === "unfinished") {
                  setPage(1);
                  setFilter(next);
                }
              }}
              className="min-h-11 border border-white/30 bg-[#14171A] px-3 py-2 text-sm"
            >
              <option value="review">Handmatige beoordeling</option>
              <option value="unfinished">Alle niet-afgeronde pogingen</option>
            </select>

            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
              className="bg-[#D6FF3F] px-5 py-3 font-display text-sm text-[#14171A] disabled:opacity-50"
            >
              {loading ? "LADEN…" : "VERVERS"}
            </button>
          </div>

          {checkedAt && (
            <p className="mt-4 text-xs text-[#8A8F94]">
              Momentopname: {formatDate(checkedAt)} (Amsterdam).
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-6 border border-[#FF4B3E] p-4"
            >
              {error}
            </p>
          )}

          {loading ? (
            <p role="status" className="py-8 text-[#D6FF3F]">
              Betaalregistraties laden…
            </p>
          ) : !error && items.length === 0 ? (
            <p className="py-8 text-sm text-[#B9BEC2]">
              Geen registraties voor dit filter op deze pagina.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              {items.map((item) => {
                const expiredAtRead =
                  checkedAt !== null &&
                  Date.parse(item.reservation_expires_at) <=
                    Date.parse(checkedAt);

                const phases: Array<[string, string | null]> = [
                  ["Registratie aangemaakt", item.created_at],
                  ["Reserveringstermijn", item.reservation_expires_at],
                  ["Stripe-aanmaak voorbereid", item.first_stripe_request_at],
                  ["Geslaagde betaling vastgesteld", item.payment_verified_at],
                  ["Boeking bevestigd", item.booking_confirmed_at],
                  ["Afsluiting vastgesteld", item.cancellation_verified_at],
                  ["Registratie bijgewerkt", item.updated_at],
                ];

                return (
                  <article
                    key={item.id}
                    className={`border p-5 ${
                      item.status === "needs_review"
                        ? "border-[#FF4B3E]"
                        : "border-white/25"
                    }`}
                  >
                    <div className="flex flex-wrap justify-between gap-4">
                      <div>
                        <h2 className="font-display text-xl text-[#D6FF3F]">
                          {STATUS_LABELS[item.status] ?? item.status}
                        </h2>

                        <p className="mt-2 text-sm text-[#B9BEC2]">
                          {item.stripe_livemode ? "LIVE" : "TEST"} ·{" "}
                          {item.channel}
                        </p>
                      </div>

                      <p className="font-display text-2xl">
                        {formatAmount(item.amount_cents, item.currency)}
                      </p>
                    </div>

                    <p className="mt-4 break-all text-xs text-[#B9BEC2]">
                      Boeking: {item.booking_id}
                    </p>

                    <p className="mt-1 break-all text-xs text-[#B9BEC2]">
                      Betaalpoging: {item.id}
                    </p>

                    {item.review_code && (
                      <div className="mt-4 border-l-2 border-[#FF4B3E] pl-3">
                        <p className="text-sm text-[#FFB4AC]">
                          {REVIEW_LABELS[item.review_code] ??
                            "Controleer de opgeslagen technische reden."}
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-[#B9BEC2]">
                          {item.review_code}
                        </p>
                      </div>
                    )}

                    {item.payment_verified_at &&
                    !item.booking_confirmed_at ? (
                      <p className="mt-4 text-sm text-[#FFB4AC]">
                        Een geslaagde betaling is vastgelegd, maar deze
                        registratie bevestigt geen geboekte les.
                        Afzonderlijke afhandeling is nodig.
                      </p>
                    ) : null}

                    {expiredAtRead && (
                      <p className="mt-4 text-sm text-[#B9BEC2]">
                        De reserveringstermijn is verstreken. Dit is
                        geen bewijs dat het betaalobject is afgesloten
                        of dat het slot veilig vrijgegeven kan worden.
                      </p>
                    )}

                    <dl className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
                      {phases.map(([title, value]) => (
                        <div key={title}>
                          <dt className="text-[#8A8F94]">{title}</dt>
                          <dd className="mt-1">{formatDate(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                );
              })}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              type="button"
              disabled={loading || page === 1}
              onClick={() => setPage((value) => value - 1)}
              className="border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-40"
            >
              ← VORIGE
            </button>

            <p className="text-sm">Pagina {page}</p>

            <button
              type="button"
              disabled={loading || !hasMore}
              onClick={() => setPage((value) => value + 1)}
              className="border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-40"
            >
              VOLGENDE →
            </button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}