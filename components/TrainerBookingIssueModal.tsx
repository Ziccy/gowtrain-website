"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type TrainerIssueType =
  | "player_no_show"
  | "weather"
  | "court_unavailable"
  | "other";

type TrainerBookingIssueModalProps = {
  bookingId: string;
  playerName: string;
  trainingLabel: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const issueOptions: Array<{
  value: TrainerIssueType;
  label: string;
  description: string;
}> = [
  {
    value: "player_no_show",
    label: "SPELER NIET VERSCHENEN",
    description: "De speler was niet aanwezig op het afgesproken moment.",
  },
  {
    value: "weather",
    label: "SLECHT WEER",
    description:
      "De training kon niet doorgaan door regen, wind of weersomstandigheden.",
  },
  {
    value: "court_unavailable",
    label: "BAAN NIET BESCHIKBAAR",
    description: "De baan was niet beschikbaar, gesloten of onbespeelbaar.",
  },
  {
    value: "other",
    label: "ANDER PROBLEEM",
    description: "Er is iets anders misgegaan met deze training.",
  },
];

export default function TrainerBookingIssueModal({
  bookingId,
  playerName,
  trainingLabel,
  onClose,
  onSubmitted,
}: TrainerBookingIssueModalProps) {
  const [selectedIssueType, setSelectedIssueType] =
    useState<TrainerIssueType>("player_no_show");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;

    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      dialog?.close();

      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  function closeModal(): void {
    if (submittingRef.current) return;
    onClose();
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (submittingRef.current) return;

    setErrorMessage("");

    const details = description.trim();

    if (details.length > 1000) {
      setErrorMessage("De toelichting mag maximaal 1000 tekens bevatten.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      /*
       * De database bepaalt de melder, eigenaar, tijdslimiet
       * en toegestane status. Geen directe tabel-INSERT.
       */
      const { data, error } = await supabase.rpc(
        "report_trainer_booking_issue",
        {
          p_booking_id: bookingId,
          p_reason: selectedIssueType,
          p_details: details || null,
        },
      );

      if (error) {
        console.error("Trainermelding kon niet worden bevestigd.", {
          code: error.code,
        });

        setErrorMessage(
          error.code === "P0001" || error.code === "42501"
            ? error.message
            : "De melding kon niet worden bevestigd. Controleer het overzicht voordat je opnieuw probeert.",
        );
        return;
      }

      if (
        typeof data !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          data,
        )
      ) {
        setErrorMessage(
          "Geen geldige bevestiging ontvangen. De melding kan al geregistreerd zijn. Controleer eerst het overzicht.",
        );
        return;
      }
    } catch {
      setErrorMessage(
        "De verbinding is onderbroken. De melding kan al geregistreerd zijn. Controleer het overzicht; dien geen afzonderlijke refundaanvraag in.",
      );
      return;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }

    onSubmitted();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="trainer-issue-title"
      aria-describedby="trainer-issue-help"
      onCancel={(event) => {
        event.preventDefault();
        closeModal();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border-2 border-[#FF4B3E] bg-[#14171A] p-0 text-white shadow-[8px_8px_0_0_#D6FF3F] backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <div className="border-b-2 border-white/20 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xs text-[#FF4B3E]">
              TRAINING / MELDING
            </p>
            <h2 id="trainer-issue-title" className="mt-1 font-display text-2xl">
              PROBLEEM MELDEN
            </h2>
            <p className="mt-2 text-xs text-[#B9BEC2]">
              Les met {playerName} · {trainingLabel}
            </p>
          </div>

          <button
            type="button"
            aria-label="Meldvenster sluiten"
            disabled={submitting}
            onClick={closeModal}
            className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-white font-display text-lg transition hover:bg-[#FF4B3E] disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <p
          id="trainer-issue-help"
          className="mt-4 text-xs leading-relaxed text-[#B9BEC2]"
        >
          Melden kan vanaf de start van de les tot 24 uur daarna.
          Een melding is geen besluit over schuld, terugbetaling of
          trainervergoeding. De speler wordt neutraal geïnformeerd.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-5">
        <fieldset disabled={submitting}>
          <legend className="mb-2 font-display text-xs text-[#D6FF3F]">
            WAT IS ER GEBEURD?
          </legend>

          <div className="space-y-2">
            {issueOptions.map((option) => {
              const selected = selectedIssueType === option.value;

              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 border-2 p-3 transition ${
                    selected
                      ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                      : "border-white/25 hover:border-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="trainer-issue-type"
                    value={option.value}
                    checked={selected}
                    onChange={() => {
                      setErrorMessage("");
                      setSelectedIssueType(option.value);
                    }}
                    className="mt-1 shrink-0"
                  />
                  <span>
                    <span className="block font-display text-sm">
                      {option.label}
                    </span>
                    <span
                      className={`mt-1 block text-xs ${
                        selected ? "text-[#14171A]/80" : "text-[#B9BEC2]"
                      }`}
                    >
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor="trainer-issue-description"
            className="mb-2 block font-display text-xs text-[#D6FF3F]"
          >
            EXTRA UITLEG — OPTIONEEL
          </label>

          <textarea
            id="trainer-issue-description"
            rows={4}
            maxLength={1000}
            disabled={submitting}
            value={description}
            onChange={(event) => {
              setErrorMessage("");
              setDescription(event.target.value);
            }}
            placeholder="Beschrijf feitelijk wat er is gebeurd."
            className="w-full resize-y border-2 border-white/25 bg-transparent p-3 text-sm outline-none focus:border-[#D6FF3F] disabled:opacity-50"
          />

          <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
            Gebruik dit niet voor vertrouwelijke interne informatie.
            Betrokken partijen kunnen de melding via hun datatoegang inzien.
          </p>

          <p className="mt-2 text-right text-xs text-[#B9BEC2]">
            {description.length} / 1000
          </p>
        </div>

        {errorMessage && (
          <p
            role="alert"
            className="border border-[#FF4B3E] bg-[#FF4B3E]/10 p-3 text-sm text-[#FF4B3E]"
          >
            {errorMessage}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-[#FF4B3E] px-4 py-3.5 font-display text-sm transition hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:opacity-50"
          >
            {submitting ? "REGISTREREN..." : "MELDING INDIENEN →"}
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={closeModal}
            className="border-2 border-white/30 px-4 py-3.5 font-display text-xs transition hover:border-white disabled:opacity-50"
          >
            TERUG
          </button>
        </div>
      </form>
    </dialog>
  );
}