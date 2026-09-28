"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SiteHeader from "@/components/SiteHeader";
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
  is_hidden: boolean;
  trainer_name: string;
  trainer_sport: string;
  player_name: string;
};

type RatingFilter = "all" | "5" | "4" | "3" | "low";
type VisibilityFilter = "all" | "visible" | "hidden";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATING_FILTERS: readonly [string, RatingFilter][] = [
  ["ALLES", "all"],
  ["5 ★", "5"],
  ["4 ★", "4"],
  ["3 ★", "3"],
  ["1–2 ★", "low"],
];

const VISIBILITY_FILTERS: readonly [string, VisibilityFilter][] = [
  ["ALLE REVIEWS", "all"],
  ["ZICHTBAAR", "visible"],
  ["VERBORGEN", "hidden"],
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseReview(value: unknown): ReviewAdminItem {
  if (
    !isObject(value) ||
    !isUuid(value.id) ||
    !isUuid(value.booking_id) ||
    !isUuid(value.trainer_id) ||
    !isUuid(value.player_id) ||
    typeof value.rating !== "number" ||
    !Number.isInteger(value.rating) ||
    value.rating < 1 ||
    value.rating > 5 ||
    !(
      value.comment === null ||
      typeof value.comment === "string"
    ) ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.is_hidden !== "boolean" ||
    typeof value.trainer_name !== "string" ||
    typeof value.trainer_sport !== "string" ||
    typeof value.player_name !== "string"
  ) {
    throw new Error("Het reviewoverzicht heeft een ongeldig formaat.");
  }

  return value as ReviewAdminItem;
}

/*
 * Clientcontrole voorkomt verwerking onder een ander account.
 * De RPC's voeren daarnaast de beslissende admincontrole uit.
 */
async function requireAdmin(
  expectedUserId?: string
): Promise<string> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (
    userError ||
    !user ||
    (
      expectedUserId !== undefined &&
      user.id !== expectedUserId
    )
  ) {
    throw new Error(
      "Je account kon niet worden bevestigd. Log zo nodig opnieuw in."
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin") {
    throw new Error(
      "Je beheerrechten konden niet worden bevestigd."
    );
  }

  return user.id;
}

async function fetchAdminReviews(
  expectedUserId?: string
): Promise<{
  userId: string;
  reviews: ReviewAdminItem[];
}> {
  const userId = await requireAdmin(expectedUserId);
  const reviews: ReviewAdminItem[] = [];
  const seenIds = new Set<string>();

  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.rpc(
      "admin_read_reviews_v1",
      { p_offset: offset }
    );

    if (
      error ||
      !Array.isArray(data) ||
      data.length > 200
    ) {
      throw new Error("Reviews konden niet worden geladen.");
    }

    for (const value of data) {
      const review = parseReview(value);

      if (seenIds.has(review.id)) {
        throw new Error(
          "Het overzicht is tijdens het ophalen veranderd. Vernieuw opnieuw."
        );
      }

      seenIds.add(review.id);
      reviews.push(review);
    }

    if (data.length < 200) break;
  }

  await requireAdmin(userId);

  return { userId, reviews };
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<ReviewAdminItem[]>([]);
  const [ratingFilter, setRatingFilter] =
    useState<RatingFilter>("all");
  const [visibilityFilter, setVisibilityFilter] =
    useState<VisibilityFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(true);
  const [hasSnapshot, setHasSnapshot] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const mounted = useRef(false);
  const sequence = useRef(0);
  const actionLock = useRef(false);
  const loadLock = useRef(false);
  const snapshotUserId = useRef<string | null>(null);

  const busy = loading || refreshing || updatingId !== null;

  const loadReviews = useCallback(async (initial = false) => {
    if (actionLock.current || loadLock.current) return;

    loadLock.current = true;
    const current = ++sequence.current;

    const isCurrent = () =>
      mounted.current && sequence.current === current;

    if (initial) setLoading(true);
    else setRefreshing(true);

    setNeedsRefresh(true);
    setErrorMessage("");
    setSuccessMessage("");

    /*
     * Tijdens de nieuwe accountcontrole geen oude
     * persoonsgegevens als actueel presenteren.
     */
    setReviews([]);
    setHasSnapshot(false);

    try {
      const result = await fetchAdminReviews();

      if (!isCurrent()) return;

      snapshotUserId.current = result.userId;
      setReviews(result.reviews);
      setHasSnapshot(true);
      setNeedsRefresh(false);
    } catch (error) {
      if (isCurrent()) {
        snapshotUserId.current = null;
        setReviews([]);
        setHasSnapshot(false);

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Het reviewoverzicht kon niet worden geladen."
        );
      }
    } finally {
      loadLock.current = false;

      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;

    /*
     * Uitgestelde start voorkomt een dubbele eerste aanvraag
     * bij de development-effectcontrole van React.
     */
    const timer = window.setTimeout(() => {
      void loadReviews(true);
    }, 0);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;

      if (
        event === "SIGNED_OUT" ||
        (
          snapshotUserId.current !== null &&
          snapshotUserId.current !== (session?.user.id ?? null)
        )
      ) {
        sequence.current += 1;
        snapshotUserId.current = null;

        setReviews([]);
        setHasSnapshot(false);
        setNeedsRefresh(true);
        setLoading(false);
        setRefreshing(false);
        setSuccessMessage("");
        setErrorMessage(
          "Je account is gewijzigd. Log in als beheerder en klik op Ververs."
        );
      }
    });

    return () => {
      mounted.current = false;
      sequence.current += 1;
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [loadReviews]);

  async function setReviewVisibility(
    review: ReviewAdminItem
  ): Promise<void> {
    if (
      actionLock.current ||
      loadLock.current ||
      busy ||
      needsRefresh ||
      !hasSnapshot ||
      !snapshotUserId.current
    ) {
      return;
    }

    const expectedUserId = snapshotUserId.current;
    const targetHidden = !review.is_hidden;
    const current = ++sequence.current;

    const isCurrent = () =>
      mounted.current && sequence.current === current;

    actionLock.current = true;
    setUpdatingId(review.id);
    setNeedsRefresh(true);
    setErrorMessage("");
    setSuccessMessage("");

    let mutationStarted = false;
    let mutationConfirmed = false;

    try {
      await requireAdmin(expectedUserId);

      if (!isCurrent()) return;

      mutationStarted = true;

      /*
       * Een concrete doelwaarde, geen server-side "toggle".
       * Een herhaalde identieke aanvraag keert de actie niet om.
       */
      const { data, error } = await supabase.rpc(
        "admin_set_review_hidden_v1",
        {
          p_review_id: review.id,
          p_is_hidden: targetHidden,
        }
      );

      if (!isCurrent()) return;

      if (
        error ||
        !isObject(data) ||
        data.review_id !== review.id ||
        data.is_hidden !== targetHidden ||
        typeof data.changed !== "boolean" ||
        typeof data.trainer_rating !== "number" ||
        !Number.isFinite(data.trainer_rating) ||
        data.trainer_rating < 0 ||
        data.trainer_rating > 5
      ) {
        throw new Error("Beheeractie niet bevestigd.");
      }

      mutationConfirmed = true;

      /*
       * Eerst opnieuw lezen voordat nieuwe acties zijn toegestaan.
       * Ook globale tellers worden daardoor vernieuwd.
       */
      const fresh = await fetchAdminReviews(expectedUserId);

      if (!isCurrent()) return;

      snapshotUserId.current = fresh.userId;
      setReviews(fresh.reviews);
      setHasSnapshot(true);
      setNeedsRefresh(false);

      const updated = fresh.reviews.find(
        (item) => item.id === review.id
      );

      if (!updated || updated.is_hidden !== targetHidden) {
        setErrorMessage(
          "De beheeractie is bevestigd, maar de actuele reviewstatus is inmiddels anders of de review ontbreekt. Het vernieuwde overzicht toont de huidige gegevens."
        );
        return;
      }

      setSuccessMessage(
        targetHidden
          ? `De review voor ${review.trainer_name} is verborgen en telt niet meer mee in de trainer-rating.`
          : `De review voor ${review.trainer_name} is weer zichtbaar en telt weer mee in de trainer-rating.`
      );
    } catch {
      if (isCurrent()) {
        /*
         * Geen optimistische wijziging of automatische mutatieretry.
         * Ververs blijft beschikbaar om de opgeslagen status te lezen.
         */
        setReviews([]);
        setHasSnapshot(false);
        setNeedsRefresh(true);

        setErrorMessage(
          mutationConfirmed
            ? "De zichtbaarheidswijziging is bevestigd, maar het overzicht kon niet worden vernieuwd. Klik op Ververs; voer de actie niet opnieuw uit."
            : mutationStarted
              ? "De uitkomst kon niet worden bevestigd. De wijziging kan al zijn verwerkt. Klik eerst op Ververs; de aanvraag wordt niet automatisch herhaald."
              : "Je account of beheerrechten konden niet opnieuw worden bevestigd. Klik op Ververs voordat je een nieuwe actie kiest."
        );
      }
    } finally {
      actionLock.current = false;

      if (mounted.current) {
        setUpdatingId(null);
      }
    }
  }

  const visibleReviews = useMemo(
    () => reviews.filter((review) => !review.is_hidden),
    [reviews]
  );

  const hiddenCount = reviews.length - visibleReviews.length;

  const avgRating = useMemo(() => {
    if (visibleReviews.length === 0) return "—";

    const total = visibleReviews.reduce(
      (sum, review) => sum + review.rating,
      0
    );

    return (total / visibleReviews.length).toFixed(1);
  }, [visibleReviews]);

  const fiveStarCount = useMemo(
    () => visibleReviews.filter((review) => review.rating === 5).length,
    [visibleReviews]
  );

  const filteredReviews = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return reviews.filter((review) => {
      if (
        visibilityFilter === "visible" &&
        review.is_hidden
      ) {
        return false;
      }

      if (
        visibilityFilter === "hidden" &&
        !review.is_hidden
      ) {
        return false;
      }

      if (ratingFilter === "5" && review.rating !== 5) return false;
      if (ratingFilter === "4" && review.rating !== 4) return false;
      if (ratingFilter === "3" && review.rating !== 3) return false;
      if (ratingFilter === "low" && review.rating > 2) return false;

      if (!query) return true;

      return [
        review.trainer_name,
        review.player_name,
        review.comment ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [reviews, visibilityFilter, ratingFilter, searchQuery]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="text-center">
          <p className="font-display text-5xl text-[#D6FF3F]">
            GOWTRAIN
          </p>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
            REVIEWS LADEN...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                ADMIN / REVIEWS
              </p>

              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                SPELER
                <br />
                REVIEWS.
              </h1>

              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Beheer de zichtbaarheid van beoordelingen. Verborgen
                reviews blijven bewaard, maar worden niet openbaar
                getoond en tellen niet mee in de trainer-rating.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="inline-flex min-h-11 items-center border-2 border-white px-4 py-2.5 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
              >
                ← ADMIN HUB
              </Link>

              <button
                type="button"
                disabled={busy}
                onClick={() => void loadReviews()}
                className="min-h-11 border-2 border-[#D6FF3F] px-4 py-2.5 font-display text-xs text-[#D6FF3F] transition hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:opacity-50"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          {errorMessage ? (
            <div
              role="alert"
              className="mt-6 border-2 border-[#FF4B3E] p-4 text-sm text-white"
            >
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div
              role="status"
              className="mt-6 border-2 border-[#D6FF3F] p-4 text-sm text-[#D6FF3F]"
            >
              {successMessage}
            </div>
          ) : null}

          {hasSnapshot ? (
            <>
              {/* ALLE TELLERS ZIJN ONAFHANKELIJK VAN DE UI-FILTERS */}
              <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="border-2 border-white bg-white p-5 text-[#14171A]">
                  <p className="font-display text-4xl">
                    {visibleReviews.length}
                  </p>
                  <p className="mt-2 font-display text-sm">
                    ZICHTBARE REVIEWS
                  </p>
                </div>

                <div className="border-2 border-white/30 p-5">
                  <p className="font-display text-4xl">
                    {hiddenCount}
                  </p>
                  <p className="mt-2 font-display text-sm text-[#B9BEC2]">
                    VERBORGEN REVIEWS
                  </p>
                </div>

                <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A]">
                  <p className="font-display text-4xl">
                    {avgRating} ★
                  </p>
                  <p className="mt-2 font-display text-sm">
                    GEMIDDELDE ZICHTBARE REVIEWS
                  </p>
                </div>

                <div className="border-2 border-[#FF4B3E] p-5">
                  <p className="font-display text-4xl">
                    {fiveStarCount}
                  </p>
                  <p className="mt-2 font-display text-sm">
                    ZICHTBARE 5-STERRENREVIEWS
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-[#B9BEC2]">
                Verberg reviews op inhoudelijke gronden, niet alleen
                omdat de beoordeling negatief is. Weer tonen herstelt
                de openbare zichtbaarheid en laat de score opnieuw
                meetellen.
              </p>

              {/* FILTERS */}
              <div className="mt-8 space-y-4 border-b-2 border-white/20 pb-6">
                <div className="flex flex-wrap gap-2">
                  {VISIBILITY_FILTERS.map(([label, value]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={visibilityFilter === value}
                      onClick={() => setVisibilityFilter(value)}
                      className={`min-h-11 border-2 px-4 py-2 font-display text-xs ${
                        visibilityFilter === value
                          ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                          : "border-white/30 text-white hover:border-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <input
                    type="search"
                    aria-label="Zoek reviews"
                    value={searchQuery}
                    onChange={(event) =>
                      setSearchQuery(event.target.value)
                    }
                    placeholder="Zoek trainer, speler of tekst..."
                    className="min-h-11 w-full border-2 border-white/25 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-[#8A8F94] focus:border-[#D6FF3F] sm:w-80"
                  />

                  <div className="flex flex-wrap gap-2">
                    {RATING_FILTERS.map(([label, value]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={ratingFilter === value}
                        onClick={() => setRatingFilter(value)}
                        className={`min-h-11 border-2 px-3 py-2 font-display text-xs ${
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
              </div>

              <p className="mt-5 text-sm text-[#B9BEC2]">
                {filteredReviews.length} van {reviews.length} reviews
                binnen deze selectie.
              </p>

              {filteredReviews.length === 0 ? (
                <div className="mt-6 border-2 border-white/20 p-8 text-center text-[#B9BEC2]">
                  Geen reviews binnen deze selectie.
                </div>
              ) : (
                <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {filteredReviews.map((review) => {
                    const updating = updatingId === review.id;

                    return (
                      <article
                        key={review.id}
                        className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                      >
                        <div className="flex h-full flex-col justify-between gap-4 bg-[#14171A] p-5 text-white">
                          <div>
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                              <span
                                className={`px-2.5 py-1 font-display text-xs ${
                                  review.is_hidden
                                    ? "border border-white/30 text-[#B9BEC2]"
                                    : "bg-[#D6FF3F] text-[#14171A]"
                                }`}
                              >
                                {review.is_hidden
                                  ? "VERBORGEN"
                                  : "ZICHTBAAR"}
                              </span>

                              <span className="font-display text-lg text-[#D6FF3F]">
                                {review.rating} ★
                              </span>
                            </div>

                            <div className="border-b border-white/15 pb-3">
                              <p className="font-display text-[10px] text-[#B9BEC2]">
                                SPELER
                              </p>
                              <h2 className="mt-1 break-words font-display text-2xl">
                                {review.player_name}
                              </h2>
                            </div>

                            <p className="mt-3 text-xs text-[#B9BEC2]">
                              Over trainer:{" "}
                              <strong className="text-[#D6FF3F]">
                                {review.trainer_name}
                              </strong>{" "}
                              ({review.trainer_sport})
                            </p>

                            <div className="mt-4 border-l-2 border-[#D6FF3F] bg-white/5 p-3.5">
                              <p className="whitespace-pre-wrap break-words text-sm italic leading-relaxed text-[#D7D9DA]">
                                {review.comment ||
                                  "Geen geschreven toelichting gegeven."}
                              </p>
                            </div>

                            {review.is_hidden ? (
                              <p className="mt-3 text-xs text-[#B9BEC2]">
                                Niet openbaar zichtbaar en niet
                                meegenomen in de trainer-rating.
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-3 border-t border-white/15 pt-3">
                            <p className="text-[10px] text-[#8A8F94]">
                              Geschreven op{" "}
                              {formatDate(review.created_at)}
                            </p>

                            <button
                              type="button"
                              disabled={busy || needsRefresh}
                              onClick={() =>
                                void setReviewVisibility(review)
                              }
                              className={`min-h-11 w-full border-2 px-3 py-2.5 font-display text-xs transition disabled:opacity-50 ${
                                review.is_hidden
                                  ? "border-[#D6FF3F] text-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]"
                                  : "border-[#FF4B3E] text-[#FF4B3E] hover:bg-[#FF4B3E] hover:text-white"
                              }`}
                            >
                              {updating
                                ? "VERWERKEN..."
                                : review.is_hidden
                                  ? "WEER TONEN"
                                  : "VERBERGEN"}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="mt-8 border border-white/20 p-6">
              <p className="text-sm text-[#B9BEC2]">
                {refreshing
                  ? "Reviewoverzicht wordt geladen..."
                  : "Er is geen bevestigd reviewoverzicht beschikbaar. Klik op Ververs of log opnieuw in als beheerder."}
              </p>

              <Link
                href="/speler-login"
                className="mt-4 inline-flex min-h-11 items-center font-display text-sm text-[#D6FF3F] underline"
              >
                NAAR LOGIN
              </Link>
            </div>
          )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}