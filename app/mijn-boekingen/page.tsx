"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PlayerPackageReservations from "@/components/PlayerPackageReservations";
import PlayerPackagePurchases from "@/components/PlayerPackagePurchases";
import BookingIssueModal from "@/components/BookingIssueModal";
import BookingChatModal from "@/components/BookingChatModal";
import { supabase } from "@/lib/supabase-browser";
import {
  getWhatsAppShareUrl,
  getGoogleCalendarUrl,
} from "@/lib/calendar-share";

type MainTab = "single" | "packages";
type BookingFilter = "all" | "upcoming" | "completed" | "cancelled";

type BookingStatus =
  | "payment_pending"
  | "confirmed"
  | "refund_pending"
  | "cancelled"
  | "refunded"
  | "completed";

type PlayerProfile = {
  full_name: string | null;
  role: string;
};

type VenueSummary = {
  name: string;
  city: string;
  address_line: string;
  postal_code: string | null;
};

type BookingSlot = {
  starts_at: string;
  ends_at: string;
  sport: "padel" | "tennis";
  venue: VenueSummary | null;
} | null;

type BookingTrainer = {
  id: string;
  name: string;
  sport: string;
  focus: string;
  image_url: string | null;
  initials: string;
} | null;

type MessageState = {
  has_messages: boolean;
  has_unread_trainer_message: boolean;
  last_sender_role: "player" | "trainer" | null;
};

type PlayerBooking = {
  id: string;
  package_purchase_id: string | null;
  status: BookingStatus;
  created_at: string;
  paid_at: string | null;
  hold_expires_at: string | null;
  cancelled_at: string | null;
  cancellation_policy: string | null;
  cancellation_rules_version: string | null;
  original_starts_at: string | null;
  player_free_cancellation_deadline: string | null;
  participant_count: number;
  total_price_cents: number;
  currency: string;
  availability_slots: BookingSlot;
  trainers: BookingTrainer;
  has_review?: boolean;
  chat_state?: MessageState;
};

type BookingSection = {
  title: string;
  bookings: PlayerBooking[];
};

type BookingMessageSummary = {
  booking_id: string;
  sender_role: string;
  created_at: string;
};

function parseTime(value?: string | null): number {
  return value ? Date.parse(value) : NaN;
}

function formatDate(value?: string | null): string {
  const time = parseTime(value);
  if (!Number.isFinite(time)) return "GEEN DATUM";

  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  })
    .format(new Date(time))
    .toUpperCase();
}

function formatTime(value?: string | null): string {
  const time = parseTime(value);
  if (!Number.isFinite(time)) return "--:--";

  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(time));
}

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function getMonthKey(value?: string): string | null {
  const time = parseTime(value);
  if (!Number.isFinite(time)) return null;

  const parts = new Intl.DateTimeFormat("nl-NL", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).formatToParts(new Date(time));

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  return year && month ? `${year}-${month}` : null;
}

function getVenueLabel(venue: VenueSummary | null): string {
  return venue
    ? `${venue.city.toUpperCase()} — ${venue.name}`
    : "LOCATIE VOLGT";
}

function getTrainerInitials(booking: PlayerBooking): string {
  const trainer = booking.trainers;
  if (!trainer) return "GT";
  if (trainer.initials?.trim()) return trainer.initials.trim().toUpperCase();

  const parts = trainer.name.trim().split(" ").filter(Boolean);
  if (!parts.length) return "GT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function canResumePayment(booking: PlayerBooking, now: number): boolean {
  return (
    booking.package_purchase_id === null &&
    booking.status === "payment_pending" &&
    !booking.paid_at &&
    parseTime(booking.hold_expires_at) > now
  );
}

function hideExpiredReservation(
  booking: PlayerBooking,
  now: number
): boolean {
  const deadline = parseTime(booking.hold_expires_at);

  return (
    booking.status === "payment_pending" &&
    !booking.paid_at &&
    Number.isFinite(deadline) &&
    deadline <= now
  );
}

function getStatusLabel(booking: PlayerBooking, now: number): string {
  switch (booking.status) {
    case "payment_pending":
      return canResumePayment(booking, now)
        ? "BETALING OPEN"
        : "STATUS NOG TE CONTROLEREN";
    case "confirmed":
      return "BEVESTIGD";
    case "refund_pending":
      return "TERUGBETALING BEZIG";
    case "cancelled":
      return "GEANNULEERD";
    case "refunded":
      return "TERUGBETAALD";
    case "completed":
      return "AFGEROND";
  }
}

function getStatusClass(status: BookingStatus): string {
  if (status === "confirmed" || status === "completed") {
    return "bg-[#D6FF3F] text-[#14171A]";
  }
  if (status === "cancelled" || status === "refunded") {
    return "bg-[#FF4B3E] text-white";
  }
  return "bg-white text-[#14171A]";
}

