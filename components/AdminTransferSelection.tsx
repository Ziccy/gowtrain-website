"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type SelectionRow = {
  booking_id: string;
  trainer_id: string;
  package_purchase_id: string;
  booking_status: string;
  trainer_payout_status: string;
  amount_cents: number;
  currency: string;
  next_check_at: string;
  last_checked_at: string | null;
  last_error_code: string | null;
  consecutive_failures: number;
  request_id: string | null;
  request_status: string | null;
  awaiting_selection: boolean;
  fully_applied: boolean;
  attention_reasons: string[];
};

type Overview = {
  environment: "sandbox";
  scope: "recorded_selection_checks";
  checked_at: string;
  attention_only: boolean;
  limit: number;
  offset: number;
  total_count: number;
  attention_count: number;
  has_more: boolean;
  selections: SelectionRow[];
};

const PAGE_SIZE = 25;

const buttonClass =
  "border-2 border-white/40 px-4 py-2.5 font-display text-sm " +
  "transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labels: Record<string, string> = {
  selection_rejected: "Laatste selectiebeoordeling geweigerd",
  selection_check_overdue: "Opgeslagen controlemoment langer dan 15 minuten voorbij",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isRow(value: unknown): value is SelectionRow {
  if (!isObject(value)) return false;

  return (
    [
      "booking_id",
      "trainer_id",
      "package_purchase_id",
      "booking_status",
      "trainer_payout_status",
      "currency",
      "next_check_at",
    ].every((key) => typeof value[key] === "string") &&
    [
      "last_checked_at",
      "last_error_code",
      "request_id",
      "request_status",
    ].every((key) => isNullableString(value[key])) &&
    isCount(value.amount_cents) &&
    isCount(value.consecutive_failures) &&
    typeof value.awaiting_selection === "boolean" &&
    typeof value.fully_applied === "boolean" &&
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
    value.scope === "recorded_selection_checks" &&
    typeof value.checked_at === "string" &&
    value.attention_only === attentionOnly &&
    value.limit === PAGE_SIZE &&
    value.offset === offset &&
    isCount(value.total_count) &&
    isCount(value.attention_count) &&
    typeof value.has_more === "boolean" &&
    Array.isArray(value.selections) &&
    value.selections.length <= PAGE_SIZE &&
    value.selections.every(isRow)
  );
}

