"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type ReviewAdminItem = {
  id: string;
  booking_id: string;
  trainer_id: string;
  player_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  trainer_name: string;
  trainer_sport: string;
  player_name: string;
};

type RatingFilter = "all" | "5" | "4" | "3" | "low";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AdminReviewsPage() {
  const router = useRouter();

  const [reviews, setReviews] = useState<ReviewAdminItem[]>([]);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    void verifyAdminAndLoadReviews();
  }, []);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function verifyAdminAndLoadReviews(): Promise<void> {
    setLoading(true);
    clearMessages();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/speler-login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profile?.role !== "admin") {
        await supabase.auth.signOut();
        router.replace("/speler-login");
        return;
      }

      await loadReviews();
    } catch (error) {
      console.error("Admin reviews verificatie fout:", error);
      showError("Toegang kon niet worden geverifieerd.");
    } finally {
      setLoading(false);
    }
  }

  async function loadReviews(): Promise<void> {
    // 1. Reviews ophalen
    const { data: reviewData, error: reviewError } = await supabase
      .from("trainer_reviews")
      .select("*")
      .order("created_at", { ascending: false });

    if (reviewError) {
      console.error("Reviews laden fout:", reviewError.message);
      showError("Reviews konden niet worden geladen.");
      return;
    }

    if (!reviewData || reviewData.length === 0) {
      setReviews([]);
      return;
    }

    // 2. Trainer- en spelergegevens ophalen
    const trainerIds = Array.from(new Set(reviewData.map((r) => r.trainer_id)));
    const playerIds = Array.from(new Set(reviewData.map((r) => r.player_id)));

    const { data: trainersData } = await supabase
      .from("trainers")
      .select("id, name, sport")
      .in("id", trainerIds);

    const { data: playersData } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", playerIds);

    const trainerMap = new Map(trainersData?.map((t) => [t.id, t]) || []);
    const playerMap = new Map(playersData?.map((p) => [p.id, p.full_name]) || []);

    const formattedReviews: ReviewAdminItem[] = reviewData.map((r) => {
      const tr = trainerMap.get(r.trainer_id);
      return {
        id: r.id,
        booking_id: r.booking_id,
        trainer_id: r.trainer_id,
        player_id: r.player_id,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
        trainer_name: tr?.name || "Onbekende Trainer",
        trainer_sport: tr?.sport || "Sport",
        player_name: playerMap.get(r.player_id) || "Speler",
      };
    });

    setReviews(formattedReviews);
  }

  // REVIEW VERWIJDEREN (HERBEREKENT AUTOMATISCH GEMIDDELDE IN DB)
  async function deleteReview(reviewId: string, trainerName: string): Promise<void> {
    setDeletingId(reviewId);
    clearMessages();

    try {
      const { error } = await supabase
        .from("trainer_reviews")
        .delete()
        .eq("id", reviewId);

      if (error) {
        showError("Review kon niet worden verwijderd.");
        return;
      }

      setSuccessMessage(`Review voor ${trainerName} is verwijderd. De gemiddelde rating is automatisch bijgewerkt.`);
      await loadReviews();
    } catch {
      showError("Review kon niet worden verwijderd.");
    } finally {
      setDeletingId(null);
    }
  }

  // TELLER BEREKENINGEN
  const avgRating = useMemo(() => {
    if (reviews.length === 0) return "0.0";
    const total = reviews.reduce((sum, r) => sum + r.rating, 0);
    return (total / reviews.length).toFixed(1);
  }, [reviews]);

  const fiveStarCount = useMemo(
    () => reviews.filter((r) => r.rating === 5).length,
    [reviews]
  );

  // FILTERED REVIEWS
  const filteredReviews = useMemo(() => {
    return reviews.filter((r) => {
      if (ratingFilter === "5" && r.rating !== 5) return false;
      if (ratingFilter === "4" && r.rating !== 4) return false;
      if (ratingFilter === "3" && r.rating !== 3) return false;
      if (ratingFilter === "low" && r.rating > 2) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.trim().toLowerCase();
      const searchable = [r.trainer_name, r.player_name, r.comment ?? ""]
        .join(" ")
        .toLowerCase();

      return searchable.includes(q);
    });
  }, [reviews, ratingFilter, searchQuery]);

  /* BRANDBOOK BRANDED LOADER */
  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F]">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">REVIEWS LADEN...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/admin" aria-label="Admin hub" className="group inline-flex items-center gap-2">
            <span className="font-display text-3xl text-[#D6FF3F] sm:text-4xl">GOWTRAIN</span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform group-hover:translate-x-1" />
          </Link>

          <Link href="/admin" className="font-display text-sm text-white hover:text-[#D6FF3F]">
            ← ADMIN HUB
          </Link>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">ADMIN / REVIEWS</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                SPELER<br />REVIEWS.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
                Beheer alle geschreven spelerbeoordelingen op GowTrain en controleer de kwaliteit van de lessen.
              </p>
            </div>
          </div>

          {errorMessage && <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">{errorMessage}</div>}
          {successMessage && <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">{successMessage}</div>}

          {/* TELLER CARDS */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-white bg-white p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{reviews.length}</p>
              <p className="mt-2 font-display text-base">TOTAAL GESCHREVEN REVIEWS</p>
            </div>

            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{avgRating} ★</p>
              <p className="mt-2 font-display text-base">GEMIDDELDE PLATFORM RATING</p>
            </div>

            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-5xl">{fiveStarCount}</p>
              <p className="mt-2 font-display text-base">5-STERREN BEOORDELING(EN)</p>
            </div>
          </div>

          {/* FILTERS & ZOEKBALK */}
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b-2 border-white/20 pb-6">
            <div className="flex border-2 border-white/25 transition focus-within:border-[#D6FF3F] sm:w-80">
              <span className="flex items-center px-3 text-lg text-[#D6FF3F]">⌕</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Zoek op trainer, speler of tekst..."
                className="w-full bg-transparent py-2.5 pr-3 text-xs text-white outline-none placeholder:text-[#8A8F94]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["ALLES", "all"],
                  ["5 ★", "5"],
                  ["4 ★", "4"],
                  ["3 ★", "3"],
                  ["1-2 ★ (LAGE SCORES)", "low"],
                ] as [string, RatingFilter][]
              ).map(([label, value]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRatingFilter(value)}
                  className={`border-2 px-3.5 py-2 font-display text-xs transition ${
                    ratingFilter === value
                      ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                      : "border-white/30 text-white hover:border-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* REVIEWS GRID (VERBETERDE KAARTEN) */}
          {filteredReviews.length === 0 ? (
            <div className="mt-8 border-2 border-white/20 p-8 text-center text-[#B9BEC2]">
              Geen reviews gevonden binnen deze selectie.
            </div>
          ) : (
            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredReviews.map((rev) => {
                const isDeleting = deletingId === rev.id;

                return (
                  <article key={rev.id} className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                    <div className="bg-[#14171A] p-5 text-white flex flex-col justify-between h-full space-y-4">
                      
                      <div>
                        {/* TOP: SPELERSNAAM + STERREN BADGE */}
                        <div className="flex justify-between items-start gap-3 border-b border-white/15 pb-3">
                          <div>
                            <span className="bg-[#FF4B3E] px-2 py-0.5 font-display text-[10px] text-white uppercase">
                              SPELER
                            </span>
                            <h3 className="font-display text-2xl mt-1 text-white">{rev.player_name}</h3>
                          </div>

                          <span className="bg-[#D6FF3F] px-2.5 py-1 font-display text-xs text-[#14171A] shrink-0">
                            {rev.rating} ★
                          </span>
                        </div>

                        {/* TRAINER INFO */}
                        <div className="mt-3">
                          <p className="text-xs text-[#B9BEC2]">
                            Over trainer: <strong className="text-[#D6FF3F] font-display text-sm">{rev.trainer_name}</strong> ({rev.trainer_sport})
                          </p>
                        </div>

                        {/* QUOTE BOKS */}
                        <div className="mt-4 border-l-2 border-[#D6FF3F] bg-white/5 p-3.5">
                          <p className="text-xs leading-relaxed text-[#D7D9DA] italic">
                            "{rev.comment || "Geen geschreven toelichting gegeven."}"
                          </p>
                        </div>
                      </div>

                      {/* ONDERKANT: DATUM & VERWIJDERKNOP */}
                      <div className="pt-3 border-t border-white/15 space-y-3">
                        <p className="text-[10px] text-[#8A8F94]">
                          Geschreven op {formatDate(rev.created_at)}
                        </p>

                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void deleteReview(rev.id, rev.trainer_name)}
                          className="w-full border-2 border-[#FF4B3E] bg-[#14171A] py-2.5 font-display text-xs text-[#FF4B3E] transition hover:bg-[#FF4B3E] hover:text-white disabled:opacity-60"
                        >
                          {isDeleting ? "VERWIJDEREN..." : "✕ VERWIJDER REVIEW"}
                        </button>
                      </div>

                    </div>
                  </article>
                );
              })}
            </div>
          )}

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}