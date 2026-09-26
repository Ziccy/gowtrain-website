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

export default function AccountDeletionResume({
  requestId,
  claimedAt,
  onRefresh,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const mounted = useRef(false);
  const lock = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  async function resume(): Promise<void> {
    if (!confirming || lock.current || mustRefresh) return;

    lock.current = true;
    setWorking(true);
    setMessage("");
    setFailed(false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (!mounted.current) return;

      if (sessionError || !session?.access_token) {
        throw new Error("Log opnieuw in met je beheeraccount.");
      }

      /*
       * De server controleert de adminrol, oorspronkelijke claim
       * en opgeslagen uitvoerfase opnieuw.
       *
       * Geen gebruikers-ID of claimtoken meesturen.
       */
      const response = await fetch(
        "/api/admin/account-deletions/resume",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestId,
            expectedClaimedAt: claimedAt,
            confirmation: "RESUME_DELETION_BEFORE_AUTH",
          }),
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        }
      );

      const result: unknown = await response.json();

      if (!response.ok) {
        const explanation =
          isObject(result) && typeof result.error === "string"
            ? result.error
            : "De hervatting kon niet worden bevestigd.";

        const stage =
          isObject(result) && typeof result.stage === "string"
            ? ` Fase: ${result.stage}.`
            : "";

        throw new Error(explanation + stage);
      }

      if (
        !isObject(result) ||
        result.requestId !== requestId ||
        result.resumed !== true ||
        result.accountDeleted !== true
      ) {
        throw new Error("Het hervattingsresultaat is niet bevestigd.");
      }

      const playerCompleted =
        result.processingStatus === "completed" &&
        result.requestCompleted === true &&
        result.technicalReferenceErased === true;

      const trainerLocallyCompleted =
        result.processingStatus === "needs_review" &&
        result.requestCompleted === false &&
        result.localCompletionConfirmed === true &&
        typeof result.externalFollowupPending === "boolean";

      if (!playerCompleted && !trainerLocallyCompleted) {
        throw new Error("De ontvangen afrondingsstatus is inconsistent.");
      }

      if (!mounted.current) return;

      setMessage(
        playerCompleted
          ? "Hervatting geslaagd. Het speleraccount is verwijderd, het verzoek is afgerond en de technische accountreferenties zijn gewist."
          : "Hervatting geslaagd. Het traineraccount is lokaal verwijderd. De verdere afhandeling van het verzoek blijft open."
      );
    } catch (error: unknown) {
      if (!mounted.current) return;

      setFailed(true);
      setMessage(
        `${
          error instanceof Error
            ? error.message
            : "De hervatting kon niet worden bevestigd."
        } Een claimovername of verwijderfase kan al zijn uitgevoerd. ` +
          "Vernieuw eerst de voortgang. Niet direct opnieuw hervatten."
      );
    } finally {
      clearTimeout(timeout);
      lock.current = false;

      if (mounted.current) {
        setWorking(false);
        setConfirming(false);
        setMustRefresh(true);
      }
    }
  }

  return (
    <section className="border border-[#FF4B3E]/60 p-4">
      <h2 className="font-display text-lg text-[#D6FF3F]">
        HERVATTEN VÓÓR AUTH-VRIJGAVE
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
        De databasefase is vastgelegd, maar de Auth-fase nog niet.
        De server controleert of de claim veilig kan worden overgenomen.
        Daarna kan het account definitief worden verwijderd.
      </p>

      <p className="mt-2 break-all font-mono text-xs text-[#B9BEC2]">
        Verzoek: {requestId}
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
          disabled={working}
          onClick={onRefresh}
          className="mt-4 min-h-11 border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-50"
        >
          VERNIEUW VOORTGANG
        </button>
      ) : confirming ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-white">
            Bevestig dat dit het bedoelde verwijderverzoek is.
            Hervatten kan de onomkeerbare accountverwijdering uitvoeren.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={working}
              onClick={() => setConfirming(false)}
              className="min-h-11 border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-50"
            >
              ANNULEREN
            </button>

            <button
              type="button"
              disabled={working}
              onClick={() => void resume()}
              className="min-h-11 bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white disabled:opacity-50"
            >
              {working ? "HERVATTEN..." : "JA, HERVAT VERWIJDERING"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 min-h-11 border border-[#FF4B3E] px-4 py-3 font-display text-sm text-[#FF8A80]"
        >
          HERVATTING CONTROLEREN
        </button>
      )}
    </section>
  );
}