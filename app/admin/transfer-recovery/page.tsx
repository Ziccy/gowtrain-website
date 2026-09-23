"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type OtherSourceTransfer = {
  transferId: string;
  destinationAccountId: string | null;
  amountCents: number;
  currency: string;
  amountReversedCents: number;
  fullyReversed: boolean;
  metadataRequestId: string | null;
  metadataBookingId: string | null;
};

type RecoveryScan = {
  check_id: string;
  recorded_at: string;
  checked_at: string;
  finished_at: string;
  scanned_transfer_count: number;
  search_outcome: "verified_match" | "not_found_requires_review";
  own_transfer_id: string | null;
  history_approval_granted: false;
  other_source_transfer_count: number;
  other_source_transfers_truncated: boolean;
  other_source_transfers: OtherSourceTransfer[];
};

type RecoveryCheck = {
  id: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  outcome?: string | null;
  error_code?: string | null;
  stripe_transfer_id?: string | null;
  scan?: RecoveryScan | null;
};

type TransferRow = {
  id: string;
  booking_id: string;
  trainer_id: string;
  source_package_purchase_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  locked_until: string | null;
  first_stripe_request_at: string | null;
  last_stripe_check_at: string | null;
  stripe_transfer_id: string | null;
  succeeded_at: string | null;
  applied_at: string | null;
  fully_applied: boolean;
  next_reconciliation_at: string;
  execution_error_code: string | null;
  recovery_error_code: string | null;
  latest_check: RecoveryCheck | null;
  running_check: RecoveryCheck | null;
  attention_reasons: string[];
};

type Overview = {
  environment: "sandbox";
  checked_at: string;
  attention_only: boolean;
  limit: number;
  offset: number;
  total_count: number;
  attention_count: number;
  has_more: boolean;
  requests: TransferRow[];
};

const PAGE_SIZE = 25;

const buttonClass =
  "border-2 border-white/40 px-4 py-2.5 font-display text-sm " +
  "transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const attentionLabels: Record<string, string> = {
  review_required: "Handmatige beoordeling nodig",
  application_missing: "Administratieve toepassing ontbreekt",
  execution_lease_invalid: "Uitvoeringslease ongeldig",
  execution_lease_expired: "Uitvoeringslease verstreken",
  recovery_schedule_invalid: "Herstelplanning ongeldig",
  recovery_check_overdue: "Lopend onderzoek ouder dan vijftien minuten",
  latest_recovery_check_failed: "Laatste herstelonderzoek mislukt of verlopen",
  recovery_error: "Hersteldiagnostiek bij onafgehandelde opdracht",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isScan(value: unknown): value is RecoveryScan | null {
  if (value === null) return true;
  if (!isObject(value)) return false;

  if (
    !["check_id", "recorded_at", "checked_at", "finished_at"].every(
      (key) => typeof value[key] === "string",
    ) ||
    typeof value.scanned_transfer_count !== "number" ||
    !Number.isSafeInteger(value.scanned_transfer_count) ||
    value.scanned_transfer_count < 0 ||
    value.scanned_transfer_count > 2000 ||
    !["verified_match", "not_found_requires_review"].includes(
      String(value.search_outcome),
    ) ||
    !isNullableString(value.own_transfer_id) ||
    value.history_approval_granted !== false ||
    typeof value.other_source_transfer_count !== "number" ||
    !Number.isSafeInteger(value.other_source_transfer_count) ||
    value.other_source_transfer_count < 0 ||
    value.other_source_transfer_count > value.scanned_transfer_count ||
    typeof value.other_source_transfers_truncated !== "boolean" ||
    !Array.isArray(value.other_source_transfers)
  ) {
    return false;
  }

  if (
    value.other_source_transfers.length !==
      Math.min(value.other_source_transfer_count, 10) ||
    value.other_source_transfers_truncated !==
      (value.other_source_transfer_count > 10)
  ) {
    return false;
  }

  if (value.search_outcome === "verified_match") {
    if (
      typeof value.own_transfer_id !== "string" ||
      value.scanned_transfer_count < 1 ||
      value.other_source_transfer_count > value.scanned_transfer_count - 1
    ) {
      return false;
    }
  } else if (value.own_transfer_id !== null) {
    return false;
  }

  return value.other_source_transfers.every((item: unknown) => {
    if (!isObject(item)) return false;

    return (
      typeof item.transferId === "string" &&
      isNullableString(item.destinationAccountId) &&
      typeof item.amountCents === "number" &&
      Number.isSafeInteger(item.amountCents) &&
      item.amountCents > 0 &&
      typeof item.currency === "string" &&
      typeof item.amountReversedCents === "number" &&
      Number.isSafeInteger(item.amountReversedCents) &&
      item.amountReversedCents >= 0 &&
      item.amountReversedCents <= item.amountCents &&
      typeof item.fullyReversed === "boolean" &&
      isNullableString(item.metadataRequestId) &&
      isNullableString(item.metadataBookingId)
    );
  });
}