function formatDate(value: string | null): string {
  if (!value) return "Niet geregistreerd";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Ongeldige datum";

  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${amount} cent (${currency})`;
  }
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
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

export default function AdminTransferSelection() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const sequenceRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const sequence = ++sequenceRef.current;
    const isCurrent = () =>
      !disposed && sequence === sequenceRef.current;

    async function load() {
      setLoading(true);
      setOverview(null);
      setErrorMessage("");

      try {
        const { data, error } = await supabase.rpc(
          "admin_list_sandbox_transfer_selection",
          {
            p_attention_only: attentionOnly,
            p_limit: PAGE_SIZE,
            p_offset: offset,
          },
        );

        if (!isCurrent()) return;

        if (error) {
          console.error("Transferselectieoverzicht niet bevestigd:", {
            code: error.code,
          });

          setErrorMessage(
            error.code === "42501"
              ? "Geen toegang. Een ingelogd adminaccount is vereist."
              : "De selectiegegevens konden niet worden geladen. Dit betekent niet dat er geen selectieproblemen zijn.",
          );
          return;
        }

        if (!isOverview(data, attentionOnly, offset)) {
          throw new Error("INVALID_SELECTION_OVERVIEW");
        }

        setOverview(data);
      } catch {
        if (isCurrent()) {
          setErrorMessage(
            "Het selectieoverzicht kon niet worden bevestigd. Er is geen financiële actie vanuit dit scherm uitgevoerd.",
          );
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "USER_UPDATED"
      ) {
        sequenceRef.current += 1;
        setOverview(null);
        setErrorMessage("");
        setLoading(true);
        setOffset(0);
        setRefreshVersion((value) => value + 1);
      }
    });

    void load();

    return () => {
      disposed = true;
      listener.subscription.unsubscribe();
    };
  }, [attentionOnly, offset, refreshVersion]);

  function invalidate() {
    sequenceRef.current += 1;
    setOverview(null);
    setErrorMessage("");
    setLoading(true);
  }

  function refresh() {
    invalidate();
    setRefreshVersion((value) => value + 1);
  }

  function changeFilter(value: boolean) {
    if (loading || value === attentionOnly) return;
    invalidate();
    setOffset(0);
    setAttentionOnly(value);
  }

  function changePage(value: number) {
    if (loading) return;
    invalidate();
    setOffset(value);
  }

  return (
    <section className="mt-12 border-t-2 border-white/30 pt-8">
      <h2 className="font-display text-3xl text-[#D6FF3F]">
        AUTOMATISCHE SELECTIE
      </h2>

      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#D7D9DA]">
        Alleen opgeslagen selectiebeoordelingen van sandboxpakketlessen.
        Ook afwijzingen zonder transferopdracht worden hier getoond.
        Dit is geen volledige kandidatenlijst en geen bevestiging dat
        automatische uitvoering aan staat.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={loading}
          aria-pressed={attentionOnly}
          onClick={() => changeFilter(true)}
          className={`${buttonClass} ${
            attentionOnly ? "border-[#D6FF3F] text-[#D6FF3F]" : ""
          }`}
        >
          SELECTIEAANDACHT
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
          ALLE OPGESLAGEN BEOORDELINGEN
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={refresh}
          className={buttonClass}
        >
          ↻ VERVERS SELECTIE
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="mt-5 border-2 border-[#FF4B3E] p-4">
          {errorMessage}
        </p>
      )}

      {loading && (
        <p role="status" className="mt-5">
          Selectiegegevens laden…
        </p>
      )}

      {!loading && overview && (
        <>
          <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm text-[#B9BEC2]">
            <p>
              Selectieaandacht: {overview.attention_count}
              {" · "}Resultaten binnen filter: {overview.total_count}
            </p>
            <p>Databasecontrole: {formatDate(overview.checked_at)} · Amsterdam</p>
          </div>

          {overview.selections.length === 0 ? (
            <p className="mt-4 border border-white/30 p-5">
              {attentionOnly
                ? "Geen opgeslagen selectiebeoordelingen binnen de huidige aandachtcriteria."
                : "Geen opgeslagen selectiebeoordelingen op deze pagina."}
              {" "}Lessen die nog niet beoordeeld zijn, staan niet in dit overzicht.
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              {overview.selections.map((row) => (
                <article
                  key={row.booking_id}
                  className="border-2 border-white/30 bg-white/5 p-5"
                >
                  <p className="font-display text-2xl text-[#D6FF3F]">
                    {formatMoney(row.amount_cents, row.currency)}
                  </p>

                  <p className="mt-3 text-sm">
                    {row.fully_applied
                      ? "De gekoppelde opdracht is administratief toegepast. Dit selectierecord is geen nieuwe uitvoeringsopdracht."
                      : row.awaiting_selection
                        ? "De boekingsstatus past bij een volgende selectiebeoordeling. Dit is geen volledige geschiktheidscontrole."
                        : "De huidige status past niet bij de voorselectie. Een oude planning of foutcode kan nog bewaard zijn."}
                  </p>

                  {row.attention_reasons.length > 0 && (
                    <ul className="mt-4 space-y-1 border-l-4 border-[#FF4B3E] p-3 text-sm">
                      {row.attention_reasons.map((reason) => (
                        <li key={reason}>{labels[reason] ?? reason}</li>
                      ))}
                    </ul>
                  )}

                  <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Boeking" value={row.booking_id} />
                    <Field label="Trainer" value={row.trainer_id} />
                    <Field label="Pakketaankoop" value={row.package_purchase_id} />
                    <Field label="Boekingsstatus" value={row.booking_status} />
                    <Field
                      label="Trainertransferstatus boeking"
                      value={row.trainer_payout_status}
                    />
                    <Field
                      label="Laatste selectiebeoordeling"
                      value={formatDate(row.last_checked_at)}
                    />
                    <Field
                      label="Volgend opgeslagen controlemoment"
                      value={formatDate(row.next_check_at)}
                    />
                    <Field
                      label="Opgeslagen selectiediagnostiek"
                      value={row.last_error_code}
                    />
                    <Field
                      label="Opeenvolgende selectieafwijzingen"
                      value={row.consecutive_failures}
                    />
                    <Field label="Transferopdracht" value={row.request_id} />
                    <Field label="Opdrachtstatus" value={row.request_status} />
                  </dl>
                </article>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4">
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

      <p className="mt-5 text-xs leading-relaxed text-[#B9BEC2]">
        Selectieafwijzingen zijn geen Stripe-uitvoeringspogingen. Een volgend
        controlemoment is geen toezegging van betaling. Fouten die de hele
        selectietransactie afbreken, hoeven geen selectierecord op te leveren;
        daarvoor blijven worker- en cronlogs nodig.
      </p>
    </section>
  );
}