function getStatusExplanation(
  booking: PlayerBooking,
  now: number
): string {
  switch (booking.status) {
    case "payment_pending":
      return canResumePayment(booking, now)
        ? "Je reservering staat open. Rond je betaling af om te bevestigen."
        : "Deze betaling kan niet meer via deze pagina worden hervat. Heb je betaald? Betaal dan niet opnieuw.";
    case "confirmed":
      return booking.package_purchase_id
        ? "Deze les hoort bij je betaalde pakket en staat bevestigd."
        : "Je betaling is geslaagd. Deze training staat bevestigd.";
    case "refund_pending":
      return "Je annulering is geregistreerd. De terugbetaling is nog in behandeling.";
    case "cancelled":
      return booking.cancellation_policy === "player_late_no_refund"
        ? "Binnen 24 uur voor de start geannuleerd. Er volgt geen automatische terugbetaling."
        : "Deze boeking is geannuleerd.";
    case "refunded":
      return "Deze training is geannuleerd en de terugbetaling is verwerkt.";
    case "completed":
      return "Deze training is afgerond.";
  }
}

function canPlayerCancel(
  booking: PlayerBooking,
  now = Date.now()
): boolean {
  return (
    booking.package_purchase_id === null &&
    booking.status === "confirmed" &&
    Boolean(booking.paid_at) &&
    parseTime(booking.availability_slots?.starts_at) > now
  );
}

/*
 * De UI mag geen restitutie beloven op basis van een
 * achteraf gewijzigde starttijd of ontbrekende voorwaarden.
 */
function cancellationEligibility(
  booking: PlayerBooking,
  now: number
): "timely" | "late" | "review" {
  const original = parseTime(booking.original_starts_at);
  const current = parseTime(booking.availability_slots?.starts_at);
  const deadline = parseTime(booking.player_free_cancellation_deadline);

  if (
    booking.cancellation_rules_version !== "single_24h_v1" ||
    !Number.isFinite(original) ||
    !Number.isFinite(deadline) ||
    original !== current ||
    deadline !== original - 24 * 60 * 60 * 1000
  ) {
    return "review";
  }

  return now <= deadline ? "timely" : "late";
}

function getSectionOrder(status: BookingStatus): number {
  if (status === "payment_pending") return 0;
  if (status === "confirmed") return 1;
  if (status === "completed") return 2;
  return 3;
}

function bookingStart(booking: PlayerBooking): number {
  const value = parseTime(
    booking.availability_slots?.starts_at ?? booking.created_at
  );
  return Number.isFinite(value) ? value : 0;
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
      <div className="text-center">
        <p className="font-display text-5xl text-[#D6FF3F]">GOWTRAIN</p>
        <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
          BOEKINGEN LADEN...
        </p>
      </div>
    </main>
  );
}

function MijnBoekingenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cancellationRef = useRef<HTMLElement | null>(null);
  const cancelBusyRef = useRef(false);
  const reviewBusyRef = useRef(false);
  const loadSequenceRef = useRef(0);

  const returnedFromPackage = searchParams.get("success") === "package";
  const requestedTab = searchParams.get("tab");

  const [activeTab, setActiveTab] = useState<MainTab>(() =>
    requestedTab === "packages" || returnedFromPackage
      ? "packages"
      : "single"
  );

  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [bookings, setBookings] = useState<PlayerBooking[]>([]);
  const [statusFilter, setStatusFilter] = useState<BookingFilter>("all");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(6);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);
  const [chatBooking, setChatBooking] = useState<PlayerBooking | null>(null);

  const [reviewBookingId, setReviewBookingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const [pendingCancellation, setPendingCancellation] = useState<PlayerBooking | null>(null);
  const [pendingIssueBooking, setPendingIssueBooking] = useState<PlayerBooking | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void loadPlayerBookings();
    return () => {
      loadSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (requestedTab === "packages" || returnedFromPackage) {
      setActiveTab("packages");
    } else if (requestedTab === "single") {
      setActiveTab("single");
    }
  }, [requestedTab, returnedFromPackage]);

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const timer = window.setInterval(updateClock, 10_000);
    window.addEventListener("focus", updateClock);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateClock);
    };
  }, []);

  const singleBookings = useMemo(
    () => bookings.filter((booking) => booking.package_purchase_id === null),
    [bookings]
  );

  const packageLessons = useMemo(() => {
    const groups = new Map<string, PlayerBooking[]>();

    for (const booking of bookings) {
      if (!booking.package_purchase_id) continue;
      const list = groups.get(booking.package_purchase_id) ?? [];
      list.push(booking);
      groups.set(booking.package_purchase_id, list);
    }

    for (const list of groups.values()) {
      list.sort((a, b) => bookingStart(a) - bookingStart(b));
    }

    return groups;
  }, [bookings]);

  const unreadBookings = useMemo(
    () =>
      bookings.filter(
        (booking) =>
          booking.chat_state?.has_unread_trainer_message &&
          booking.status === "confirmed" &&
          parseTime(booking.availability_slots?.ends_at) > now
      ),
    [bookings, now]
  );

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const booking of singleBookings) {
      if (hideExpiredReservation(booking, now)) continue;
      const key = getMonthKey(booking.availability_slots?.starts_at);
      if (key) months.add(key);
    }
    return Array.from(months).sort().reverse();
  }, [singleBookings, now]);

  const filteredBookings = useMemo(
    () =>
      singleBookings.filter((booking) => {
        if (hideExpiredReservation(booking, now)) return false;

        if (
          statusFilter === "upcoming" &&
          booking.status !== "confirmed" &&
          booking.status !== "payment_pending"
        ) return false;

        if (statusFilter === "completed" && booking.status !== "completed") {
          return false;
        }

        if (
          statusFilter === "cancelled" &&
          !["cancelled", "refunded", "refund_pending"].includes(booking.status)
        ) return false;

        return (
          selectedMonth === "all" ||
          getMonthKey(booking.availability_slots?.starts_at) === selectedMonth
        );
      }),
    [singleBookings, statusFilter, selectedMonth, now]
  );

  const { bookingSections, totalFilteredCount } = useMemo(() => {
    const sorted = [...filteredBookings].sort((a, b) => {
      const group = getSectionOrder(a.status) - getSectionOrder(b.status);
      if (group) return group;

      return ["confirmed", "payment_pending"].includes(a.status)
        ? bookingStart(a) - bookingStart(b)
        : bookingStart(b) - bookingStart(a);
    });

    const shown = sorted.slice(0, visibleLimit);

    const definitions: Array<[string, BookingStatus[]]> = [
      ["RESERVERINGEN & BETAALSTATUS", ["payment_pending"]],
      ["AANKOMENDE TRAININGEN", ["confirmed"]],
      ["AFGERONDE TRAININGEN", ["completed"]],
      ["GEANNULEERDE BOEKINGEN", ["cancelled", "refunded", "refund_pending"]],
    ];

    const sections: BookingSection[] = definitions
      .map(([title, statuses]) => ({
        title,
        bookings: shown.filter((booking) => statuses.includes(booking.status)),
      }))
      .filter((section) => section.bookings.length > 0);

    return {
      bookingSections: sections,
      totalFilteredCount: filteredBookings.length,
    };
  }, [filteredBookings, visibleLimit]);

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string) {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  function changeTab(tab: MainTab) {
    if (cancellingBookingId || submittingReview) return;
    setActiveTab(tab);
    setPendingCancellation(null);
    setReviewBookingId(null);
    clearMessages();
  }

  async function loadPlayerBookings(showLoading = true): Promise<void> {
    const sequence = ++loadSequenceRef.current;
    const isCurrent = () => sequence === loadSequenceRef.current;

    if (showLoading) setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!isCurrent()) return;

      if (userError || !user) {
        router.replace("/speler-login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (!isCurrent()) return;
      if (profileError) throw new Error("Je spelerprofiel kon niet worden geladen.");

      if (!profile || profile.role !== "player") {
        router.replace("/speler-login");
        return;
      }

      setPlayerProfile(profile as PlayerProfile);
      setCurrentUserId(user.id);

      const { data, error } = await supabase
        .from("bookings")
        .select(`
          id,
          package_purchase_id,
          status,
          created_at,
          paid_at,
          hold_expires_at,
          cancelled_at,
          cancellation_policy,
          cancellation_rules_version,
          original_starts_at,
          player_free_cancellation_deadline,
          participant_count,
          total_price_cents,
          currency,
          availability_slots (
            starts_at,
            ends_at,
            sport,
            venue:venues!availability_slots_location_id_fkey (
              name, city, address_line, postal_code
            )
          ),
          trainers (id, name, sport, focus, image_url, initials)
        `)
        .eq("player_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw new Error("Je boekingen konden niet worden geladen.");
      if (!isCurrent()) return;

      const loaded = (data ?? []) as unknown as PlayerBooking[];
      const ids = loaded.map((booking) => booking.id);

      const { data: reviews, error: reviewsError } = await supabase
        .from("trainer_reviews")
        .select("booking_id")
        .eq("player_id", user.id);

      if (reviewsError) {
        console.warn("Reviews ophalen mislukt:", reviewsError.message);
      }

      const reviewedIds = new Set(
        (reviews ?? []).map((review) => review.booking_id)
      );

      let messages: BookingMessageSummary[] = [];

      if (ids.length) {
        const { data: messageData, error: messageError } = await supabase
          .from("booking_messages")
          .select("booking_id, sender_role, created_at")
          .in("booking_id", ids)
          .order("created_at", { ascending: true });

        if (messageError) {
          console.warn("Berichtenstatus ophalen mislukt:", messageError.message);
        }
        messages = (messageData ?? []) as BookingMessageSummary[];
      }

      if (!isCurrent()) return;

      const byBooking = new Map<string, BookingMessageSummary[]>();
      for (const message of messages) {
        const list = byBooking.get(message.booking_id) ?? [];
        list.push(message);
        byBooking.set(message.booking_id, list);
      }

      const withState: PlayerBooking[] = loaded.map((booking) => {
        const list = byBooking.get(booking.id) ?? [];
        const last = list[list.length - 1];
        let readAt = 0;

        try {
          const stored = localStorage.getItem(
            `gowtrain_read_player_${booking.id}`
          );
          const parsed = parseTime(stored);
          if (Number.isFinite(parsed)) readAt = parsed;
        } catch {
          readAt = 0;
        }

        return {
          ...booking,
          has_review: reviewedIds.has(booking.id),
          chat_state: {
            has_messages: list.length > 0,
            has_unread_trainer_message: list.some(
              (message) =>
                message.sender_role === "trainer" &&
                Date.parse(message.created_at) > readAt
            ),
            last_sender_role:
              last?.sender_role === "player" || last?.sender_role === "trainer"
                ? last.sender_role
                : null,
          },
        };
      });

      setBookings(withState);
      setNow(Date.now());
    } catch (error: unknown) {
      if (isCurrent()) {
        showError(
          error instanceof Error
            ? error.message
            : "Je boekingen konden niet worden geladen."
        );
      }
    } finally {
      if (isCurrent() && showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    if (refreshing) return;
    setRefreshing(true);
    clearMessages();
    try {
      await loadPlayerBookings(false);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCheckout(bookingId: string): Promise<void> {
    if (payingBookingId) return;
    clearMessages();

    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking || !canResumePayment(booking, Date.now())) {
      setNow(Date.now());
      showError(
        "Deze betaling kan niet meer worden hervat. Heb je betaald? Betaal dan niet opnieuw."
      );
      return;
    }

    setPayingBookingId(bookingId);
    window.location.href =
      `/boeken/checkout?bookingId=${encodeURIComponent(bookingId)}`;
  }

  function openCancellationConfirmation(booking: PlayerBooking) {
    if (cancellingBookingId) return;

    clearMessages();
    setPendingIssueBooking(null);
    setPendingCancellation(booking);

    window.setTimeout(() => {
      cancellationRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      cancellationRef.current?.focus();
    }, 50);
  }

  async function handleCancellation(booking: PlayerBooking): Promise<void> {
    if (cancelBusyRef.current) return;

    if (
      !canPlayerCancel(booking) ||
      cancellationEligibility(booking, Date.now()) === "review"
    ) {
      showError("Deze annulering moet door Gowtrain worden beoordeeld.");
      return;
    }

    cancelBusyRef.current = true;
    setCancellingBookingId(booking.id);
    clearMessages();

    try {
      const { data, error } = await supabase.rpc(
        "request_player_single_cancellation",
        { p_booking_id: booking.id }
      );

      if (error) {
        showError(
          error.code === "P0001" || error.code === "42501"
            ? error.message
            : "De annulering kon niet worden bevestigd. Vernieuw je boekingen."
        );
        return;
      }

      const result = data as {
        booking_id: string;
        message: string;
      } | null;

      if (!result || result.booking_id !== booking.id) {
        showError("Controleer je boekingen; het resultaat kon niet worden bevestigd.");
        return;
      }

      setPendingCancellation(null);
      await loadPlayerBookings(false);
      setSuccessMessage(result.message);
    } catch {
      showError(
        "De verbinding is onderbroken. De annulering kan al geregistreerd zijn. Controleer eerst je boekingen."
      );
    } finally {
      cancelBusyRef.current = false;
      setCancellingBookingId(null);
    }
  }

  async function submitReview(booking: PlayerBooking): Promise<void> {
    if (!booking.trainers?.id || reviewBusyRef.current) return;

    reviewBusyRef.current = true;
    setSubmittingReview(true);
    clearMessages();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/speler-login");
        return;
      }

      const { error } = await supabase.from("trainer_reviews").insert({
        booking_id: booking.id,
        trainer_id: booking.trainers.id,
        player_id: user.id,
        rating: reviewRating,
        comment: reviewComment.trim() || null,
      });

      if (error) {
        showError("Je review kon niet worden opgeslagen.");
        return;
      }

      setReviewBookingId(null);
      setReviewComment("");
      setReviewRating(5);
      await loadPlayerBookings(false);
      setSuccessMessage("Bedankt! Je beoordeling is geplaatst.");
    } catch {
      showError("Je review kon niet worden opgeslagen.");
    } finally {
      reviewBusyRef.current = false;
      setSubmittingReview(false);
    }
  }

  function openIssueReport(booking: PlayerBooking) {
    clearMessages();
    setPendingCancellation(null);
    setPendingIssueBooking(booking);
  }

  /*
   * Dezelfde leskaart wordt voor losse lessen én binnen
   * uitklapbare pakketten gebruikt.
   */
  function renderBookingCard(booking: PlayerBooking) {
    const trainer = booking.trainers;
    const slot = booking.availability_slots;
    const isPackageLesson = booking.package_purchase_id !== null;
    const isCompleted = booking.status === "completed";
    const startsAt = parseTime(slot?.starts_at);
    const endsAt = parseTime(slot?.ends_at);
    const canPay = canResumePayment(booking, now);

    const showTrainingActions =
      booking.status === "confirmed" &&
      slot !== null &&
      Number.isFinite(endsAt) &&
      endsAt > now;

    const canReportIssue =
      ["confirmed", "completed"].includes(booking.status) &&
      Boolean(booking.paid_at) &&
      Number.isFinite(startsAt) &&
      now >= startsAt &&
      now < startsAt + 24 * 60 * 60 * 1000;

    return (
      <article
        key={booking.id}
        className="min-w-0 border-2 border-white bg-white p-3 text-[#14171A] shadow-[5px_5px_0_0_#FF4B3E]"
      >
        <div className="bg-[#14171A] p-4 text-white sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F]">
                {trainer?.image_url ? (
                  <img
                    src={trainer.image_url}
                    alt={trainer.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-display text-lg text-[#D6FF3F]">
                    {getTrainerInitials(booking)}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="break-words font-display text-2xl leading-none">
                  {trainer?.name || "TRAINER"}
                </p>
                <p className="mt-1 text-xs text-[#B9BEC2]">
                  {trainer?.sport} · {trainer?.focus}
                </p>
              </div>
            </div>

            <span className={`px-3 py-1.5 font-display text-xs ${getStatusClass(booking.status)}`}>
              {getStatusLabel(booking, now)}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-y border-white/20 py-4">
            <div>
              <p className="font-display text-lg text-[#D6FF3F]">
                {formatDate(slot?.starts_at)}
              </p>
              <p className="mt-1 font-display text-3xl">
                {formatTime(slot?.starts_at)} – {formatTime(slot?.ends_at)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-3xl text-[#D6FF3F]">
                {formatEuro(booking.total_price_cents, booking.currency)}
              </p>
              <p className="text-[10px] text-[#8A8F94]">
                {isPackageLesson ? "AANDEEL VAN HET PAKKET" : "INCL. BAANHUUR"}
              </p>
            </div>
          </div>

          {slot?.venue && (
            <p className="mt-3 text-xs text-[#B9BEC2]">
              <strong>Locatie:</strong> {getVenueLabel(slot.venue)}
            </p>
          )}

          <p className="mt-4 border-l-2 border-[#D6FF3F] pl-3 text-xs leading-relaxed text-[#D7D9DA]">
            {getStatusExplanation(booking, now)}
          </p>

          {showTrainingActions && slot && (
            <div className="mt-5 space-y-2 border-t border-white/10 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      getGoogleCalendarUrl(
                        `Gowtrain ${slot.sport.toUpperCase()} les bij ${trainer?.name || "trainer"}`,
                        slot.starts_at,
                        slot.ends_at,
                        getVenueLabel(slot.venue),
                        `Gowtrain les bij ${trainer?.name || "trainer"}.`
                      ),
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                  className="border border-white/30 px-2 py-3 font-display text-[11px] text-[#B9BEC2] hover:border-white hover:text-white"
                >
                  IN AGENDA ZETTEN
                </button>
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      getWhatsAppShareUrl(
                        trainer?.name || "trainer",
                        slot.sport,
                        formatDate(slot.starts_at),
                        formatTime(slot.starts_at),
                        getVenueLabel(slot.venue)
                      ),
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                  className="border border-white/30 px-2 py-3 font-display text-[11px] text-[#B9BEC2] hover:border-white hover:text-white"
                >
                  DELEN VIA WHATSAPP
                </button>
              </div>
              <button
                type="button"
                onClick={() => setChatBooking(booking)}
                className={`w-full px-4 py-3 font-display text-sm ${
                  booking.chat_state?.has_unread_trainer_message
                    ? "bg-[#FF4B3E] text-white"
                    : "bg-[#D6FF3F] !text-[#14171A] hover:bg-white"
                }`}
              >
                {booking.chat_state?.has_unread_trainer_message
                  ? "NIEUW BERICHT VAN TRAINER!"
                  : booking.chat_state?.has_messages
                    ? "CHAT OPENEN"
                    : "CHAT MET TRAINER"}
              </button>
            </div>
          )}

          {isCompleted && !booking.has_review && (
            <div className="mt-5 border-2 border-[#D6FF3F] p-4">
              <p className="font-display text-base text-[#D6FF3F]">
                BEOORDEEL DEZE LES
              </p>
              {reviewBookingId === booking.id ? (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        disabled={submittingReview}
                        aria-label={`${star} sterren`}
                        aria-pressed={reviewRating === star}
                        onClick={() => setReviewRating(star)}
                        className={`h-10 w-10 border-2 font-display ${
                          reviewRating >= star
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                            : "border-white/30"
                        }`}
                      >
                        {star}★
                      </button>
                    ))}
                  </div>
                  <textarea
                    aria-label="Toelichting op je review"
                    value={reviewComment}
                    disabled={submittingReview}
                    onChange={(event) => setReviewComment(event.target.value)}
                    rows={3}
                    placeholder="Vertel kort wat je van de les vond..."
                    className="w-full border-2 border-white/25 bg-transparent p-3 text-sm outline-none focus:border-[#D6FF3F]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={submittingReview}
                      onClick={() => void submitReview(booking)}
                      className="flex-1 bg-[#FF4B3E] px-3 py-3 font-display text-sm disabled:opacity-60"
                    >
                      {submittingReview ? "PLAATSEN..." : "PLAATS REVIEW"}
                    </button>
                    <button
                      type="button"
                      disabled={submittingReview}
                      onClick={() => setReviewBookingId(null)}
                      className="border border-white/30 px-3 py-3 font-display text-xs"
                    >
                      ANNULEREN
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setReviewBookingId(booking.id);
                    setReviewRating(5);
                    setReviewComment("");
                  }}
                  className="mt-3 w-full bg-[#D6FF3F] px-3 py-3 font-display text-sm text-[#14171A]"
                >
                  SCHRIJF EEN REVIEW →
                </button>
              )}
            </div>
          )}

          {isCompleted && booking.has_review && (
            <p className="mt-4 font-display text-xs text-[#D6FF3F]">
              ✓ JE HEBT DEZE LES AL BEOORDEELD
            </p>
          )}

          {canReportIssue && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => openIssueReport(booking)}
                className="text-left text-xs font-semibold text-[#B9BEC2] hover:text-[#FF4B3E]"
              >
                Iets mis met deze training? Meld het hier →
              </button>
              <p className="mt-1 text-[11px] text-[#8A8F94]">
                Melden kan vanaf de start tot 24 uur daarna.
              </p>
            </div>
          )}

          {canPay && (
            <button
              type="button"
              disabled={payingBookingId !== null}
              onClick={() => void handleCheckout(booking.id)}
              className="mt-6 w-full bg-[#D6FF3F] px-4 py-3.5 font-display text-lg !text-[#14171A] disabled:opacity-60"
            >
              {payingBookingId === booking.id
                ? "BETAALSCHERM OPENEN..."
                : "ROND BETALING AF. GOW! →"}
            </button>
          )}

          {canPlayerCancel(booking, now) && (
            <button
              type="button"
              disabled={cancellingBookingId !== null}
              onClick={() => openCancellationConfirmation(booking)}
              className="mt-3 w-full bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white hover:bg-white hover:text-[#14171A] disabled:opacity-60"
            >
              LES ANNULEREN
            </button>
          )}
        </div>
      </article>
    );
  }

  function renderPackageLessons(purchaseId: string) {
    const lessons = packageLessons.get(purchaseId) ?? [];

    if (!lessons.length) {
      return (
        <p className="text-sm text-[#B9BEC2]">
          De lessen zijn niet geladen. Klik op Ververs.
        </p>
      );
    }

    const unreadCount = lessons.filter(
      (lesson) =>
        lesson.chat_state?.has_unread_trainer_message &&
        lesson.status === "confirmed" &&
        parseTime(lesson.availability_slots?.ends_at) > now
    ).length;

    return (
      <details className="border-t border-white/20 pt-4">
        <summary className="cursor-pointer font-display text-base text-[#D6FF3F]">
          BEKIJK LESSEN ({lessons.length})
          {unreadCount > 0 && (
            <span className="ml-2 text-[#FF4B3E]">
              · {unreadCount} MET NIEUWE BERICHTEN
            </span>
          )}
        </summary>

        <div className="mt-5 space-y-5">
          {lessons.map(renderBookingCard)}
        </div>
      </details>
    );
  }

  if (loading) return <LoadingScreen />;

  const firstName =
    playerProfile?.full_name?.trim().split(" ")[0]?.toUpperCase() ||
    "SPELER";

  const cancellationState = pendingCancellation
    ? cancellationEligibility(pendingCancellation, now)
    : "review";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          {/* PAGINAKOP */}
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                SPELER PORTAL
              </p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                HÉ, {firstName}.<br />
                JOUW BOEKINGEN.
              </h1>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing || cancellingBookingId !== null}
                className="border-2 border-white px-4 py-3 font-display text-sm hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>
              <Link
                href="/trainers"
                className="bg-[#FF4B3E] px-5 py-3 font-display text-sm text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                BOEK TRAINING →
              </Link>
            </div>
          </div>

          {/* HOOFDNAVIGATIE */}
          <div
            role="group"
            aria-label="Type boekingen"
            className="mt-8 flex flex-wrap gap-4 border-b-2 border-white/20 pb-7"
          >
            {([
              ["single", "LOSSE LESSEN"],
              ["packages", "LESPAKKETTEN"],
            ] as [MainTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                aria-pressed={activeTab === tab}
                aria-controls={`bookings-panel-${tab}`}
                disabled={cancellingBookingId !== null || submittingReview}
                onClick={() => changeTab(tab)}
                className={`border-2 px-6 py-4 font-display text-xl transition sm:px-8 ${
                  activeTab === tab
                    ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                    : "border-white text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                } disabled:opacity-60`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ALGEMENE MELDINGEN */}
          {unreadBookings.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5">
              <div>
                <p className="font-display text-xl">
                  {unreadBookings.length} TRAINING
                  {unreadBookings.length === 1 ? "" : "EN"} MET NIEUWE BERICHTEN
                </p>
                <p className="mt-1 text-sm">
                  Van {unreadBookings[0].trainers?.name || "je trainer"} voor{" "}
                  {formatDate(unreadBookings[0].availability_slots?.starts_at)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const booking = unreadBookings[0];
                  setActiveTab(booking.package_purchase_id ? "packages" : "single");
                  setChatBooking(booking);
                }}
                className="bg-[#14171A] px-5 py-3 font-display text-base !text-[#D6FF3F]"
              >
                OPEN BERICHT →
              </button>
            </div>
          )}

          {returnedFromPackage && activeTab === "packages" && (
            <p role="status" className="mt-6 border border-[#D6FF3F] p-4 text-sm text-[#D7D9DA]">
              Terug van de pakketbetaalflow? Zodra je betaling is bevestigd
              en verwerkt, verschijnt je aankoop hier. Klik zo nodig op Ververs.
            </p>
          )}

          {errorMessage && (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-4 font-semibold">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div role="status" className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] p-4 font-semibold text-[#14171A]">
              {successMessage}
            </div>
          )}

          {/* ANNULEREN LOSSE LES */}
          {pendingCancellation && (
            <section
              ref={cancellationRef}
              tabIndex={-1}
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 outline-none sm:p-6"
            >
              <h2 className="font-display text-3xl">TRAINING ANNULEREN?</h2>
              <p className="mt-3">
                {formatDate(pendingCancellation.availability_slots?.starts_at)}
                {" om "}
                {formatTime(pendingCancellation.availability_slots?.starts_at)}
                {" bij "}
                {pendingCancellation.trainers?.name || "je trainer"}.
              </p>

              <div className="mt-5 border-l-2 border-white pl-4">
                {cancellationState === "timely" ? (
                  <>
                    <p className="font-display text-lg">VOLLEDIGE TERUGBETALING</p>
                    <p className="mt-2 text-sm">
                      Je annuleert binnen de vastgelegde kosteloze termijn.
                      Er wordt een terugbetaling van{" "}
                      {formatEuro(
                        pendingCancellation.total_price_cents,
                        pendingCancellation.currency
                      )}{" "}
                      klaargezet. De database controleert de termijn opnieuw
                      bij bevestigen.
                    </p>
                  </>
                ) : cancellationState === "late" ? (
                  <>
                    <p className="font-display text-lg">GEEN AUTOMATISCHE TERUGBETALING</p>
                    <p className="mt-2 text-sm">
                      De kosteloze annuleringsdeadline is verstreken.
                      Je kunt de les annuleren, maar ontvangt geen automatische refund.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-lg">CONTROLE DOOR GOWTRAIN NODIG</p>
                    <p className="mt-2 text-sm">
                      De oorspronkelijke voorwaarden ontbreken of de training
                      is verplaatst. Neem contact op met Gowtrain.
                    </p>
                  </>
                )}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={cancellingBookingId !== null}
                  onClick={() => setPendingCancellation(null)}
                  className="border-2 border-white px-5 py-3 font-display"
                >
                  TERUG
                </button>
                {cancellationState !== "review" && (
                  <button
                    type="button"
                    disabled={
                      cancellingBookingId !== null ||
                      !canPlayerCancel(pendingCancellation, now)
                    }
                    onClick={() => void handleCancellation(pendingCancellation)}
                    className="bg-[#14171A] px-5 py-3 font-display disabled:opacity-60"
                  >
                    {cancellingBookingId
                      ? "ANNULERING VERWERKEN..."
                      : "JA, ANNULEER TRAINING"}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* MODALS */}
          {pendingIssueBooking && (
            <BookingIssueModal
              bookingId={pendingIssueBooking.id}
              trainerName={pendingIssueBooking.trainers?.name || "je trainer"}
              trainingLabel={`${formatDate(
                pendingIssueBooking.availability_slots?.starts_at
              )} · ${formatTime(
                pendingIssueBooking.availability_slots?.starts_at
              )}`}
              onClose={() => setPendingIssueBooking(null)}
              onSubmitted={() => {
                setPendingIssueBooking(null);
                setSuccessMessage("Je melding is verstuurd naar Gowtrain.");
              }}
            />
          )}

          {chatBooking && (
            <BookingChatModal
              bookingId={chatBooking.id}
              recipientName={chatBooking.trainers?.name || "je trainer"}
              trainingLabel={`${chatBooking.availability_slots?.sport?.toUpperCase() || "LES"} · ${formatDate(
                chatBooking.availability_slots?.starts_at
              )} (${formatTime(chatBooking.availability_slots?.starts_at)} - ${formatTime(
                chatBooking.availability_slots?.ends_at
              )})`}
              venueLabel={getVenueLabel(chatBooking.availability_slots?.venue ?? null)}
              currentUserRole="player"
              currentUserId={currentUserId}
              currentUserName={playerProfile?.full_name || "Speler"}
              onClose={() => setChatBooking(null)}
              onMessagesRead={() => void loadPlayerBookings(false)}
            />
          )}

          {/* TAB: LOSSE LESSEN */}
          {activeTab === "single" && (
            <section id="bookings-panel-single" aria-label="Losse lessen">
              <div className="mt-8 flex flex-col justify-between gap-4 border-b-2 border-white/20 pb-6 sm:flex-row sm:items-center">
                <div className="flex flex-wrap gap-2">
                  {([
                    ["ALLES", "all"],
                    ["AANKOMEND", "upcoming"],
                    ["AFGEROND", "completed"],
                    ["GEANNULEERD", "cancelled"],
                  ] as [string, BookingFilter][]).map(([label, value]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={statusFilter === value}
                      onClick={() => {
                        setStatusFilter(value);
                        setVisibleLimit(6);
                      }}
                      className={`border-2 px-4 py-2 font-display text-xs ${
                        statusFilter === value
                          ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                          : "border-white/30 hover:border-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {monthOptions.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="booking-month" className="font-display text-xs text-[#D6FF3F]">
                      PER MAAND:
                    </label>
                    <select
                      id="booking-month"
                      value={selectedMonth}
                      onChange={(event) => {
                        setSelectedMonth(event.target.value);
                        setVisibleLimit(6);
                      }}
                      className="border-2 border-white/30 bg-[#14171A] px-3 py-2 font-display text-xs text-white"
                    >
                      <option value="all">ALLE MAANDEN</option>
                      {monthOptions.map((key) => {
                        const [year, month] = key.split("-").map(Number);
                        const label = new Intl.DateTimeFormat("nl-NL", {
                          month: "long",
                          year: "numeric",
                          timeZone: "Europe/Amsterdam",
                        }).format(new Date(Date.UTC(year, month - 1, 1, 12)));

                        return (
                          <option key={key} value={key}>
                            {label.toUpperCase()}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>

              {bookingSections.length === 0 ? (
                <div className="mt-8 border-2 border-white/20 p-8 text-center">
                  <p className="font-display text-2xl text-[#D6FF3F]">
                    GEEN LOSSE LESSEN BINNEN DIT FILTER.
                  </p>
                  <p className="mt-2 text-sm text-[#B9BEC2]">
                    Kies een ander filter of bekijk je lespakketten.
                  </p>
                </div>
              ) : (
                <div className="mt-8 space-y-10">
                  {bookingSections.map((section) => (
                    <section key={section.title}>
                      <h2 className="font-display text-lg text-[#FF4B3E]">
                        {section.title}
                      </h2>
                      <div className="mt-4 grid gap-6 lg:grid-cols-2">
                        {section.bookings.map(renderBookingCard)}
                      </div>
                    </section>
                  ))}

                  {visibleLimit < totalFilteredCount && (
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => setVisibleLimit((value) => value + 6)}
                        className="bg-[#D6FF3F] px-8 py-4 font-display text-xl text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                      >
                        MEER LESSEN LADEN (+6) →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* TAB: LESPAKKETTEN */}
          {activeTab === "packages" && (
            <section id="bookings-panel-packages" aria-label="Lespakketten">
              <PlayerPackageReservations refreshing={refreshing} />

              <PlayerPackagePurchases
                refreshing={refreshing}
                onChanged={() => loadPlayerBookings(false)}
                renderLessons={renderPackageLessons}
              />

              <p className="mt-8 text-sm leading-relaxed text-[#8A8F94]">
                Geen pakket zichtbaar? Een betaalde aankoop verschijnt hier
                zodra de betaling en lesboekingen zijn verwerkt. Heb je al
                betaald? Betaal niet opnieuw en klik over even op Ververs.
              </p>
            </section>
          )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

export default function MijnBoekingenPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MijnBoekingenContent />
    </Suspense>
  );
}