function isCheck(value: unknown): value is RecoveryCheck | null {
  if (value === null) return true;
  if (!isObject(value)) return false;

  const scanValid =
    value.scan === undefined ||
    value.scan === null ||
    (isScan(value.scan) && value.scan.check_id === value.id);

  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.started_at === "string" &&
    ["finished_at", "outcome", "error_code", "stripe_transfer_id"].every(
      (key) => value[key] === undefined || isNullableString(value[key]),
    ) &&
    scanValid
  );
}

function isTransferRow(value: unknown): value is TransferRow {
  if (!isObject(value)) return false;

  const requiredStrings = [
    "id",
    "booking_id",
    "trainer_id",
    "source_package_purchase_id",
    "currency",
    "status",
    "created_at",
    "updated_at",
    "next_reconciliation_at",
  ];

  const nullableStrings = [
    "locked_until",
    "first_stripe_request_at",
    "last_stripe_check_at",
    "stripe_transfer_id",
    "succeeded_at",
    "applied_at",
    "execution_error_code",
    "recovery_error_code",
  ];

  return (
    requiredStrings.every((key) => typeof value[key] === "string") &&
    nullableStrings.every((key) => isNullableString(value[key])) &&
    typeof value.amount_cents === "number" &&
    Number.isSafeInteger(value.amount_cents) &&
    value.amount_cents > 0 &&
    typeof value.attempts === "number" &&
    Number.isSafeInteger(value.attempts) &&
    value.attempts >= 0 &&
    typeof value.fully_applied === "boolean" &&
    isCheck(value.latest_check) &&
    isCheck(value.running_check) &&
    Array.isArray(value.attention_reasons) &&
    value.attention_reasons.every((reason) => typeof reason === "string")
  );
}

