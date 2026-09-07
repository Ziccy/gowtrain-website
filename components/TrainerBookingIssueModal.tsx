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
      "De speler was niet aanwezig op het afgesproken moment.",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border-2 border-[#FF4B3E] bg-[#14171A] text-white shadow-[10px_10px_0_0_#D6FF3F]">
        
        {/* HEADER */}
        <div className="border-b-2 border-white/20 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="bg-[#FF4B3E] px-2.5 py-0.5 font-display text-[10px] text-white uppercase">
                GOWTRAIN GARANTIE
              </span>
              <h3 className="font-display text-2xl text-white mt-1">
                PROBLEEM MELDEN
              </h3>
              <p className="text-xs text-[#B9BEC2] mt-1">
                Les met {playerName} · {trainingLabel}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-white font-display text-lg text-white hover:bg-[#FF4B3E] transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* FORM */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block font-display text-xs text-[#D6FF3F] mb-2 uppercase">
              Wat is er gebeurd?
            </label>

            <div className="space-y-2">
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
                    className={`w-full border-2 p-3 text-left transition select-none flex flex-col justify-between ${
                      isSelected
                        ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                        : "border-white/25 bg-[#14171A] text-white hover:bg-white hover:text-[#14171A]"
                    }`}
                  >
                    <span className="font-display text-sm">
                      {option.label}
                    </span>
                    <span
                      className={`text-xs mt-0.5 ${
                        isSelected ? "text-[#14171A]/80" : "text-[#B9BEC2]"
                      }`}
                    >
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="trainer-issue-description"
              className="block font-display text-xs text-[#D6FF3F] mb-1 uppercase"
            >
              Extra uitleg <span className="text-white/60">(optioneel)</span>
            </label>

            <textarea
              id="trainer-issue-description"
              rows={3}
              maxLength={1000}
              disabled={submitting}
              value={description}
              onChange={(event) => {
                clearError();
                setDescription(event.target.value);
              }}
              placeholder="Vertel kort wat er is gebeurd..."
              className="w-full border-2 border-white/25 bg-transparent p-3 text-xs text-white outline-none focus:border-[#D6FF3F]"
            />
          </div>

          {errorMessage && (
            <p className="text-xs text-[#FF4B3E] font-semibold bg-[#FF4B3E]/10 p-2.5 border border-[#FF4B3E]">
              {errorMessage}
            </p>
          )}

          <div className="pt-2 flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-[#FF4B3E] py-3.5 font-display text-sm text-white hover:bg-[#D6FF3F] hover:text-[#14171A] transition disabled:opacity-50"
            >
              {submitting ? "VERSTUREN..." : "VERSTUUR MELDING. GOW! →"}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="border-2 border-white/30 px-4 py-3.5 font-display text-xs text-white hover:border-white"
            >
              ANNULEREN
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}