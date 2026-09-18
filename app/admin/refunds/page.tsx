"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type RefundItem = {
  booking_id: string;
  amount_cents: number;
  booking_found: boolean;
  booking_status: string | null;
  package_purchase_id: string | null;
  booking_amount_cents: number | null;
  booking_currency: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  trainer_payout_status: string | null;
  stripe_transfer_id: string | null;
  trainer_paid_at: string | null;
};

type RefundRow = {
  id: string;
  source_booking_id: string | null;
  source_package_purchase_id: string | null;
  issue_id: string | null;
  reason_code: string;
  requested_by_role: string;
  amount_cents: number;
  currency: string;
  status: string;
  attempts: number;
  max_attempts: number;
  available_at: string;
  created_at: string;
  updated_at: string;
  first_stripe_request_at: string | null;
  last_stripe_check_at: string | null;
  succeeded_at: string | null;
  applied_at: string | null;
  next_reconciliation_at: string;
  stripe_payment_intent_id: string;
  stripe_refund_id: string | null;
  last_error: string | null;
  reconciliation_last_error: string | null;
  attention_reason: string | null;
  items: RefundItem[];
};

type RefundOverview = {
  environment: "sandbox";
  checked_at: string;
  attention_only: boolean;
  limit: number;
  offset: number;
  total_count: number;
  attention_count: number;
  has_more: boolean;
  refunds: RefundRow[];
};

const PAGE_SIZE = 25;

const attentionLabels: Record<string, string> = {
  review_required: "Handmatige beoordeling nodig",
  requires_action: "Stripe vraagt aanvullende actie",
  failed: "Stripe-refund mislukt",
  canceled: "Stripe-refund geannuleerd",
  application_overdue: "Administratieve afronding ontbreekt",
  processing_stuck: "Verwerking lijkt vastgelopen",
  queue_overdue: "Opdracht wacht te lang op verwerking",
  reconciliation_error: "Herstelfout bij lopende refund",
  pending_long: "Refund blijft langer pending",
};

