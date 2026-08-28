"use client";

import type { FormEvent } from "react";
import { useState } from "react";
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
    description:
      "De speler was niet aanwezig op het afgesproken moment. Er volgt niet automatisch een refund.",
  },
  {
    value: "weather",
    label: "SLECHT WEER",
    description:
      "De training kon niet doorgaan door regen, wind of andere weersomstandigheden.",
  },
  {
    value: "court_unavailable",
    label: "BAAN NIET BESCHIKBAAR",
    description:
      "De baan was niet beschikbaar, gesloten of onbespeelbaar.",
  },
  {
    value: "other",
    label: "ANDER PROBLEEM",
    description:
      "Er is iets anders misgegaan met deze training.",
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

  function clearError(): void {
    setErrorMessage("");
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    clearError();

    setSubmitting(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setErrorMessage("Je sessie is verlopen. Log opnieuw in.");
        return;
      }

      const { error } = await supabase.from("booking_issues").insert({
        booking_id: bookingId,
        reporter_user_id: user.id,
        reporter_role: "trainer",
        issue_type: selectedIssueType,
        description: description.trim() || null,
        status: "open",
      });

      if (error) {
        console.error("Trainerprobleem melden fout:", error.message);

        setErrorMessage(
          "Je melding kon niet worden verstuurd. Probeer het opnieuw."
        );

        return;
      }

      onSubmitted();
    } catch (error) {
      console.error("Onverwachte trainer issue-melding fout:", error);

      setErrorMessage(
        "Je melding kon niet worden verstuurd. Probeer het opnieuw."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white sm:p-6">
      <p className="font-display text-3xl">PROBLEEM MELDEN?</p>

      <p className="mt-3 max-w-2xl leading-relaxed text-white/90">
        Meld wat er is misgegaan bij de training met{" "}
        <strong>{playerName}</strong>.
      </p>

      <div className="mt-5 border-l-2 border-white pl-4">
        <p className="font-display text-lg">{trainingLabel}</p>

        <p className="mt-2 text-sm leading-relaxed text-white/90">
          Gowtrain beoordeelt de melding. Bij slecht weer of een baanprobleem
          kijken we eerst naar gratis verplaatsen of Gowtrain-tegoed.
        </p>
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="mt-6 border-2 border-white bg-[#14171A] px-4 py-3 font-semibold text-white"
        >
          {errorMessage}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6">
        <fieldset>
          <legend className="font-display text-base">
            WAT IS ER GEBEURD?
          </legend>

          <div className="mt-3 grid gap-3">
            {issueOptions.map((option) => {
              const isSelected = selectedIssueType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    clearError();
                    setSelectedIssueType(option.value);
                  }}
                  className={`border-2 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSelected
                      ? "border-[#14171A] bg-[#14171A] text-white"
                      : "border-white text-white hover:bg-white hover:text-[#14171A]"
                  }`}
                >
                  <span className="block font-display text-lg">
                    {option.label}
                  </span>

                  <span
                    className={`mt-2 block text-sm leading-relaxed ${
                      isSelected ? "text-[#D7D9DA]" : "text-white/90"
                    }`}
                  >
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-6">
          <label
            htmlFor="trainer-booking-issue-description"
            className="mb-2 block font-display text-base"
          >
            EXTRA UITLEG{" "}
            <span className="text-white/70">(OPTIONEEL)</span>
          </label>

          <textarea
            id="trainer-booking-issue-description"
            rows={4}
            maxLength={1000}
            disabled={submitting}
            value={description}
            onChange={(event) => {
              clearError();
              setDescription(event.target.value);
            }}
            placeholder="Vertel kort wat er is gebeurd."
            className="w-full resize-y border-2 border-white bg-transparent px-4 py-4 text-white outline-none placeholder:text-white/60 focus:border-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="border-2 border-white px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
          >
            TERUG
          </button>

          <button
            type="submit"
            disabled={submitting}
            className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "MELDING VERSTUREN..." : "MELD PROBLEEM"}
          </button>
        </div>
      </form>
    </section>
  );
}