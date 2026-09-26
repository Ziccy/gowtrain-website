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

export default function AccountDeletionPostAuthRecovery({
  requestId,
  claimedAt,
  onRefresh,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const mounted = useRef(false);
  const saveLock = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  async function recover(): Promise<void> {
    if (
      !confirming ||
      mustRefresh ||
      saveLock.current
    ) {
      return;
    }

    saveLock.current = true;
    setSaving(true);
    setMessage("");
    setFailed(false);

    try {
      /*
       * Gebruik de gewone ingelogde Supabase-client.
       * De RPC controleert zelf de adminrol, oorspronkelijke
       * claim en daadwerkelijke Auth-afwezigheid.
       */
      const { data, error } = await supabase.rpc(
        "admin_recover_deletion_after_auth",
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
            : "Het herstelresultaat kon niet worden bevestigd."
        );
      }

      if (
        !isObject(data) ||
        data.request_id !== requestId ||
        data.recovery_confirmed !== true ||
        data.account_deleted !== true
      ) {
        throw new Error(
          "Het antwoord op de herstelactie is niet bevestigd."
        );
      }

      const playerCompleted =
        data.outcome === "player_request_completed" &&
        data.queue_status === "completed" &&
        data.request_completed === true;

      const trainerLocallyCompleted =
        data.outcome === "trainer_local_completed" &&
        data.queue_status === "needs_review" &&
        data.request_completed === false;

      if (!playerCompleted && !trainerLocallyCompleted) {
        throw new Error(
          "De ontvangen herstelstatussen komen niet overeen."
        );
      }

      if (!mounted.current) return;

      setMessage(
        playerCompleted
          ? "De spelerafronding en wachtrij zijn bevestigd afgerond. De beheeractie is vastgelegd. Er is geen nieuwe Auth-verwijderaanroep gedaan."
          : "De lokale trainerafronding is bevestigd en de beheeractie is vastgelegd. De wachtrij staat op aanvullende afhandeling; het totale verzoek blijft open."
      );
    } catch (error: unknown) {
      if (!mounted.current) return;

      setFailed(true);
      setMessage(
        `${
          error instanceof Error
            ? error.message
            : "De herstelactie kon niet worden bevestigd."
        } Vernieuw eerst het overzicht. Er wordt niet automatisch opnieuw uitgevoerd.`
      );
    } finally {
      saveLock.current = false;

      if (mounted.current) {
        setSaving(false);
        setConfirming(false);
        setMustRefresh(true);
      }
    }
  }

  return (
    <section className="border border-[#FF4B3E]/60 p-4">
      <h2 className="font-display text-lg text-[#D6FF3F]">
        AFRONDING NA AUTH-VERWIJDERING HERSTELLEN
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
        De Auth-fase is gestart, maar de wachtrij staat nog op
        geclaimd. Dit bewijst niet dat het account verdwenen is.
        De database controleert dat voordat herstel wordt uitgevoerd.
      </p>

      <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
        Deze actie verwijdert geen Auth-account, neemt geen claim
        over en start geen worker opnieuw. Bestaat het Auth-account
        nog of wijken de gegevens af, dan wordt herstel geweigerd.
      </p>

      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-4 text-sm ${
            failed ? "text-[#FF8A80]" : "text-white"
          }`}
        >
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
          <p className="text-sm leading-relaxed text-white">
            Laat de database controleren of Auth al verdwenen is
            en uitsluitend de resterende ondersteunde
            afrondingsstappen uitvoeren?
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
              onClick={() => void recover()}
              className="min-h-11 bg-[#D6FF3F] px-4 py-3 font-display text-sm text-[#14171A] disabled:opacity-50"
            >
              {saving
                ? "CONTROLEREN..."
                : "CONTROLEER EN HERSTEL AFRONDING"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 min-h-11 border border-[#D6FF3F]/60 px-4 py-3 font-display text-sm text-[#D6FF3F]"
        >
          HERSTELCONTROLE OPENEN
        </button>
      )}
    </section>
  );
}