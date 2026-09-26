"use client";

import { useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase-browser";

type Props = {
  requestId: string;
  claimedAt: string;
  onRefresh: () => void;
};

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export default function AccountDeletionQueueRecovery({
  requestId,
  claimedAt,
  onRefresh,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const [message, setMessage] = useState("");

  const lock = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  async function reconcile(): Promise<void> {
    if (lock.current || mustRefresh || !confirming) return;

    lock.current = true;
    setSaving(true);
    setMessage("");

    try {
      /*
       * Gewone ingelogde Supabase-client.
       * De RPC controleert zelf adminrechten, claimgegevens
       * en het bestaande afrondingsbewijs.
       */
      const { data, error } = await supabase.rpc(
        "admin_reconcile_completed_deletion_queue",
        {
          p_request_id: requestId,
          p_expected_claimed_at: claimedAt,
        }
      );

      if (error) {
        const controlled = [
          "42501",
          "22023",
          "55000",
          "55P03",
        ].includes(error.code);

        throw new Error(
          controlled
            ? error.message
            : "De administratieve afronding kon niet worden bevestigd."
        );
      }

      if (
        !isObject(data) ||
        data.request_id !== requestId ||
        data.queue_completed !== true ||
        typeof data.changed !== "boolean" ||
        typeof data.finished_at !== "string" ||
        !Number.isFinite(Date.parse(data.finished_at))
      ) {
        throw new Error(
          "Het antwoord op de herstelactie kon niet worden bevestigd."
        );
      }

      if (!mounted.current) return;

      setMustRefresh(true);
      setConfirming(false);
      setMessage(
        data.changed
          ? "De wachtrij is administratief afgerond. De beheeractie is vastgelegd. Er is geen accountverwijdering uitgevoerd."
          : "De wachtrij was inmiddels al afgerond. Er is niets gewijzigd."
      );
    } catch (error: unknown) {
      if (!mounted.current) return;

      setMustRefresh(true);
      setConfirming(false);
      setMessage(
        `${
          error instanceof Error
            ? error.message
            : "De herstelactie kon niet worden bevestigd."
        } Vernieuw eerst het overzicht. De aanvraag wordt niet automatisch herhaald.`
      );
    } finally {
      lock.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  }

  return (
    <section className="border border-[#FF4B3E]/60 p-4">
      <h2 className="font-display text-lg text-[#D6FF3F]">
        WACHTRIJ ADMINISTRATIEF AFRONDEN
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
        Het verzoek is afgerond, maar de wachtrij staat nog op
        geclaimd. De database controleert het opgeslagen eindbewijs
        voordat uitsluitend de wachtrij wordt afgerond.
      </p>

      <p className="mt-2 text-xs text-[#B9BEC2]">
        Geen nieuwe accountverwijdering, claimovername of
        workerherstart. De leeftijd van de claim is geen
        voorwaarde voor deze administratieve correctie.
      </p>

      {message ? (
        <p role="status" className="mt-4 text-sm text-white">
          {message}
        </p>
      ) : null}

      {mustRefresh ? (
        <button
          type="button"
          disabled={saving}
          onClick={onRefresh}
          className="mt-4 min-h-11 border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-50"
        >
          VERNIEUW OVERZICHT
        </button>
      ) : confirming ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-white">
            Wil je uitsluitend deze wachtrijregistratie laten
            controleren en afronden?
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => setConfirming(false)}
              className="min-h-11 border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-50"
            >
              ANNULEREN
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => void reconcile()}
              className="min-h-11 bg-[#D6FF3F] px-4 py-3 font-display text-sm text-[#14171A] disabled:opacity-50"
            >
              {saving ? "CONTROLEREN..." : "JA, ROND WACHTRIJ AF"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 min-h-11 border border-[#D6FF3F]/60 px-4 py-3 font-display text-sm text-[#D6FF3F]"
        >
          ADMINISTRATIEF HERSTEL
        </button>
      )}
    </section>
  );
}