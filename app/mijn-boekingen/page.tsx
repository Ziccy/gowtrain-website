"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import BookingIssueModal from "@/components/BookingIssueModal";
import BookingChatModal from "@/components/BookingChatModal";
import { supabase } from "@/lib/supabase-browser";
import {
  getWhatsAppShareUrl,
  getGoogleCalendarUrl,
} from "@/lib/calendar-share";

type PlayerProfile = {
  id?: string;
  full_name: string | null;
  role: string;
};

type BookingStatus =
  | "payment_pending"
  | "confirmed"
  | "refund_pending"
  | "cancelled"
  | "refunded"
  | "completed";

type BookingFilter = "all" | "upcoming" | "completed" | "cancelled";

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
  status: BookingStatus;
  created_at: string;
  paid_at: string | null;
  hold_expires_at: string | null;
  cancelled_at: string | null;
  cancellation_policy: string | null;
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

type CancellationResult = {
  booking_id: string;
  refund_required: boolean;
  refund_amount_cents: number;
  currency: string;
  cancellation_policy: string;
  message: string;
};

function formatDate(value?: string): string {
  if (!value) return "GEEN DATUM";
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date(value))
    .toUpperCase();
}

function formatTime(value?: string): string {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function getStatusLabel(status: BookingStatus): string {
  switch (status) {
    case "payment_pending":
      return "BETALING OPEN";
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
  if (status === "payment_pending" || status === "refund_pending") {
    return "bg-white text-[#14171A]";
  }
  if (status === "cancelled" || status === "refunded") {
    return "bg-[#FF4B3E] text-white";
  }
  return "bg-[#303438] text-white";
}

function getStatusExplanation(booking: PlayerBooking): string {
  switch (booking.status) {
    case "payment_pending":
      return "Je tijdelijke reservering staat open. Rond je betaling af om te bevestigen.";
    case "confirmed":
      return "Je betaling is geslaagd. Je staat op de lijst voor deze training!";
    case "refund_pending":
      return "Je annulering is verwerkt. De terugbetaling is onderweg naar je rekening.";
    case "cancelled":
      if (booking.cancellation_policy === "player_late_no_refund") {
        return "Binnen 24 uur voor de les geannuleerd. Daarom is er geen restitutie mogelijk.";
      }
      return "Deze boeking is geannuleerd.";
    case "refunded":
      return "Deze training is geannuleerd en het bedrag is volledig terugbetaald.";
    case "completed":
      return "Deze training is succesvol afgerond.";
  }
}

function getTrainerInitials(booking: PlayerBooking): string {
  const trainer = booking.trainers;
  if (!trainer) return "GT";
  if (trainer.initials?.trim()) return trainer.initials.trim().toUpperCase();

  const parts = trainer.name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "GT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getVenueLabel(venue: VenueSummary | null): string {
  if (!venue) return "LOCATIE VOLGT";
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

function canPlayerCancel(booking: PlayerBooking): boolean {
  if (booking.status !== "confirmed") return false;
  const startsAt = booking.availability_slots?.starts_at;
  return Boolean(startsAt && new Date(startsAt).getTime() > Date.now());
}

function isTimelyCancellation(booking: PlayerBooking): boolean {
  const startsAt = booking.availability_slots?.starts_at;
  if (!startsAt) return false;
  return new Date(startsAt).getTime() > Date.now() + 24 * 60 * 60 * 1000;
}

function MijnBoekingenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 💡 REF VOOR AUTOMATISCH SCROLLEN NAAR ANNULEER-BEVESTIGING
  const cancellationRef = useRef<HTMLElement | null>(null);

  const isPackageSuccess = searchParams.get("success") === "package";
  const packageIdParam = searchParams.get("package_id");

  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [bookings, setBookings] = useState<PlayerBooking[]>([]);

  // FILTER & PAGINATIE STATE
  const [statusFilter, setStatusFilter] = useState<BookingFilter>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [visibleLimit, setVisibleLimit] = useState<number>(6);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>();
  const [payingBookingId, setPayingBookingId] = useState<string | null>();

  // CHAT MODAL STATE
  const [chatBooking, setChatBooking] = useState<PlayerBooking | null>(null);

  // Review state
  const [reviewBookingId, setReviewBookingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>("");
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);

  const [pendingCancellation, setPendingCancellation] = useState<PlayerBooking | null>();
  const [pendingIssueBooking, setPendingIssueBooking] = useState<PlayerBooking | null>();

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    void loadPlayerBookings();
  }, []);

  const unreadBookings = useMemo(() => {
    return bookings.filter(
      (b) => b.chat_state?.has_unread_trainer_message && b.status === "confirmed"
    );
  }, [bookings]);

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    bookings.forEach((b) => {
      const startsAt = b.availability_slots?.starts_at;
      if (startsAt) {
        const date = new Date(startsAt);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        months.add(key);
      }
    });
    return Array.from(months).sort().reverse();
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (statusFilter === "upcoming" && b.status !== "confirmed" && b.status !== "payment_pending") {
        return false;
      }
      if (statusFilter === "completed" && b.status !== "completed") {
        return false;
      }
      if (
        statusFilter === "cancelled" &&
        b.status !== "cancelled" &&
        b.status !== "refunded" &&
        b.status !== "refund_pending"
      ) {
        return false;
      }

      if (selectedMonth !== "all") {
        const startsAt = b.availability_slots?.starts_at;
        if (!startsAt) return false;
        const date = new Date(startsAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (monthKey !== selectedMonth) return false;
      }

      return true;
    });
  }, [bookings, statusFilter, selectedMonth]);

  const { bookingSections, totalFilteredCount } = useMemo(() => {
    const sortedList = [...filteredBookings].sort((a, b) => {
      const timeA = a.availability_slots?.starts_at
        ? new Date(a.availability_slots.starts_at).getTime()
        : 0;
      const timeB = b.availability_slots?.starts_at
        ? new Date(b.availability_slots.starts_at).getTime()
        : 0;

      if (a.status === "confirmed" || a.status === "payment_pending") {
        return timeA - timeB;
      }
      return timeB - timeA;
    });

    const limitedList = sortedList.slice(0, visibleLimit);

    const pendingPayments = limitedList.filter((b) => b.status === "payment_pending");
    const upcoming = limitedList.filter((b) => b.status === "confirmed");
    const completed = limitedList.filter((b) => b.status === "completed");
    const cancelled = limitedList.filter(
      (b) => b.status === "cancelled" || b.status === "refunded" || b.status === "refund_pending"
    );

    const sections: BookingSection[] = [];

    if (pendingPayments.length > 0) {
      sections.push({ title: "BETALING NOG AFRONDEN", bookings: pendingPayments });
    }
    if (upcoming.length > 0) {
      sections.push({ title: "AANKOMENDE TRAININGEN", bookings: upcoming });
    }
    if (completed.length > 0) {
      sections.push({ title: "AFGERONDE TRAININGEN (REVIEW PLAATSEN)", bookings: completed });
    }
    if (cancelled.length > 0) {
      sections.push({ title: "GEANNULEERDE BOEKINGEN", bookings: cancelled });
    }

    return { bookingSections: sections, totalFilteredCount: filteredBookings.length };
  }, [filteredBookings, visibleLimit]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function loadPlayerBookings(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setErrorMessage("");

    try {
      await supabase.rpc("mark_past_bookings_completed");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/speler-login");
        return;
      }

      setCurrentUserId(session.user.id);

      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", session.user.id)
        .maybeSingle();

      const profile = profileData as PlayerProfile;
      if (profile?.role !== "player") {
        await supabase.auth.signOut();
        router.replace("/speler-login");
        return;
      }

      setPlayerProfile(profile);

      if (isPackageSuccess && packageIdParam) {
        await supabase.rpc("confirm_package_purchase", {
          p_package_id: packageIdParam,
          p_player_id: session.user.id,
        });
        router.replace("/mijn-boekingen");
      }

      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .select(
          `
            id,
            status,
            created_at,
            paid_at,
            hold_expires_at,
            cancelled_at,
            cancellation_policy,
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
            trainers ( id, name, sport, focus, image_url, initials )
          `
        )
        .eq("player_id", session.user.id)
        .order("created_at", { ascending: false });

      if (bookingError) {
        showError("Je boekingen konden niet worden geladen.");
        return;
      }

      const loadedBookings = (bookingData ?? []) as unknown as PlayerBooking[];
      const bookingIds = loadedBookings.map((b) => b.id);

      const { data: existingReviews } = await supabase
        .from("trainer_reviews")
        .select("booking_id")
        .eq("player_id", session.user.id);

      const reviewedBookingIds = new Set(existingReviews?.map((r) => r.booking_id));

      let messagesData: Array<{ booking_id: string; sender_role: string; created_at: string }> = [];

      if (bookingIds.length > 0) {
        const { data: fetchedMsgs } = await supabase
          .from("booking_messages")
          .select("booking_id, sender_role, created_at")
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: true });

        messagesData = fetchedMsgs ?? [];
      }

      const messagesByBooking = new Map<string, Array<{ sender_role: string; created_at: string }>>();
      messagesData.forEach((m) => {
        const list = messagesByBooking.get(m.booking_id) || [];
        list.push(m);
        messagesByBooking.set(m.booking_id, list);
      });

      const bookingsWithState = loadedBookings.map((b) => {
        const bMessages = messagesByBooking.get(b.id) || [];
        const hasMessages = bMessages.length > 0;
        const lastMsg = bMessages[bMessages.length - 1];

        let lastReadTimeStr: string | null = null;
        try {
          lastReadTimeStr = localStorage.getItem(`gowtrain_read_player_${b.id}`);
        } catch {
          lastReadTimeStr = null;
        }

        const lastReadTime = lastReadTimeStr ? new Date(lastReadTimeStr).getTime() : 0;

        const hasUnreadTrainer = bMessages.some((m) => {
          if (m.sender_role !== "trainer") return false;
          const msgTime = new Date(m.created_at).getTime();
          return msgTime > lastReadTime;
        });

        return {
          ...b,
          has_review: reviewedBookingIds.has(b.id),
          chat_state: {
            has_messages: hasMessages,
            has_unread_trainer_message: hasUnreadTrainer,
            last_sender_role: lastMsg ? (lastMsg.sender_role as "player" | "trainer") : null,
          },
        };
      });

      setBookings(bookingsWithState);
    } catch {
      showError("Je boekingen konden niet worden geladen.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function submitReview(booking: PlayerBooking): Promise<void> {
    if (!booking.trainers?.id || !playerProfile) return;

    setSubmittingReview(true);
    clearMessages();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { error: reviewError } = await supabase
        .from("trainer_reviews")
        .insert({
          booking_id: booking.id,
          trainer_id: booking.trainers.id,
          player_id: session.user.id,
          rating: reviewRating,
          comment: reviewComment.trim() || null,
        });

      if (reviewError) {
        showError("Je review kon niet worden opgeslagen.");
        return;
      }

      setSuccessMessage(`Bedankt! Je beoordeling voor ${booking.trainers.name} is geplaatst.`);
      setReviewBookingId(null);
      setReviewComment("");
      setReviewRating(5);

      await loadPlayerBookings(false);
    } catch {
      showError("Je review kon niet worden opgeslagen.");
    } finally {
      setSubmittingReview(false);
    }
  }

  async function handleCheckout(bookingId: string): Promise<void> {
    setPayingBookingId(bookingId);
    clearMessages();

    try {
      window.location.href = `/boeken/checkout?bookingId=${bookingId}`;
    } catch {
      showError("De betaalpagina kon niet worden geopend.");
      setPayingBookingId(null);
    }
  }

  // 💡 MET AUTOMATISCHE SCROLL NAAR DE ANNULEER-BEVESTIGING
  function openCancellationConfirmation(booking: PlayerBooking): void {
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

  function closeCancellationConfirmation(): void {
    setPendingCancellation(null);
  }

  function openIssueReport(booking: PlayerBooking): void {
    clearMessages();
    setPendingCancellation(null);
    setPendingIssueBooking(booking);
  }

  function closeIssueReport(): void {
    setPendingIssueBooking(null);
  }

  function handleIssueSubmitted(): void {
    setPendingIssueBooking(null);
    setSuccessMessage("Je melding is verstuurd naar GowTrain.");
  }

  async function handleCancellation(booking: PlayerBooking): Promise<void> {
    if (!canPlayerCancel(booking)) {
      showError("Deze training kan niet meer automatisch worden geannuleerd.");
      setPendingCancellation(null);
      return;
    }

    setCancellingBookingId(booking.id);
    clearMessages();

    try {
      const { data, error } = await supabase.rpc(
        "request_player_booking_cancellation",
        { p_booking_id: booking.id }
      );

      if (error) {
        showError(error.message || "Je training kon niet worden geannuleerd.");
        return;
      }

      const result = (Array.isArray(data) ? data[0] : data) as CancellationResult | null;
      if (!result) {
        showError("Je training kon niet worden geannuleerd.");
        return;
      }

      if (result.refund_required) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          router.replace("/speler-login");
          return;
        }

        const response = await fetch("/api/stripe/refunds/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ bookingId: booking.id }),
        });

        const refundResult = (await response.json()) as { error?: string };
        if (!response.ok) {
          showError(refundResult.error || "Terugbetaling kon niet gestart worden.");
          await loadPlayerBookings(false);
          return;
        }

        setSuccessMessage(`Je training is geannuleerd. ${formatEuro(result.refund_amount_cents, result.currency)} wordt teruggestort.`);
      } else {
        setSuccessMessage(result.message);
      }

      setPendingCancellation(null);
      await loadPlayerBookings(false);
    } catch {
      showError("Je training kon niet worden geannuleerd.");
    } finally {
      setCancellingBookingId(null);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadPlayerBookings(false);
    setRefreshing(false);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">BOEKINGEN LADEN...</p>
        </div>
      </main>
    );
  }

  const firstName = playerProfile?.full_name?.trim().split(" ")[0]?.toUpperCase() ?? "SPELER";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">SPELER PORTAL</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                HÉ, {firstName}.<br />JOUW BOEKINGEN.
              </h1>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="border-2 border-white px-4 py-3 font-display text-sm text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>

              <Link href="/trainers" className="inline-flex bg-[#FF4B3E] px-5 py-3 font-display text-sm text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]">
                BOEK TRAINING →
              </Link>
            </div>
          </div>

          {unreadBookings.length > 0 && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[8px_8px_0_0_#D6FF3F] flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="font-display text-2xl text-white">
                  {unreadBookings.length === 1 ? "1 NIEUW BERICHT VAN JE TRAINER!" : `${unreadBookings.length} NIEUWE BERICHTEN VAN JE TRAINERS!`}
                </p>
                <p className="mt-1 text-sm text-white/90">
                  {unreadBookings.length === 1
                    ? `${unreadBookings[0].trainers?.name || "Je trainer"} heeft een bericht gestuurd voor je les op ${formatDate(unreadBookings[0].availability_slots?.starts_at)}.`
                    : `Je hebt ongelezen berichten van trainers voor ${unreadBookings.length} van je geplande trainingen.`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setChatBooking(unreadBookings[0])}
                className="inline-flex shrink-0 items-center justify-center bg-[#14171A] px-6 py-3.5 font-display text-lg !text-[#D6FF3F] hover:bg-white hover:!text-[#14171A] transition shadow-[4px_4px_0_0_#14171A]"
              >
                OPEN BERICHT. GOW! →
              </button>
            </div>
          )}

          {isPackageSuccess && (
            <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] p-6 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <p className="font-display text-3xl">LESPAKKET GEBOEKT &amp; BEVESTIGD!</p>
              <p className="mt-2 text-base font-semibold leading-relaxed">
                Je hebt je lespakket succesvol afgerekend. Alle wekelijkse lessen uit jouw traject staan hieronder in je overzicht. Gow!
              </p>
            </div>
          )}

          {errorMessage && <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">{errorMessage}</div>}
          {successMessage && <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-5 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">{successMessage}</div>}

          {/* 💡 CONFIRMATION DIALOG VOOR ANNULEREN MET AUTOMATISCHE SCROLL & FOCUS */}
          {pendingCancellation && (
            <section
              ref={cancellationRef}
              tabIndex={-1}
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none sm:p-6 shadow-[8px_8px_0_0_#14171A]"
            >
              <p className="font-display text-3xl">TRAINING ANNULEREN?</p>
              <p className="mt-3 max-w-2xl text-white/90">
                {formatDate(pendingCancellation.availability_slots?.starts_at)} om {formatTime(pendingCancellation.availability_slots?.starts_at)} bij {pendingCancellation.trainers?.name || "je trainer"}.
              </p>
              {isTimelyCancellation(pendingCancellation) ? (
                <div className="mt-5 border-l-2 border-white pl-4">
                  <p className="font-display text-lg">JE ONTVANGT 100% TERUG</p>
                  <p className="mt-1 text-sm text-white/90">Je annuleert ruim 24 uur van tevoren. {formatEuro(pendingCancellation.total_price_cents)} wordt teruggestort.</p>
                </div>
              ) : (
                <div className="mt-5 border-l-2 border-white pl-4">
                  <p className="font-display text-lg">GEEN TERUGBETALING MOGELIJK</p>
                  <p className="mt-1 text-sm text-white/90">Je annuleert binnen 24 uur voor de training.</p>
                </div>
              )}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={closeCancellationConfirmation} className="border-2 border-white px-5 py-3 font-display text-base text-white hover:bg-white hover:text-[#14171A]">TERUG</button>
                <button type="button" onClick={() => void handleCancellation(pendingCancellation)} className="bg-[#14171A] px-5 py-3 font-display text-base text-white hover:bg-white hover:text-[#14171A]">JA, ANNULEER TRAINING</button>
              </div>
            </section>
          )}

          {pendingIssueBooking && (
            <BookingIssueModal
              bookingId={pendingIssueBooking.id}
              trainerName={pendingIssueBooking.trainers?.name || "je trainer"}
              trainingLabel={`${formatDate(pendingIssueBooking.availability_slots?.starts_at)} · ${formatTime(pendingIssueBooking.availability_slots?.starts_at)}`}
              onClose={closeIssueReport}
              onSubmitted={handleIssueSubmitted}
            />
          )}

          {chatBooking && (
            <BookingChatModal
              bookingId={chatBooking.id}
              recipientName={chatBooking.trainers?.name || "je trainer"}
              trainingLabel={`${chatBooking.availability_slots?.sport?.toUpperCase() || "LES"} · ${formatDate(chatBooking.availability_slots?.starts_at)} (${formatTime(chatBooking.availability_slots?.starts_at)} - ${formatTime(chatBooking.availability_slots?.ends_at)})`}
              venueLabel={chatBooking.availability_slots?.venue ? getVenueLabel(chatBooking.availability_slots.venue) : ""}
              currentUserRole="player"
              currentUserId={currentUserId}
              currentUserName={playerProfile?.full_name || "Speler"}
              onClose={() => setChatBooking(null)}
              onMessagesRead={() => void loadPlayerBookings(false)}
            />
          )}

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b-2 border-white/20 pb-6">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["ALLES", "all"],
                  ["AANKOMEND", "upcoming"],
                  ["AFGEROND", "completed"],
                  ["GEANNULEERD", "cancelled"],
                ] as [string, BookingFilter][]
              ).map(([label, value]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setStatusFilter(value); setVisibleLimit(6); }}
                  className={`border-2 px-4 py-2 font-display text-xs transition ${
                    statusFilter === value
                      ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[3px_3px_0_0_#FF4B3E]"
                      : "border-white/30 text-white hover:border-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {monthOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-display text-xs text-[#D6FF3F]">PER MAAND:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => { setSelectedMonth(e.target.value); setVisibleLimit(6); }}
                  className="border-2 border-white/30 bg-[#14171A] px-3 py-2 font-display text-xs text-white outline-none focus:border-[#D6FF3F]"
                >
                  <option value="all">ALLE MAANDEN</option>
                  {monthOptions.map((mKey) => {
                    const [year, month] = mKey.split("-");
                    const date = new Date(Number(year), Number(month) - 1, 1);
                    const label = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" }).format(date).toUpperCase();
                    return <option key={mKey} value={mKey}>{label}</option>;
                  })}
                </select>
              </div>
            )}
          </div>

          {bookingSections.length === 0 ? (
            <div className="mt-8 border-2 border-white/20 p-8 text-center text-[#B9BEC2]">
              <p className="font-display text-2xl text-[#D6FF3F]">GEEN BOEKINGEN GEVONDEN BINNEN DIT FILTER.</p>
              <p className="mt-2 text-sm">Kies een ander filter of boek een nieuwe training.</p>
            </div>
          ) : (
            <div className="mt-10 space-y-12">
              {bookingSections.map((section) => (
                <section key={section.title}>
                  <p className="font-display text-lg text-[#FF4B3E]">{section.title}</p>

                  <div className="mt-4 grid gap-6 lg:grid-cols-2">
                    {section.bookings.map((booking) => {
                      const trainer = booking.trainers;
                      const slot = booking.availability_slots;
                      const canCancel = canPlayerCancel(booking);
                      const isCompleted = booking.status === "completed";
                      const chat = booking.chat_state;

                      return (
                        <article key={booking.id} className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                          <div className="bg-[#14171A] p-5 text-white">
                            
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A]">
                                  {trainer?.image_url ? (
                                    <img src={trainer.image_url} alt={trainer.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="font-display text-lg text-[#D6FF3F]">{getTrainerInitials(booking)}</span>
                                  )}
                                </div>

                                <div>
                                  <p className="font-display text-2xl leading-none">{trainer?.name || "TRAINER"}</p>
                                  <p className="text-xs text-[#B9BEC2] mt-1">{trainer?.sport} · {trainer?.focus}</p>
                                </div>
                              </div>

                              <span className={`px-3 py-1.5 font-display text-xs ${getStatusClass(booking.status)}`}>
                                {getStatusLabel(booking.status)}
                              </span>
                            </div>

                            <div className="mt-5 border-y border-white/20 py-4">
                              <div className="flex items-end justify-between">
                                <div>
                                  <p className="font-display text-lg text-[#D6FF3F]">{formatDate(slot?.starts_at)}</p>
                                  <p className="font-display text-3xl mt-1">{formatTime(slot?.starts_at)} – {formatTime(slot?.ends_at)}</p>
                                </div>
                                <div className="text-right">
                                  <p className="font-display text-3xl text-[#D6FF3F]">{formatEuro(booking.total_price_cents)}</p>
                                  <p className="text-[10px] text-[#8A8F94]">INCL. BAANHUUR</p>
                                </div>
                              </div>
                            </div>

                            {slot?.venue && (
                              <p className="text-xs text-[#B9BEC2] mt-3"><b>Locatie:</b> {getVenueLabel(slot.venue)}</p>
                            )}

                            <div className="mt-4 border-l-2 border-[#D6FF3F] pl-3">
                              <p className="text-xs text-[#D7D9DA]">{getStatusExplanation(booking)}</p>
                            </div>

                            {booking.status === "confirmed" && slot && (
                              <div className="mt-5 space-y-2 pt-2 border-t border-white/10">
                                
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      window.open(
                                        getGoogleCalendarUrl(
                                          `GowTrain ${slot.sport.toUpperCase()} les bij ${trainer?.name || "trainer"}`,
                                          slot.starts_at,
                                          slot.ends_at,
                                          getVenueLabel(slot.venue),
                                          `GowTrain les bij ${trainer?.name || "trainer"}.`
                                        ),
                                        "_blank"
                                      )
                                    }
                                    className="inline-flex h-9 items-center justify-center border border-white/30 bg-[#14171A] px-2 font-display text-[11px] text-[#B9BEC2] hover:border-white hover:text-white transition select-none text-center"
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
                                        "_blank"
                                      )
                                    }
                                    className="inline-flex h-9 items-center justify-center border border-white/30 bg-[#14171A] px-2 font-display text-[11px] text-[#B9BEC2] hover:border-white hover:text-white transition select-none text-center"
                                  >
                                    DELEN VIA WHATSAPP
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setChatBooking(booking)}
                                  className={`w-full h-11 inline-flex items-center justify-center px-4 font-display text-xs font-bold leading-none tracking-tight transition select-none ${
                                    chat?.has_unread_trainer_message
                                      ? "bg-[#FF4B3E] !text-white animate-pulse shadow-[0_0_12px_#FF4B3E]"
                                      : "bg-[#D6FF3F] !text-[#14171A] hover:bg-white"
                                  }`}
                                >
                                  {chat?.has_unread_trainer_message
                                    ? "NIEUW BERICHT VAN TRAINER!"
                                    : chat?.has_messages
                                    ? "CHAT OPENEN"
                                    : "CHAT MET TRAINER"}
                                </button>

                              </div>
                            )}

                            {isCompleted && !booking.has_review && (
                              <div className="mt-5 border-2 border-[#D6FF3F] bg-[#14171A] p-4">
                                <p className="font-display text-base text-[#D6FF3F]">BEOORDEEL JE LES BIJ {trainer?.name?.toUpperCase()}</p>
                                <p className="mt-1 text-xs text-[#B9BEC2]">Hoe ging je training? Je beoordeling helpt andere spelers.</p>

                                {reviewBookingId === booking.id ? (
                                  <div className="mt-4 space-y-3">
                                    <div className="flex gap-2">
                                      {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                          key={star}
                                          type="button"
                                          onClick={() => setReviewRating(star)}
                                          className={`h-10 w-10 border-2 font-display text-lg transition ${
                                            reviewRating >= star
                                              ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                                              : "border-white/30 text-white"
                                          }`}
                                        >
                                          {star}★
                                        </button>
                                      ))}
                                    </div>

                                    <textarea
                                      value={reviewComment}
                                      onChange={(e) => setReviewComment(e.target.value)}
                                      placeholder="Vertel kort wat je van de training vond (optioneel)..."
                                      rows={3}
                                      className="w-full border-2 border-white/25 bg-transparent p-3 text-xs text-white outline-none focus:border-[#D6FF3F]"
                                    />

                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        disabled={submittingReview}
                                        onClick={() => void submitReview(booking)}
                                        className="flex-1 bg-[#FF4B3E] py-3 font-display text-sm text-white hover:bg-[#D6FF3F] hover:text-[#14171A]"
                                      >
                                        {submittingReview ? "PLAATSEN..." : "PLAATS REVIEW. GOW! →"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setReviewBookingId(null)}
                                        className="border border-white/30 px-3 py-3 font-display text-xs text-white"
                                      >
                                        ANNULEREN
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setReviewBookingId(booking.id)}
                                    className="mt-3 w-full bg-[#D6FF3F] py-3 font-display text-sm text-[#14171A] hover:bg-white"
                                  >
                                    SCHRIJF EEN REVIEW. GOW! →
                                  </button>
                                )}
                              </div>
                            )}

                            {isCompleted && (
                              <div className="mt-4 pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                                {booking.has_review ? (
                                  <span className="font-display text-xs text-[#D6FF3F]">✓ JE HEBT DEZE LES AL BEOORDEELD</span>
                                ) : (
                                  <span className="text-xs text-[#B9BEC2]">Les afgerond</span>
                                )}

                                {slot?.ends_at && new Date().getTime() - new Date(slot.ends_at).getTime() <= 24 * 60 * 60 * 1000 && (
                                  <button
                                    type="button"
                                    onClick={() => openIssueReport(booking)}
                                    className="text-[#B9BEC2] hover:text-[#FF4B3E] transition text-left sm:text-right text-[11px] font-semibold"
                                  >
                                    Iets misgegaan met deze les? Meld binnen 24u →
                                  </button>
                                )}
                              </div>
                            )}

                            {booking.status === "payment_pending" && (
                              <button
                                type="button"
                                disabled={payingBookingId === booking.id}
                                onClick={() => void handleCheckout(booking.id)}
                                className="mt-6 flex w-full items-center justify-center gap-2 bg-[#D6FF3F] px-4 py-3.5 font-display text-lg !text-[#14171A] font-bold transition hover:bg-white disabled:opacity-60"
                              >
                                {payingBookingId === booking.id ? "BETAALSCHERM OPENEN..." : "ROND BETALING AF. GOW! →"}
                              </button>
                            )}

                            {canCancel && (
                              <button
                                type="button"
                                disabled={cancellingBookingId === booking.id}
                                onClick={() => openCancellationConfirmation(booking)}
                                className="mt-3 w-full bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white hover:bg-white hover:text-[#14171A]"
                              >
                                LES ANNULEREN
                              </button>
                            )}

                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}

              {visibleLimit < totalFilteredCount && (
                <div className="pt-6 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((prev) => prev + 6)}
                    className="bg-[#D6FF3F] px-8 py-4 font-display text-xl text-[#14171A] transition hover:bg-white shadow-[6px_6px_0_0_#FF4B3E]"
                  >
                    MEER BOEKINGEN LADEN (+6). GOW! →
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function MijnBoekingenFallback() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2">
          <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
          <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
        </div>
        <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">BOEKINGEN LADEN...</p>
      </div>
    </main>
  );
}

export default function MijnBoekingenPage() {
  return (
    <Suspense fallback={<MijnBoekingenFallback />}>
      <MijnBoekingenContent />
    </Suspense>
  );
}