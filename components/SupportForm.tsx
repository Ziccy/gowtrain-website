"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

type Feedback = {
  kind: "success" | "error" | "uncertain";
  message: string;
  reference?: string;
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

export default function SupportForm() {
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const inFlight = useRef(false);

  const submission = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);

  const terminal =
    feedback?.kind === "success" ||
    feedback?.kind === "uncertain";

  const fieldClass =
    "mt-2 w-full rounded-none border-2 border-white/25 bg-[#14171A] px-4 py-3 text-base text-white outline-none transition placeholder:text-[#8A8F94] focus:border-[#D6FF3F] disabled:opacity-60";

  async function submit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (inFlight.current || terminal) return;

    const values = {
      email: email.trim(),
      subject: subject.trim(),
      message: message.trim(),
      website,
    };

    if (
      values.subject.length < 3 ||
      values.message.length < 10
    ) {
      setFeedback({
        kind: "error",
        message:
          "Gebruik minimaal 3 tekens voor het onderwerp en 10 voor je bericht.",
      });
      return;
    }

    const fingerprint = JSON.stringify(values);

    if (
      !submission.current ||
      submission.current.fingerprint !== fingerprint
    ) {
      submission.current = {
        fingerprint,
        id: crypto.randomUUID(),
      };
    }

    const submissionId = submission.current.id;

    inFlight.current = true;
    setBusy(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submissionId,
          ...values,
        }),
        credentials: "same-origin",
        signal: AbortSignal.timeout(50_000),
      });

      let result: unknown = null;

      try {
        result = await response.json();
      } catch {
        // Een onleesbaar antwoord bewijst niet dat niets is verstuurd.
      }

      if (
        response.ok &&
        isObject(result) &&
        result.accepted === true &&
        result.submissionId === submissionId
      ) {
        setFeedback({
          kind: "success",
          message:
            "Je bericht is verstuurd. We reageren via het opgegeven e-mailadres.",
        });

        setMessage("");
        return;
      }

      const code =
        isObject(result) && typeof result.code === "string"
          ? result.code
          : "";

      const confirmedNoSend =
        (response.status === 400 && code === "INVALID_INPUT") ||
        (response.status === 403 && code === "FORBIDDEN") ||
        (response.status === 429 && code === "RATE_LIMITED") ||
        (
          response.status === 503 &&
          [
            "DELIVERY_FAILED",
            "TEMPORARILY_UNAVAILABLE",
          ].includes(code)
        );

      if (confirmedNoSend) {
        submission.current = null;

        let errorMessage =
          "Versturen is niet gelukt. Bewaar je bericht en probeer het later opnieuw.";

        if (code === "INVALID_INPUT") {
          errorMessage =
            "Controleer je e-mailadres, onderwerp en bericht. Het onderwerp mag maximaal 120 tekens bevatten en het bericht 5000.";
        } else if (code === "FORBIDDEN") {
          errorMessage =
            "Verstuur je bericht via het contactformulier op deze website.";
        } else if (code === "RATE_LIMITED") {
          errorMessage =
            "Er zijn te veel verzendpogingen gedaan. Probeer het over een uur opnieuw.";
        }

        setFeedback({
          kind: "error",
          message: errorMessage,
        });
        return;
      }

      setFeedback({
        kind: "uncertain",
        message:
          "We weten niet zeker of je bericht is verstuurd. Verstuur het niet meteen opnieuw en bewaar je bericht en het onderstaande nummer.",
        reference: submissionId,
      });
    } catch {
      setFeedback({
        kind: "uncertain",
        message:
          "De verbinding is onderbroken. Je bericht kan al zijn verstuurd. Verstuur het niet meteen opnieuw en bewaar je bericht en het onderstaande nummer.",
        reference: submissionId,
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="border-2 border-white/20 bg-[#191D21] p-6 sm:p-8">
      {feedback?.kind === "success" ? (
        <div
          role="status"
          aria-live="polite"
          className="py-6 sm:py-10"
        >
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center bg-[#D6FF3F] text-3xl font-bold text-[#14171A]"
          >
            ✓
          </div>

          <h2 className="mt-6 font-display text-4xl text-white">
            BEDANKT!
          </h2>

          <p className="mt-4 max-w-md text-lg leading-relaxed text-[#D7D9DA]">
            {feedback.message}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={busy}>
          <fieldset
            disabled={busy || terminal}
            className="min-w-0 space-y-6"
          >
            <legend className="sr-only">
              Stuur Gowtrain een bericht
            </legend>

            <div>
              <label
                htmlFor="support-email"
                className="font-semibold"
              >
                E-mailadres
              </label>

              <input
                id="support-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={fieldClass}
              />
            </div>

            <div>
              <label
                htmlFor="support-subject"
                className="font-semibold"
              >
                Onderwerp
              </label>

              <input
                id="support-subject"
                name="subject"
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className={fieldClass}
              />
            </div>

            <div>
              <label
                htmlFor="support-message"
                className="font-semibold"
              >
                Bericht
              </label>

              <textarea
                id="support-message"
                name="message"
                required
                minLength={10}
                maxLength={5000}
                rows={7}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className={`${fieldClass} resize-y`}
                aria-describedby="support-message-help"
              />

              <p
                id="support-message-help"
                className="mt-2 text-xs leading-relaxed text-[#B9BEC2]"
              >
                Maximaal 5000 tekens. Deel geen wachtwoorden,
                statusbewijzen of gevoelige betaalgegevens.
              </p>
            </div>

            {/* Honeypot; servervalidatie en begrenzing blijven verplicht. */}
            <div hidden aria-hidden="true">
              <label htmlFor="support-website">
                Website leeg laten
              </label>

              <input
                id="support-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                maxLength={200}
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>

            <p className="text-sm leading-relaxed text-[#B9BEC2]">
              We gebruiken je gegevens om je bericht te beantwoorden.
              Lees ons{" "}
              <Link
                href="/privacy"
                className="text-white underline decoration-[#D6FF3F] underline-offset-4 hover:text-[#D6FF3F]"
              >
                privacybeleid
              </Link>
              .
            </p>

            {!terminal && (
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-3 bg-[#FF4B3E] px-7 py-4 font-display text-xl text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D6FF3F] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
              >
                {busy ? "VERSTUREN…" : "VERSTUUR BERICHT"}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            )}
          </fieldset>

          {feedback && (
            <div
              role="alert"
              className="mt-6 border-l-4 border-[#FF4B3E] bg-[#FF4B3E]/10 p-4"
            >
              <p className="leading-relaxed">
                {feedback.message}
              </p>

              {feedback.reference && (
                <p className="mt-3 break-all text-sm">
                  <strong>Inzendnummer:</strong>{" "}
                  {feedback.reference}
                </p>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}