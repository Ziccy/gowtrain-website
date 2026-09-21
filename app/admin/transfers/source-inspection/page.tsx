"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type InspectionResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export default function AdminSourceInspectionPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const inFlightRef = useRef(false);
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_OUT" ||
        event === "SIGNED_IN" ||
        event === "USER_UPDATED"
      ) {
        sequenceRef.current += 1;
        controllerRef.current?.abort();
        setResult(null);
        setErrorMessage("");
        setLoading(false);
      }
    });

    return () => {
      sequenceRef.current += 1;
      controllerRef.current?.abort();
      data.subscription.unsubscribe();
    };
  }, []);

  async function inspectSource(
    mode: "source" | "disabled" = "source",
  ): Promise<void> {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;

    const isCurrent = () => sequence === sequenceRef.current;

    setLoading(true);
    setResult(null);
    setErrorMessage("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (!isCurrent()) return;

      if (sessionError || !session?.access_token) {
        setErrorMessage("Log eerst in met je adminaccount.");
        return;
      }

      const response = await fetch(
        mode === "disabled"
          ? "/api/admin/transfers/test-disabled"
          : "/api/admin/transfers/inspect-source",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
          signal: controller.signal,
        },
      );

      const body: unknown = await response.json();

      if (!isCurrent()) return;

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        throw new Error("De server gaf geen geldig inspectieresultaat.");
      }

      setResult({
        httpStatus: response.status,
        body: body as Record<string, unknown>,
      });
    } catch (error: unknown) {
      if (isCurrent()) {
        setErrorMessage(
          error instanceof Error && error.name === "AbortError"
            ? "De browseraanvraag is afgebroken. Er wordt niet automatisch opnieuw geprobeerd."
            : "De broninspectie kon niet worden bevestigd. Controleer de response of serverlogs voordat je opnieuw probeert.",
        );
      }
    } finally {
      inFlightRef.current = false;

      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }

      if (isCurrent()) setLoading(false);
    }
  }

  const confirmed =
    result?.httpStatus === 200 &&
    result.body.inspectionConfirmed === true &&
    result.body.transferAuthorized === false;

  return (
    <main className="min-h-screen bg-[#14171A] px-5 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin" className="text-[#D6FF3F] underline">
          ← Adminhub
        </Link>

        <p className="mt-8 font-display text-lg text-[#FF4B3E]">
          ADMIN — TESTOMGEVING
        </p>

        <h1 className="mt-3 font-display text-4xl">
          PAKKETBRON INSPECTEREN
        </h1>

        <div className="mt-6 space-y-3 border-2 border-white/30 p-5">
          <p>
            Alleen-lezen controle van de afgesproken aankoop van €100:
          </p>
          <p className="break-all font-mono text-sm">
            0ceb3427-c520-4351-9cb4-e2fb9ea08069
          </p>
          <p className="text-sm leading-relaxed text-[#B9BEC2]">
            De server controleert je adminrechten en leest daarna de
            oorspronkelijke aankoopcontext en actuele Stripe-betaalbron.
            Er wordt geen transfer geregistreerd, geclaimd of uitgevoerd.
          </p>
          <p className="text-sm leading-relaxed text-[#B9BEC2]">
            Deze aankoop hoort bij de nieuwe v2-testtrainer. Een
            geslaagde broncontrole geeft nog geen toestemming voor een
            transfer. Lesmoment, bestemming, eerdere transfers en
            financiële blokkades moeten afzonderlijk worden gecontroleerd.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void inspectSource()}
          disabled={loading}
          className="mt-6 bg-[#D6FF3F] px-6 py-4 font-display text-lg text-[#14171A] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "BRON CONTROLEREN..." : "CONTROLEER TESTBETAALBRON"}
        </button>

        <p className="mt-3 text-sm text-[#B9BEC2]">
          Geen automatische controle of retry. Alleen de server bepaalt
          welke aankoop wordt geïnspecteerd.
        </p>

        <div className="mt-6 border-2 border-white/30 p-5">
          <h2 className="font-display text-xl">
            UITGESCHAKELDE UITVOERDER TESTEN
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-[#B9BEC2]">
            Controleert uitsluitend dat de uitvoerder stopt voordat hij
            een transferopdracht leest of claimt. Geen Stripe-aanroep.
            Als uitvoering is ingeschakeld, weigert deze testroute.
          </p>

          <button
            type="button"
            onClick={() => void inspectSource("disabled")}
            disabled={loading}
            className="mt-4 border-2 border-[#D6FF3F] px-5 py-3 font-display text-base text-[#D6FF3F] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "CONTROLEREN..." : "TEST UITVOERDER UITGESCHAKELD"}
          </button>
        </div>

        {errorMessage && (
          <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-4">
            {errorMessage}
          </div>
        )}

        {result && (
          <section className="mt-8 border-2 border-white/30 p-5">
            <h2 className="font-display text-xl">
              {result.httpStatus === 200 &&
              result.body.testPassed === true &&
              result.body.executionResult === "disabled" &&
              result.body.transferExecuted === false
                ? "BLOKKADETEST GESLAAGD — UITVOERDER STAAT UIT"
                : confirmed
                  ? "BRONCONTROLE GESLAAGD — GEEN TRANSFERGOEDKEURING"
                  : "CONTROLE NIET BEVESTIGD"}
            </h2>

            <p className="mt-3">HTTP-status: {result.httpStatus}</p>

            <pre className="mt-4 max-h-[600px] overflow-auto whitespace-pre-wrap break-all bg-black/30 p-4 text-xs">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}