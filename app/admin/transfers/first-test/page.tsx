"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

const BOOKING_ID = "c413bd74-8c8f-4ba5-8f03-98430c08f905";
const PURCHASE_ID = "c02e8212-9379-4f3f-8edd-023dea74910a";
const CONFIRMATION = "TRANSFER 19 EUR";

type Result = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export default function AdminFirstTransferTestPage() {
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const inFlightRef = useRef(false);
  const sequenceRef = useRef(0);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_OUT" ||
        event === "SIGNED_IN" ||
        event === "USER_UPDATED"
      ) {
        sequenceRef.current += 1;
        setResult(null);
        setConfirmation("");
        setAcknowledged(false);
        setLoading(false);
        setErrorMessage("");

        /*
         * submitted bewust niet terugzetten:
         * een sessiewijziging trekt een al verzonden aanvraag niet in.
         */
      }
    });

    return () => {
      sequenceRef.current += 1;
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(): Promise<void> {
    if (
      inFlightRef.current ||
      submitted ||
      !acknowledged ||
      confirmation !== CONFIRMATION
    ) {
      return;
    }

    inFlightRef.current = true;
    const sequence = ++sequenceRef.current;
    const isCurrent = () => sequenceRef.current === sequence;

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
        setErrorMessage("Log eerst in met een adminaccount.");
        return;
      }

      /*
       * Na verzending niet opnieuw aanbieden binnen deze pagina,
       * ook niet bij een timeout of onleesbare response.
       */
      setSubmitted(true);

      const response = await fetch(
        "/api/admin/transfers/execute-first-test",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            bookingId: BOOKING_ID,
            purchaseId: PURCHASE_ID,
            amountCents: 1900,
            confirmation,
          }),
        },
      );

      const body: unknown = await response.json();

      if (!isCurrent()) return;

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        throw new Error("Ongeldige serverresponse.");
      }

      setResult({
        httpStatus: response.status,
        body: body as Record<string, unknown>,
      });
    } catch {
      if (isCurrent()) {
        setErrorMessage(
          "De response kon niet worden bevestigd. Sluiten, verversen of een netwerkfout trekt de serveraanvraag niet in. Niet opnieuw klikken; controleer eerst de opdracht en Stripe-uitkomst.",
        );
      }
    } finally {
      inFlightRef.current = false;
      if (isCurrent()) setLoading(false);
    }
  }

  const heading =
    result?.httpStatus === 200 &&
    result.body.result === "disabled"
      ? "UITVOERING STAAT UIT — GEEN TRANSFER GESTART"
      : result?.httpStatus === 200 &&
          result.body.result === "synchronized" &&
          result.body.executionConfirmed === true
        ? "TESTTRANSFER GESYNCHRONISEERD — CONTROLEER HET RESULTAAT"
        : "UITVOERING NIET BEVESTIGD";

  return (
    <main className="min-h-screen bg-[#14171A] px-5 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin" className="text-[#D6FF3F] underline">
          ← Adminhub
        </Link>

        <p className="mt-8 font-display text-lg text-[#FF4B3E]">
          ADMIN — EERSTE STRIPE-TESTTRANSFER
        </p>

        <h1 className="mt-3 font-display text-4xl">
          EXPLICIETE TRANSFERTEST
        </h1>

        <div className="mt-6 space-y-4 border-2 border-[#FF4B3E] p-5">
          <p className="font-semibold">
            Dit is een uitvoeringsingang, geen alleen-lezen inspectie.
          </p>

          <p className="text-sm leading-relaxed">
            Als uitvoering server-side is ingeschakeld en alle controles
            slagen, kan deze knop één Stripe-testtransfer van €19 starten.
            Bij uitgeschakelde uitvoering stopt de route vóór registratie.
          </p>

          <p className="text-sm leading-relaxed">
            De pagina kan de serverinstelling niet vooraf garanderen.
            De server controleert de instelling bij iedere aanvraag.
          </p>
        </div>

        <dl className="mt-6 space-y-4 border border-white/30 p-5 text-sm">
          <div>
            <dt className="text-[#B9BEC2]">Trainersdeel</dt>
            <dd className="mt-1 font-display text-3xl text-[#D6FF3F]">
              €19,00
            </dd>
          </div>

          <div>
            <dt className="text-[#B9BEC2]">Boeking</dt>
            <dd className="mt-1 break-all">{BOOKING_ID}</dd>
          </div>

          <div>
            <dt className="text-[#B9BEC2]">Pakketaankoop</dt>
            <dd className="mt-1 break-all">{PURCHASE_ID}</dd>
          </div>

          <div>
            <dt className="text-[#B9BEC2]">Stripe-testbestemming</dt>
            <dd className="mt-1 break-all">acct_1UHJRCBAMjpV6Qwm</dd>
          </div>

          <div>
            <dt className="text-[#B9BEC2]">Eerste les</dt>
            <dd className="mt-1">
              26 september 2026, 19:00 Amsterdam
            </dd>
          </div>

          <div>
            <dt className="text-[#B9BEC2]">Vroegste transfermoment</dt>
            <dd className="mt-1">
              27 september 2026, 19:00 Amsterdam.
              De database controleert het daadwerkelijke tijdstip.
            </dd>
          </div>
        </dl>

        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={loading || submitted}>
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1"
              />
              <span>
                Ik begrijp dat dit alleen de genoemde testtransfer betreft,
                geen bankuitbetaling. Bij een onzekere uitkomst vraag ik
                niet opnieuw een transfer aan.
              </span>
            </label>

            <label
              htmlFor="transfer-confirmation"
              className="mt-6 block text-sm"
            >
              Typ exact: <strong>{CONFIRMATION}</strong>
            </label>

            <input
              id="transfer-confirmation"
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full border-2 border-white/30 bg-transparent px-4 py-3 text-white"
            />

            <button
              type="submit"
              disabled={
                loading ||
                submitted ||
                !acknowledged ||
                confirmation !== CONFIRMATION
              }
              className="mt-5 bg-[#FF4B3E] px-6 py-4 font-display text-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? "AANVRAAG WORDT VERWERKT..."
                : submitted
                  ? "AANVRAAG VERZONDEN — NIET HERHALEN"
                  : "DIEN EENMALIGE TRANSFERAANVRAAG IN"}
            </button>
          </fieldset>
        </form>

        <p className="mt-4 text-sm leading-relaxed text-[#B9BEC2]">
          Geen automatische retry. Het sluiten of verversen van deze
          pagina annuleert een gestarte serveraanvraag niet.
        </p>

        {errorMessage && (
          <div role="alert" className="mt-6 border-2 border-[#FF4B3E] p-4">
            {errorMessage}
          </div>
        )}

        {result && (
          <section className="mt-8 border-2 border-white/30 p-5">
            <h2 className="font-display text-xl">{heading}</h2>
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