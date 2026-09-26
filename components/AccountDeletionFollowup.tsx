"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

const ACTIONS = [
  ["assess_dependencies", "Afhankelijkheden beoordelen"],
  ["review_external_data", "Externe gegevensafhandeling beoordelen"],
  ["review_worker_progress", "Worker en uitvoervoortgang onderzoeken"],
  ["await_resolution", "Wachten op noodzakelijke afhandeling"],
] as const;

type Action = (typeof ACTIONS)[number][0];

type Followup = {
  assigned: boolean;
  assignedToCurrentAdmin: boolean;
  nextAction: Action;
  reviewAfter: string;
  version: number;
  updatedAt: string;
};

type Snapshot = {
  requestStatus: string;
  followup: Followup | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isAction(value: unknown): value is Action {
  return ACTIONS.some(([action]) => action === value);
}

function validTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

export default function AccountDeletionFollowup({
  requestId,
}: {
  requestId: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [action, setAction] = useState<Action>("assess_dependencies");
  const [days, setDays] = useState(1);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const mounted = useRef(false);
  const sequence = useRef(0);
  const saveLock = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    const current = ++sequence.current;

    setLoading(true);
    setError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Log opnieuw in met je beheeraccount.");
      }

      const response = await fetch(
        `/api/admin/account-deletions/followup?requestId=${encodeURIComponent(
          requestId
        )}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        }
      );

      const body: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          isObject(body) && typeof body.error === "string"
            ? body.error
            : "De opvolging kon niet worden geladen."
        );
      }

      if (
        !isObject(body) ||
        body.requestId !== requestId ||
        typeof body.requestStatus !== "string"
      ) {
        throw new Error("Ongeldig antwoord van de opvolg-API.");
      }

      let followup: Followup | null = null;

      if (body.followup !== null) {
        const value = body.followup;

        if (
          !isObject(value) ||
          typeof value.assigned !== "boolean" ||
          typeof value.assignedToCurrentAdmin !== "boolean" ||
          !isAction(value.nextAction) ||
          !validTime(value.reviewAfter) ||
          !validTime(value.updatedAt) ||
          typeof value.version !== "number" ||
          !Number.isSafeInteger(value.version) ||
          value.version < 1
        ) {
          throw new Error("De opgeslagen opvolging is niet controleerbaar.");
        }

        followup = {
          assigned: value.assigned,
          assignedToCurrentAdmin: value.assignedToCurrentAdmin,
          nextAction: value.nextAction,
          reviewAfter: value.reviewAfter,
          version: value.version,
          updatedAt: value.updatedAt,
        };
      }

      if (!mounted.current || sequence.current !== current) return false;

      setSnapshot({
        requestStatus: body.requestStatus,
        followup,
      });
      setAction(followup?.nextAction ?? "assess_dependencies");
      setMustReload(false);
      return true;
    } catch (caught: unknown) {
      if (mounted.current && sequence.current === current) {
        setMustReload(true);
        setError(
          caught instanceof Error
            ? caught.message
            : "De opvolging kon niet worden geladen."
        );
      }

      return false;
    } finally {
      if (mounted.current && sequence.current === current) {
        setLoading(false);
      }
    }
  }, [requestId]);

  useEffect(() => {
    mounted.current = true;
    void load();

    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, [load]);

  async function save(): Promise<void> {
    if (
      !snapshot ||
      snapshot.requestStatus === "completed" ||
      loading ||
      mustReload ||
      saveLock.current
    ) {
      return;
    }

    saveLock.current = true;
    setSaving(true);
    setError("");
    setSuccess("");

    const expectedVersion = snapshot.followup?.version ?? 0;

    // Expliciet een termijn in uren, geen lokale datumconversie.
    const reviewAfter = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000
    ).toISOString();

    try {
      /*
       * Gewone Supabase-client:
       * de RPC bepaalt auth.uid() en controleert zelf de adminrol.
       */
      const { data, error: saveError } = await supabase.rpc(
        "admin_save_account_deletion_followup",
        {
          p_request_id: requestId,
          p_next_action: action,
          p_review_after: reviewAfter,
          p_expected_version: expectedVersion,
        }
      );

      if (saveError) {
        const controlled = [
          "P0001",
          "42501",
          "22023",
        ].includes(saveError.code);

        throw new Error(
          controlled
            ? saveError.message
            : "De opslag kon niet worden bevestigd. De wijziging kan al zijn verwerkt."
        );
      }

      if (
        !isObject(data) ||
        data.request_id !== requestId ||
        data.assigned_to_current_admin !== true ||
        data.next_action !== action ||
        data.version !== expectedVersion + 1 ||
        !validTime(data.review_after)
      ) {
        throw new Error("Het opslagresultaat kon niet worden bevestigd.");
      }

      if (!mounted.current) return;

      // Alleen opnieuw lezen, nooit automatisch opnieuw opslaan.
      setMustReload(true);
      const refreshed = await load();

      if (mounted.current) {
        setSuccess(
          refreshed
            ? "Opvolging opgeslagen en aan jou toegewezen."
            : "De server heeft de opslag bevestigd, maar het teruglezen is mislukt. Vernieuw de opvolging."
        );
      }
    } catch (caught: unknown) {
      if (mounted.current) {
        setMustReload(true);
        setError(
          `${
            caught instanceof Error
              ? caught.message
              : "Opslaan is niet gelukt."
          } Vernieuw eerst de opvolging voordat je opnieuw opslaat.`
        );
      }
    } finally {
      saveLock.current = false;

      if (mounted.current) setSaving(false);
    }
  }

  const followup = snapshot?.followup;
  const completed = snapshot?.requestStatus === "completed";
  const disabled = loading || saving || mustReload || !snapshot;

  return (
    <section className="border border-white/20 p-4">
      <h2 className="font-display text-lg text-[#D6FF3F]">
        OPVOLGING DOOR BEHEERDER
      </h2>

      <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
        Deze registratie start geen verwijdering, herhaalt geen worker
        en verandert geen accountblokkering.
      </p>

      {followup ? (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Verantwoordelijke:{" "}
            <strong>
              {followup.assignedToCurrentAdmin
                ? "Jij"
                : followup.assigned
                  ? "Een andere beheerder"
                  : "Niet meer toegewezen"}
            </strong>
          </p>

          <p>
            Vervolgstap:{" "}
            {ACTIONS.find(([value]) => value === followup.nextAction)?.[1]}
          </p>

          <p>
            Hercontrole: {formatTime(followup.reviewAfter)} (Amsterdam)
          </p>

          <p className="text-xs text-[#8A8F94]">
            Laatst gewijzigd: {formatTime(followup.updatedAt)} · versie{" "}
            {followup.version}
          </p>
        </div>
      ) : !loading && snapshot ? (
        <p className="mt-4 text-sm text-[#B9BEC2]">
          Nog geen opvolging vastgelegd.
        </p>
      ) : null}

      {loading ? (
        <p role="status" className="mt-3 text-sm text-[#B9BEC2]">
          Opvolging laden...
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#FF8A80]">
          {error}
        </p>
      ) : null}

      {success ? (
        <p role="status" className="mt-3 text-sm text-[#D6FF3F]">
          {success}
        </p>
      ) : null}

      {snapshot && !completed ? (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs text-[#B9BEC2]">
              VOLGENDE ACTIE
            </span>
            <select
              value={action}
              disabled={disabled}
              onChange={(event) => {
                if (isAction(event.target.value)) {
                  setAction(event.target.value);
                  setSuccess("");
                }
              }}
              className="mt-2 min-h-11 w-full border border-white/30 bg-[#14171A] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {ACTIONS.map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-[#B9BEC2]">
              OPNIEUW CONTROLEREN
            </span>
            <select
              value={days}
              disabled={disabled}
              onChange={(event) => setDays(Number(event.target.value))}
              className="mt-2 min-h-11 w-full border border-white/30 bg-[#14171A] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              <option value={1}>Over 24 uur</option>
              <option value={3}>Over 3 dagen (72 uur)</option>
              <option value={7}>Over 7 dagen (168 uur)</option>
            </select>
          </label>

          <p className="text-xs leading-relaxed text-[#B9BEC2]">
            Dit is een interne werkafspraak, geen wettelijke termijn
            of verlenging daarvan. Opslaan wijst het verzoek aan jou toe,
            ook wanneer een andere beheerder het eerder had opgepakt.
          </p>

          <button
            type="button"
            disabled={disabled}
            onClick={() => void save()}
            className="min-h-11 bg-[#D6FF3F] px-4 py-3 font-display text-sm text-[#14171A] disabled:opacity-50"
          >
            {saving ? "OPSLAAN..." : "OPPAKKEN EN OPVOLGING OPSLAAN"}
          </button>
        </div>
      ) : completed ? (
        <p className="mt-4 text-sm text-[#B9BEC2]">
          Het verzoek is afgerond. Nieuwe opvolging opslaan is uitgeschakeld.
        </p>
      ) : null}

      <button
        type="button"
        disabled={loading || saving}
        onClick={() => {
          setSuccess("");
          void load();
        }}
        className="mt-4 block min-h-11 border border-white/30 px-4 py-2 font-display text-xs disabled:opacity-50"
      >
        OPVOLGING VERNIEUWEN
      </button>
    </section>
  );
}