const buttonClass =
  "border-2 border-white/40 px-4 py-2.5 font-display text-sm " +
  "transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Niet geregistreerd";

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) return "Ongeldige datum";

  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function formatMoney(cents: number, currency: string): string {
  if (!Number.isSafeInteger(cents)) return "Ongeldig bedrag";

  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${cents} cent (${currency})`;
  }
}

function processingExplanation(refund: RefundRow): string {
  if (refund.status === "succeeded") {
    return refund.applied_at
      ? "De refund is als geslaagd geregistreerd en administratief toegepast."
      : "De refund is als geslaagd geregistreerd, maar de administratieve afronding ontbreekt. Geen tweede refund aanvragen.";
  }

  if (refund.status === "failed" || refund.status === "canceled") {
    return "Geen succesvolle terugbetaling geregistreerd. Controleer de oorzaak en eventuele terugbetalingsverplichting voordat je een vervolgactie overweegt.";
  }

  if (refund.status === "review_required") {
    return "De verwerking vereist beoordeling. Dit bewijst op zichzelf niet of Stripe wel of geen refund heeft aangemaakt.";
  }

  if (refund.status === "requires_action") {
    return "Stripe vraagt aanvullende actie. De refund is nog niet als succesvol afgerond geregistreerd.";
  }

  if (refund.status === "pending") {
    return "De refund staat bij de laatste synchronisatie op pending. Dat is geen bewijs van mislukking.";
  }

  if (refund.status === "processing") {
    return "De opdracht wordt verwerkt of wacht op herstel van een onderbroken verwerking. Controleer de bestaande registratie.";
  }

  return "De opdracht wacht op verwerking. Er is nog geen succesvolle terugbetaling bevestigd.";
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-[#B9BEC2]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">
        {value ?? "Niet geregistreerd"}
      </dd>
    </div>
  );
}

function RefundCard({ refund }: { refund: RefundRow }) {
  const itemTotal = refund.items.reduce(
    (sum, item) => sum + item.amount_cents,
    0,
  );

  const itemAmountsMatch =
    refund.items.length > 0 && itemTotal === refund.amount_cents;

  const completed =
    refund.status === "succeeded" && Boolean(refund.applied_at);

  return (
    <article className="min-w-0 border-2 border-white/30 bg-white/5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-3xl text-[#D6FF3F]">
            {formatMoney(refund.amount_cents, refund.currency)}
          </p>
          <p className="mt-2 text-sm">
            {refund.source_package_purchase_id
              ? "Refund vanuit pakketaankoop"
              : "Refund vanuit losse boeking"}
          </p>
          <p className="mt-2 break-all text-xs text-[#B9BEC2]">
            {refund.id}
          </p>
        </div>

        <span
          className={`px-3 py-1.5 font-display text-sm ${
            completed
              ? "bg-[#D6FF3F] text-[#14171A]"
              : refund.attention_reason
                ? "bg-[#FF4B3E] text-white"
                : "bg-white text-[#14171A]"
          }`}
        >
          {refund.status}
        </span>
      </div>

      <p className="mt-5 text-sm leading-relaxed">
        {processingExplanation(refund)}
      </p>

      <div
        className={`mt-4 border-l-4 p-3 text-sm ${
          refund.attention_reason
            ? "border-[#FF4B3E] bg-[#FF4B3E]/10"
            : "border-white/30 bg-white/5"
        }`}
      >
        {refund.attention_reason
          ? attentionLabels[refund.attention_reason] ??
            refund.attention_reason
          : "Geen actuele signaleringscategorie. Dit is geen afzonderlijke financiële goedkeuring."}
      </div>

      <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Aangemaakt" value={formatDate(refund.created_at)} />
        <Field label="Redencode" value={refund.reason_code} />
        <Field label="Aangevraagd door rol" value={refund.requested_by_role} />

        <Field
          label="Boeking als betaalbron"
          value={refund.source_booking_id}
        />
        <Field
          label="Pakketaankoop als betaalbron"
          value={refund.source_package_purchase_id}
        />
        <Field label="Probleemmelding" value={refund.issue_id} />

        <Field
          label="Stripe Payment Intent"
          value={refund.stripe_payment_intent_id}
        />
        <Field label="Stripe-refund" value={refund.stripe_refund_id} />
        <Field
          label="Pogingen / maximum"
          value={`${refund.attempts} / ${refund.max_attempts}`}
        />

        <Field
          label="Stripe-aanvraag voorbereid"
          value={formatDate(refund.first_stripe_request_at)}
        />
        <Field
          label="Laatste Stripe-controle"
          value={formatDate(refund.last_stripe_check_at)}
        />
        <Field
          label="Als geslaagd geregistreerd"
          value={formatDate(refund.succeeded_at)}
        />

        <Field
          label="Administratief toegepast"
          value={formatDate(refund.applied_at)}
        />
        <Field
          label="Beschikbaar voor verwerking"
          value={formatDate(refund.available_at)}
        />
        <Field
          label="Opgeslagen herstelplanning"
          value={formatDate(refund.next_reconciliation_at)}
        />
      </dl>

      <p className="mt-4 text-xs leading-relaxed text-[#B9BEC2]">
        De opgeslagen herstelplanning betekent niet dat deze opdracht nog
        wordt geselecteerd. Definitief afgeronde opdrachten en bepaalde
        uitzonderingen vallen buiten de herstelbatch.
      </p>

      {(refund.last_error || refund.reconciliation_last_error) && (
        <div className="mt-6 space-y-4 border border-[#FF4B3E]/60 p-4">
          <p className="font-display text-lg">OPGESLAGEN FOUTMELDINGEN</p>

          {refund.last_error && (
            <div>
              <p className="text-xs font-semibold text-[#B9BEC2]">
                AANVRAAG / VERWERKING
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                {refund.last_error}
              </p>
            </div>
          )}

          {refund.reconciliation_last_error && (
            <div>
              <p className="text-xs font-semibold text-[#B9BEC2]">
                HERSTELCONTROLE
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                {refund.reconciliation_last_error}
              </p>
            </div>
          )}

          <p className="text-xs leading-relaxed text-[#B9BEC2]">
            Een fouttekst kan achterblijven na herstel. Beoordeel deze samen
            met de status en administratieve afronding hierboven.
          </p>
        </div>
      )}

      <details className="mt-6 border-t border-white/20 pt-4">
        <summary className="cursor-pointer font-display text-lg text-[#D6FF3F]">
          LESITEMS ({refund.items.length})
        </summary>

        <p
          className={`mt-4 text-sm ${
            itemAmountsMatch ? "text-[#B9BEC2]" : "text-[#FF4B3E]"
          }`}
        >
          Som van de items: {formatMoney(itemTotal, refund.currency)}.
          {itemAmountsMatch
            ? " Sluit aan op het refundbedrag."
            : " Ontbrekende items of afwijkend totaal: controle nodig."}
        </p>

        <div className="mt-4 space-y-4">
          {refund.items.map((item) => (
            <div key={item.booking_id} className="border border-white/20 p-4">
              {!item.booking_found && (
                <p className="mb-3 font-semibold text-[#FF4B3E]">
                  De gekoppelde boeking ontbreekt.
                </p>
              )}

              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Boeking" value={item.booking_id} />
                <Field label="Boekingsstatus" value={item.booking_status} />
                <Field
                  label="Refunditem"
                  value={formatMoney(item.amount_cents, refund.currency)}
                />
                <Field
                  label="Vastgelegd lesbedrag"
                  value={
                    item.booking_amount_cents !== null &&
                    item.booking_currency
                      ? formatMoney(
                          item.booking_amount_cents,
                          item.booking_currency,
                        )
                      : null
                  }
                />
                <Field
                  label="Pakketaankoop"
                  value={item.package_purchase_id}
                />
                <Field
                  label="Traineruitbetalingsstatus"
                  value={item.trainer_payout_status}
                />
                <Field
                  label="Stripe-transfer"
                  value={item.stripe_transfer_id}
                />
                <Field
                  label="Trainer betaald"
                  value={formatDate(item.trainer_paid_at)}
                />
                <Field
                  label="Les refunded"
                  value={formatDate(item.refunded_at)}
                />
              </dl>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

export default function AdminRefundsPage() {
  const [overview, setOverview] = useState<RefundOverview | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const sequenceRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const sequence = ++sequenceRef.current;

    const isCurrent = () =>
      !disposed && sequence === sequenceRef.current;

    async function load(): Promise<void> {
      setLoading(true);
      setOverview(null);
      setErrorMessage("");
      setAccessDenied(false);

      try {
        /*
         * Geen financiële tabellen rechtstreeks vanuit de browser lezen.
         * De RPC controleert auth.uid() en de actuele adminrol.
         */
        const { data, error } = await supabase.rpc(
          "admin_list_sandbox_refunds",
          {
            p_attention_only: attentionOnly,
            p_limit: PAGE_SIZE,
            p_offset: offset,
          },
        );

        if (!isCurrent()) return;

        if (error) {
          if (error.code === "42501") {
            setAccessDenied(true);
            setErrorMessage(
              "Geen toegang. Log in met een account dat adminrechten heeft.",
            );
            return;
          }

          console.error("Refundoverzicht laden mislukt.", {
            code: error.code,
          });

          throw new Error(
            "Het refundoverzicht kon niet worden geladen. Er is geen financiële actie uitgevoerd.",
          );
        }

        const result = data as RefundOverview | null;

        if (
          !result ||
          result.environment !== "sandbox" ||
          result.attention_only !== attentionOnly ||
          result.offset !== offset ||
          result.limit !== PAGE_SIZE ||
          !Array.isArray(result.refunds) ||
          !Number.isSafeInteger(result.total_count) ||
          !Number.isSafeInteger(result.attention_count) ||
          typeof result.has_more !== "boolean"
        ) {
          throw new Error(
            "De server gaf geen geldig refundoverzicht terug.",
          );
        }

        setOverview(result);
      } catch (error: unknown) {
        if (isCurrent()) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Het refundoverzicht kon niet worden geladen.",
          );
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }

    void load();

    /*
     * Bij een gewijzigde sessie geen eerdere financiële gegevens
     * in beeld houden. Opnieuw autoriseren via de RPC.
     */
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event) => {
        if (
          event === "SIGNED_OUT" ||
          event === "SIGNED_IN" ||
          event === "USER_UPDATED"
        ) {
          sequenceRef.current += 1;
          setOverview(null);
          setLoading(true);
          setRefreshVersion((value) => value + 1);
        }
      },
    );

    return () => {
      disposed = true;
      authListener.subscription.unsubscribe();
    };
  }, [attentionOnly, offset, refreshVersion]);

  function changeFilter(nextAttentionOnly: boolean): void {
    if (loading || nextAttentionOnly === attentionOnly) return;

    setOverview(null);
    setOffset(0);
    setAttentionOnly(nextAttentionOnly);
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                ADMIN / REFUNDS
              </p>
              <h1 className="mt-2 font-display text-5xl sm:text-6xl">
                REFUNDOVERZICHT.
              </h1>
              <p className="mt-4 max-w-2xl text-[#D7D9DA]">
                Alleen-lezenadministratie van sandboxrefunds. Geen nieuwe
                terugbetalingen, statuswijzigingen of trainertransfers.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/admin" className={buttonClass}>
                ← ADMIN HUB
              </Link>
              <Link href="/admin/issues" className={buttonClass}>
                PROBLEEMMELDINGEN
              </Link>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setOverview(null);
                  setRefreshVersion((value) => value + 1);
                }}
                className={buttonClass}
              >
                {loading ? "LADEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          <div className="mt-6 border-l-4 border-[#FF4B3E] bg-white/5 p-4 text-sm leading-relaxed">
            <strong>SANDBOX — ALLEEN LEZEN.</strong> Dit overzicht haalt
            gegevens uit Supabase, niet rechtstreeks uit Stripe. Controleer
            de laatste synchronisatiedatum. Vraag bij een onzekere uitkomst
            niet opnieuw een refund aan.
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={loading}
              aria-pressed={attentionOnly}
              onClick={() => changeFilter(true)}
              className={`${buttonClass} ${
                attentionOnly ? "border-[#D6FF3F] text-[#D6FF3F]" : ""
              }`}
            >
              AANDACHT NODIG
            </button>
            <button
              type="button"
              disabled={loading}
              aria-pressed={!attentionOnly}
              onClick={() => changeFilter(false)}
              className={`${buttonClass} ${
                !attentionOnly ? "border-[#D6FF3F] text-[#D6FF3F]" : ""
              }`}
            >
              ALLE SANDBOXREFUNDS
            </button>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-5">
              <p>{errorMessage}</p>
              {accessDenied && (
                <Link
                  href="/speler-login"
                  className="mt-4 inline-block underline"
                >
                  Naar inloggen
                </Link>
              )}
            </div>
          )}

          {loading && (
            <p role="status" className="mt-8 font-display text-xl">
              REFUNDS LADEN...
            </p>
          )}

          {!loading && overview && (
            <>
              <div className="mt-6 flex flex-wrap justify-between gap-3 text-sm text-[#B9BEC2]">
                <p>
                  Aandacht nodig: <strong>{overview.attention_count}</strong>
                  {" · "}
                  Resultaten binnen filter:{" "}
                  <strong>{overview.total_count}</strong>
                </p>
                <p>
                  Databasecontrole: {formatDate(overview.checked_at)}
                  {" · Nederlandse tijd"}
                </p>
              </div>

              {overview.refunds.length === 0 ? (
                <p className="mt-6 border-2 border-white/20 p-6">
                  {offset > 0
                    ? "Deze pagina bevat geen resultaten meer. Ga terug of vernieuw vanaf de eerste pagina."
                    : attentionOnly
                      ? "Geen refundopdrachten binnen de huidige signaleringscriteria."
                      : "Geen sandboxrefunds gevonden."}
                </p>
              ) : (
                <div className="mt-6 space-y-6">
                  {overview.refunds.map((refund) => (
                    <RefundCard key={refund.id} refund={refund} />
                  ))}
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => {
                    setOverview(null);
                    setOffset((value) => Math.max(0, value - PAGE_SIZE));
                  }}
                  className={buttonClass}
                >
                  ← VORIGE
                </button>

                <span className="text-sm">
                  Pagina {Math.floor(offset / PAGE_SIZE) + 1}
                </span>

                <button
                  type="button"
                  disabled={!overview.has_more}
                  onClick={() => {
                    setOverview(null);
                    setOffset((value) => value + PAGE_SIZE);
                  }}
                  className={buttonClass}
                >
                  VOLGENDE →
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}