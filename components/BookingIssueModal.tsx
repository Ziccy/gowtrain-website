"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type BookingIssueModalProps = {
  bookingId: string;
  trainerName: string;
  trainingLabel: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const ISSUE_REASONS = [
  { id: "no_show", label: "De trainer was niet aanwezig (No-show)" },
  { id: "late_or_short", label: "De trainer was te laat of de les was korter" },
  { id: "venue_issue", label: "Geen baan beschikbaar of verkeerde locatie" },
  { id: "other", label: "Overige klacht of probleem" },
];

export default function BookingIssueModal({
  bookingId,
  trainerName,
  trainingLabel,
  onClose,
  onSubmitted,
}: BookingIssueModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>("no_show");
  const [details, setDetails] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const reasonObj = ISSUE_REASONS.find((r) => r.id === selectedReason);
      const fullMessage = `[${reasonObj?.label || selectedReason}] ${details.trim()}`;

      const { error } = await supabase.from("booking_issues").insert({
        booking_id: bookingId,
        reported_by_id: session.user.id,
        reporter_role: "player",
        issue_type: selectedReason,
        description: fullMessage,
        status: "open",
      });

      if (error) {
        setErrorMessage("Melding kon niet worden opgeslagen. Probeer het opnieuw.");
        return;
      }

      onSubmitted();
    } catch {
      setErrorMessage("Er ging iets mis met het versturen van je melding.");
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
                Les bij {trainerName} · {trainingLabel}
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
              {ISSUE_REASONS.map((reason) => {
                const isSelected = selectedReason === reason.id;
                return (
                  <button
                    key={reason.id}
                    type="button"
                    onClick={() => setSelectedReason(reason.id)}
                    className={`w-full border-2 p-3 text-left font-display text-xs transition select-none flex items-center justify-between ${
                      isSelected
                        ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] font-bold"
                        : "border-white/25 bg-[#14171A] text-white hover:bg-white hover:text-[#14171A]"
                    }`}
                  >
                    <span>{reason.label}</span>
                    {isSelected && <span>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block font-display text-xs text-[#D6FF3F] mb-1 uppercase">
              Licht toe wat er precies misging (optioneel)
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Bijv: Trainer was niet aanwezig op de club..."
              rows={3}
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