function isOverview(
  value: unknown,
  attentionOnly: boolean,
  offset: number,
): value is Overview {
  if (!isObject(value)) return false;

  return (
    value.environment === "sandbox" &&
    typeof value.checked_at === "string" &&
    value.attention_only === attentionOnly &&
    value.limit === PAGE_SIZE &&
    value.offset === offset &&
    typeof value.total_count === "number" &&
    Number.isSafeInteger(value.total_count) &&
    value.total_count >= 0 &&
    typeof value.attention_count === "number" &&
    Number.isSafeInteger(value.attention_count) &&
    value.attention_count >= 0 &&
    typeof value.has_more === "boolean" &&
    Array.isArray(value.requests) &&
    value.requests.length <= PAGE_SIZE &&
    value.requests.every(isTransferRow)
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Niet geregistreerd";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Ongeldige/niet-eindige datum";

  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${cents} cent (${currency})`;
  }
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

function ScanDetails({ scan }: { scan: RecoveryScan | null | undefined }) {
  if (!scan) {
    return (
      <p className="mt-4 border border-white/20 p-4 text-sm">
        Geen voltooide scan opgeslagen bij dit onderzoek. Dit kan een ouder
        onderzoek zijn, of een onderzoek zonder afgeronde zoekscan. Het
        bewijst niet dat er geen Stripe-transfer bestaat.
      </p>
    );
  }

  return (
    <details className="mt-5 border border-white/20 p-4">
      <summary className="cursor-pointer font-display text-lg text-[#D6FF3F]">
        OPGESLAGEN ZOEKSCAN
      </summary>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Zoekuitkomst" value={scan.search_outcome} />
        <Field label="Gescande transfers" value={scan.scanned_transfer_count} />
        <Field label="Eigen transfer gevonden" value={scan.own_transfer_id} />
        <Field label="Scan gestart" value={formatDate(scan.checked_at)} />
        <Field label="Scan beëindigd" value={formatDate(scan.finished_at)} />
        <Field label="Scan opgeslagen" value={formatDate(scan.recorded_at)} />
      </dl>

      <p className="mt-4 text-sm leading-relaxed">
        Een geverifieerde zoekmatch is niet hetzelfde als administratieve
        toepassing. Overige brontransfers zijn uitsluitend waarnemingen:
        deze scan verleent geen goedkeuring van de transferhistorie.
      </p>

      <h3 className="mt-5 font-display text-lg">
        OVERIGE BRONTRANSFERS ({scan.other_source_transfer_count})
      </h3>

      {scan.other_source_transfer_count === 0 && (
        <p className="mt-2 text-sm">
          Deze voltooide scan heeft geen overige brontransfers geregistreerd.
        </p>
      )}

      {scan.other_source_transfers_truncated && (
        <p className="mt-2 text-sm text-[#D6FF3F]">
          Alleen de eerste 10 worden hier getoond. De volledige opgeslagen
          lijst blijft in de database behouden.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {scan.other_source_transfers.map((transfer) => (
          <dl
            key={transfer.transferId}
            className="grid gap-4 border border-white/20 p-3 sm:grid-cols-2"
          >
            <Field label="Transfer" value={transfer.transferId} />
            <Field label="Bestemming" value={transfer.destinationAccountId} />
            <Field
              label="Bedrag"
              value={formatMoney(transfer.amountCents, transfer.currency)}
            />
            <Field
              label="Teruggedraaid bedrag"
              value={formatMoney(
                transfer.amountReversedCents,
                transfer.currency,
              )}
            />
            <Field
              label="Volledig teruggedraaid volgens scan"
              value={transfer.fullyReversed ? "Ja" : "Nee"}
            />
            <Field
              label="Opdrachtreferentie in metadata"
              value={transfer.metadataRequestId}
            />
            <Field
              label="Boekingsreferentie in metadata"
              value={transfer.metadataBookingId}
            />
          </dl>
        ))}
      </div>
    </details>
  );
}

function TransferCard({ row }: { row: TransferRow }) {
  const latest = row.latest_check;
  const running = row.running_check;

  return (
    <article className="min-w-0 border-2 border-white/30 bg-white/5 p-5 sm:p-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="font-display text-3xl text-[#D6FF3F]">
            {formatMoney(row.amount_cents, row.currency)}
          </p>
          <p className="mt-2 break-all text-xs text-[#B9BEC2]">{row.id}</p>
        </div>
        <span className="h-fit bg-white px-3 py-1.5 font-display text-sm text-[#14171A]">
          {row.status}
        </span>
      </div>

      <p className="mt-5 text-sm leading-relaxed">
        {row.fully_applied
          ? "De transfer is als geslaagd geregistreerd en administratief toegepast. Dit is geen bewijs van een bankuitbetaling."
          : row.status === "cancelled"
            ? "De opdracht staat op cancelled. Dit is geen bewijs van een Stripe-reversal of refund."
            : "De opdracht is niet als volledig toegepast geregistreerd. Controleer de bestaande uitkomst; niet opnieuw verzenden bij onzekerheid."}
      </p>

      {row.attention_reasons.length > 0 ? (
        <ul className="mt-4 space-y-2 border-l-4 border-[#FF4B3E] bg-[#FF4B3E]/10 p-4 text-sm">
          {row.attention_reasons.map((reason) => (
            <li key={reason}>{attentionLabels[reason] ?? reason}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 border-l-4 border-white/30 p-3 text-sm">
          Geen signaal binnen de huidige criteria. Dit is geen afzonderlijke
          financiële goedkeuring.
        </p>
      )}

      <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Boeking" value={row.booking_id} />
        <Field label="Trainer" value={row.trainer_id} />
        <Field label="Pakketaankoop" value={row.source_package_purchase_id} />
        <Field label="Stripe-transfer" value={row.stripe_transfer_id} />
        <Field label="Uitvoeringspogingen" value={row.attempts} />
        <Field label="Aangemaakt" value={formatDate(row.created_at)} />
        <Field
          label="Stripe-aanvraag voorbereid"
          value={formatDate(row.first_stripe_request_at)}
        />
        <Field
          label="Uitvoeringslease tot"
          value={formatDate(row.locked_until)}
        />
        <Field
          label="Opgeslagen laatste Stripe-controle"
          value={formatDate(row.last_stripe_check_at)}
        />
        <Field
          label="Als geslaagd geregistreerd"
          value={formatDate(row.succeeded_at)}
        />
        <Field
          label="Administratief toegepast"
          value={formatDate(row.applied_at)}
        />
        <Field
          label="Opgeslagen herstelplanning"
          value={formatDate(row.next_reconciliation_at)}
        />
      </dl>

      <p className="mt-4 text-xs leading-relaxed text-[#B9BEC2]">
        De planning bewijst niet dat een worker of cron actief is.
        Volledig toegepaste opdrachten worden niet standaard geselecteerd.
        De opgeslagen laatste Stripe-controle is niet noodzakelijk de datum
        van het laatste herstelonderzoek.
      </p>

      {(row.execution_error_code || row.recovery_error_code) && (
        <dl className="mt-5 grid gap-4 border border-[#FF4B3E]/60 p-4 sm:grid-cols-2">
          <Field
            label="Uitvoeringsdiagnostiek"
            value={row.execution_error_code}
          />
          <Field
            label="Hersteldiagnostiek"
            value={row.recovery_error_code}
          />
        </dl>
      )}

      <section className="mt-6 border-t border-white/20 pt-4">
        <h2 className="font-display text-xl text-[#D6FF3F]">
          LAATSTE HERSTELONDERZOEK
        </h2>

        {latest ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Onderzoek" value={latest.id} />
            <Field label="Onderzoeksstatus" value={latest.status} />
            <Field label="Uitkomst" value={latest.outcome} />
            <Field label="Diagnostische code" value={latest.error_code} />
            <Field label="Gestart" value={formatDate(latest.started_at)} />
            <Field label="Afgesloten" value={formatDate(latest.finished_at)} />
            <Field
              label="Transferreferentie onderzoek"
              value={latest.stripe_transfer_id}
            />
          </dl>
        ) : (
          <p className="mt-3 text-sm">Geen herstelonderzoek geregistreerd.</p>
        )}

        {running && (
          <div className="mt-4 border border-white/30 p-4 text-sm">
            <p className="font-semibold">Lopend geregistreerd onderzoek</p>
            <p className="mt-1 break-all">{running.id}</p>
            <p className="mt-1">Gestart: {formatDate(running.started_at)}</p>
          </div>
        )}

        {latest && <ScanDetails scan={latest.scan} />}

        <p className="mt-4 text-xs leading-relaxed text-[#B9BEC2]">
          Een mislukt of verlopen onderzoek betekent niet dat de transfer
          mislukt is. Een timeout annuleert geen lopende Stripe-read of
          synchronisatie. Dit overzicht toont het laatste en het lopende
          onderzoek, niet de volledige onderzoekshistorie. Scaninformatie
          hoort uitsluitend bij het getoonde laatste onderzoek.
        </p>
      </section>
    </article>
  );
}

export default function AdminTransferRecoveryPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
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
        // Autorisatie gebeurt in de RPC; geen directe tabeltoegang.
        const { data, error } = await supabase.rpc(
          "admin_list_sandbox_transfer_recovery",
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

          console.error("Transferhersteloverzicht laden mislukt:", {
            code: error.code,
          });

          throw new Error("Het transferhersteloverzicht kon niet worden geladen.");
        }

        if (!isOverview(data, attentionOnly, offset)) {
          throw new Error("De server gaf geen geldig hersteloverzicht terug.");
        }

        setOverview(data);
      } catch (error: unknown) {
        if (isCurrent()) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Het transferhersteloverzicht kon niet worden geladen.",
          );
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event) => {
        if (
          event === "SIGNED_OUT" ||
          event === "SIGNED_IN" ||
          event === "USER_UPDATED"
        ) {
          sequenceRef.current += 1;
          setOverview(null);
          setErrorMessage("");
          setAccessDenied(false);
          setLoading(true);
          setRefreshVersion((value) => value + 1);
        }
      },
    );

    void load();

    return () => {
      disposed = true;
      authListener.subscription.unsubscribe();
    };
  }, [attentionOnly, offset, refreshVersion]);

  function refresh(): void {
    sequenceRef.current += 1;
    setOverview(null);
    setLoading(true);
    setRefreshVersion((value) => value + 1);
  }

  function changeFilter(value: boolean): void {
    if (loading || value === attentionOnly) return;
    sequenceRef.current += 1;
    setOverview(null);
    setLoading(true);
    setOffset(0);
    setAttentionOnly(value);
  }

  function changePage(value: number): void {
    if (loading) return;
    sequenceRef.current += 1;
    setOverview(null);
    setLoading(true);
    setOffset(value);
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <p className="font-display text-lg text-[#FF4B3E]">
            ADMIN / TRANSFERHERSTEL
          </p>
          <h1 className="mt-2 font-display text-5xl sm:text-6xl">
            TRANSFERHERSTEL.
          </h1>
          <p className="mt-4 max-w-3xl text-[#D7D9DA]">
            Alleen-lezenoverzicht van sandboxopdrachten en
            herstelonderzoeken. Geen transfers, statuswijzigingen of
            herverzending.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/admin" className={buttonClass}>
              ← ADMIN HUB
            </Link>
            <button
              type="button"
              disabled={loading}
              onClick={refresh}
              className={buttonClass}
            >
              {loading ? "LADEN..." : "↻ VERVERS"}
            </button>
          </div>

          <div className="mt-6 border-l-4 border-[#FF4B3E] bg-white/5 p-4 text-sm leading-relaxed">
            <strong>SANDBOX — ALLEEN LEZEN.</strong> Gegevens komen uit
            Supabase, niet rechtstreeks uit Stripe. Dit scherm controleert
            niet of de worker is ingeschakeld. Een transfer naar een
            Stripe-account is geen bewezen bankuitbetaling.
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
              ALLE SANDBOXOPDRACHTEN
            </button>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-5">
              <p>{errorMessage}</p>
              {accessDenied && (
                <Link href="/speler-login" className="mt-4 inline-block underline">
                  Naar inloggen
                </Link>
              )}
            </div>
          )}

          {loading && (
            <p role="status" className="mt-8 font-display text-xl">
              TRANSFERHERSTEL LADEN...
            </p>
          )}

          {!loading && overview && (
            <>
              <div className="mt-6 flex flex-wrap justify-between gap-3 text-sm text-[#B9BEC2]">
                <p>
                  Aandacht nodig: {overview.attention_count}
                  {" · "}Resultaten binnen filter: {overview.total_count}
                </p>
                <p>
                  Databasecontrole: {formatDate(overview.checked_at)}
                  {" · Amsterdam"}
                </p>
              </div>

              {overview.requests.length === 0 ? (
                <p className="mt-6 border-2 border-white/20 p-6">
                  {offset > 0
                    ? "Deze pagina bevat geen resultaten. Ga terug naar een eerdere pagina."
                    : attentionOnly
                      ? "Geen opdrachten binnen de huidige signaleringscriteria."
                      : "Geen sandboxpakkettransferopdrachten gevonden."}
                </p>
              ) : (
                <div className="mt-6 space-y-6">
                  {overview.requests.map((row) => (
                    <TransferCard key={row.id} row={row} />
                  ))}
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={loading || offset === 0}
                  onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}
                  className={buttonClass}
                >
                  ← VORIGE
                </button>
                <span className="text-sm">
                  Pagina {Math.floor(offset / PAGE_SIZE) + 1}
                </span>
                <button
                  type="button"
                  disabled={loading || !overview.has_more}
                  onClick={() => changePage(offset + PAGE_SIZE)}
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