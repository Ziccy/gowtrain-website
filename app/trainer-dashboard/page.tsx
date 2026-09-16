"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TrainerBookingIssueModal from "@/components/TrainerBookingIssueModal";
import BookingChatModal from "@/components/BookingChatModal";
import { supabase } from "@/lib/supabase-browser";

type ApprovalStatus = "pending" | "approved" | "rejected";

type BookingStatus =
  | "payment_pending"
  | "confirmed"
  | "refund_pending"
  | "cancelled"
  | "refunded"
  | "completed";

type BookingFilter =
  | "all"
  | "payment_pending"
  | "confirmed"
  | "refund_pending"
  | "cancelled"
  | "refunded"
  | "completed";

type TrainerAccount = {
  id: string;
  name: string;
  is_active: boolean;
  approval_status: ApprovalStatus;
  stripe_account_id: string | null;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  calendar_feed_token: string | null;
};

type VenueSummary = {
  id: string;
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

type MessageState = {
  has_messages: boolean;
  has_unread_player_message: boolean;
  last_sender_role: "player" | "trainer" | null;
};

type Booking = {
  id: string;
  slot_id: string | null;
  player_name: string;
  player_email: string;
  participant_count: number;
  total_price_cents: number;
  commission_amount_cents: number;
  trainer_net_amount_cents: number;
  currency: string;
  status: BookingStatus;
  created_at: string;
  hold_expires_at: string | null;
  cancellation_policy: string | null;
  availability_slots: BookingSlot;
  chat_state?: MessageState;
};

type BookingSection = {
  title: string;
  bookings: Booking[];
};

type TrainerCancellationResult = {
  booking_id: string;
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

function getVenueLabel(venue: VenueSummary | null): string {
  if (!venue) return "LOCATIE ONBEKEND";
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

function getStatusLabel(status: BookingStatus): string {
  switch (status) {
    case "payment_pending":
      return "IN BETALING";
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

function getStatusExplanation(status: BookingStatus): string {
  switch (status) {
    case "payment_pending":
      return "De speler rondt de betaling nog af. De reservering staat tijdelijk vast.";
    case "confirmed":
      return "De betaling is geslaagd. Deze training staat definitief in je agenda.";
    case "refund_pending":
      return "Training geannuleerd. De terugbetaling naar de speler wordt verwerkt.";
    case "cancelled":
      return "Deze boeking is geannuleerd.";
    case "refunded":
      return "Deze boeking is geannuleerd en volledig terugbetaald aan de speler.";
    case "completed":
      return "Deze training is succesvol afgerond.";
  }
}

function getBookingTime(booking: Booking): number {
  const startsAt = booking.availability_slots?.starts_at;
  return startsAt ? new Date(startsAt).getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * 💡 HAALT EXACTE DATUM IN AMSTERDAMSE TIJDZONE OP OM DATUMFILTERING 100% BETROUWBAAR TE MAKEN
 */
function getAmsterdamSlotDate(isoDate?: string): string {
  if (!isoDate) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoDate));

  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

function canTrainerCancelBooking(booking: Booking): boolean {
  if (booking.status !== "confirmed") return false;
  const startsAt = booking.availability_slots?.starts_at;
  return Boolean(startsAt && new Date(startsAt).getTime() > Date.now());
}

export default function TrainerDashboardPage() {
  const router = useRouter();

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [availableSlotsCount, setAvailableSlotsCount] = useState(0);

  // FILTERS
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingUpStripe, setSettingUpStripe] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);

  // CHAT MODAL
  const [chatBooking, setChatBooking] = useState<Booking | null>(null);

  const [pendingTrainerCancellation, setPendingTrainerCancellation] = useState<Booking | null>();
  const [pendingTrainerIssueBooking, setPendingTrainerIssueBooking] = useState<Booking | null>();
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>();

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const trainerCancellationRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  const unreadBookings = useMemo(() => {
    return bookings.filter(
      (b) => b.chat_state?.has_unread_player_message && b.status === "confirmed"
    );
  }, [bookings]);

  const paymentPendingCount = useMemo(
    () => bookings.filter((booking) => booking.status === "payment_pending").length,
    [bookings]
  );

  const confirmedBookingsCount = useMemo(
    () => bookings.filter((booking) => booking.status === "confirmed").length,
    [bookings]
  );

  const thisMonthNetEarningsCents = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let totalCents = 0;
    bookings.forEach((b) => {
      if (b.status === "confirmed" || b.status === "completed") {
        const startsAt = b.availability_slots?.starts_at;
        const date = startsAt ? new Date(startsAt) : new Date(b.created_at);
        if (date.getFullYear() === currentYear && date.getMonth() === currentMonth) {
          totalCents += b.trainer_net_amount_cents || (b.total_price_cents - (b.commission_amount_cents || 0));
        }
      }
    });

    return totalCents;
  }, [bookings]);

  const stripeIsReady =
    trainerAccount?.stripe_details_submitted === true &&
    trainerAccount?.stripe_payouts_enabled === true;

  const stripeHasStarted = Boolean(trainerAccount?.stripe_account_id);

  // 💡 GEFILERDE BOEKINGEN MET GEFIXTE DATUM-VERGELIJKING
  const bookingSections = useMemo((): BookingSection[] => {
    let sortedBookings = [...bookings].sort(
      (first, second) => getBookingTime(first) - getBookingTime(second)
    );

    // DATUMRANGE FILTER
    if (startDateFilter || endDateFilter) {
      sortedBookings = sortedBookings.filter((b) => {
        const slotDate = getAmsterdamSlotDate(b.availability_slots?.starts_at || b.created_at);
        if (startDateFilter && slotDate < startDateFilter) return false;
        if (endDateFilter && slotDate > endDateFilter) return false;
        return true;
      });
    }

    if (bookingFilter !== "all") {
      const filteredBookings = sortedBookings.filter(
        (booking) => booking.status === bookingFilter
      );

      const titles: Record<Exclude<BookingFilter, "all">, string> = {
        payment_pending: "IN BETALING",
        confirmed: "BEVESTIGDE BOEKINGEN",
        refund_pending: "REFUNDS IN VERWERKING",
        cancelled: "GEANNULEERDE BOEKINGEN",
        refunded: "TERUGBETAALDE BOEKINGEN",
        completed: "AFGEROND",
      };

      return filteredBookings.length
        ? [{ title: titles[bookingFilter], bookings: filteredBookings }]
        : [];
    }

    const pendingPayments = sortedBookings.filter(
      (booking) => booking.status === "payment_pending"
    );

    const futureConfirmed = sortedBookings.filter(
      (booking) =>
        booking.status === "confirmed" && getBookingTime(booking) >= Date.now()
    );

    const nextBooking = futureConfirmed[0] ?? null;

    const priorityIds = new Set([
      ...pendingPayments.map((booking) => booking.id),
      ...(nextBooking ? [nextBooking.id] : []),
    ]);

    const otherBookings = sortedBookings.filter(
      (booking) => !priorityIds.has(booking.id)
    );

    const sections: BookingSection[] = [];

    if (pendingPayments.length) {
      sections.push({
        title: "IN BETALING (SPELERS)",
        bookings: pendingPayments,
      });
    }

    if (nextBooking) {
      sections.push({
        title: "EERSTVOLGENDE TRAINING",
        bookings: [nextBooking],
      });
    }

    if (otherBookings.length) {
      sections.push({
        title: "ALLE BOEKINGEN",
        bookings: otherBookings,
      });
    }

    return sections;
  }, [bookings, bookingFilter, startDateFilter, endDateFilter]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function loadDashboard(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);

    setErrorMessage("");
    setProfileMissing(false);

    try {

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/trainer-login");
        return;
      }

      setCurrentUserId(session.user.id);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        await supabase.auth.signOut();
        router.replace("/trainer-login");
        return;
      }

      const { data: trainerData, error: trainerError } = await supabase
        .from("trainers")
        .select("id, name, is_active, approval_status, stripe_account_id, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled, calendar_feed_token")
        .eq("user_id", user.id)
        .maybeSingle();

      if (trainerError || !trainerData) {
        setTrainerAccount(null);
        setBookings([]);
        setAvailableSlotsCount(0);
        setProfileMissing(true);
        return;
      }

      setTrainerAccount(trainerData as TrainerAccount);
      const trainer = trainerData as TrainerAccount;

      if (trainer.approval_status !== "approved" || trainer.is_active !== true) {
        setBookings([]);
        setAvailableSlotsCount(0);
        return;
      }

      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .select(
          `
            id,
            slot_id,
            player_name,
            player_email,
            participant_count,
            total_price_cents,
            commission_amount_cents,
            trainer_net_amount_cents,
            currency,
            status,
            created_at,
            hold_expires_at,
            cancellation_policy,
            availability_slots (
              starts_at,
              ends_at,
              sport,
              venue:venues!availability_slots_location_id_fkey (
                id, name, city, address_line, postal_code
              )
            )
          `
        )
        .eq("trainer_id", trainer.id)
        .order("created_at", { ascending: false });

      if (bookingError) {
        showError("Je boekingen konden niet worden geladen.");
      } else {
        const rawBookings = (bookingData ?? []) as unknown as Booking[];
        const bookingIds = rawBookings.map((b) => b.id);

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

        const bookingsWithState = rawBookings.map((b) => {
          const bMessages = messagesByBooking.get(b.id) || [];
          const hasMessages = bMessages.length > 0;
          const lastMsg = bMessages[bMessages.length - 1];

          let lastReadTimeStr: string | null = null;
          try {
            lastReadTimeStr = localStorage.getItem(`gowtrain_read_trainer_${b.id}`);
          } catch {
            lastReadTimeStr = null;
          }

          const lastReadTime = lastReadTimeStr ? new Date(lastReadTimeStr).getTime() : 0;

          const hasUnreadPlayer = bMessages.some((m) => {
            if (m.sender_role !== "player") return false;
            const msgTime = new Date(m.created_at).getTime();
            return msgTime > lastReadTime;
          });

          return {
            ...b,
            chat_state: {
              has_messages: hasMessages,
              has_unread_player_message: hasUnreadPlayer,
              last_sender_role: lastMsg ? (lastMsg.sender_role as "player" | "trainer") : null,
            },
          };
        });

        setBookings(bookingsWithState);
      }

      const { count } = await supabase
        .from("availability_slots")
        .select("id", { count: "exact", head: true })
        .eq("trainer_id", trainer.id)
        .eq("status", "available")
        .gte("starts_at", new Date().toISOString());

      setAvailableSlotsCount(count ?? 0);

    } catch {
      showError("Je dashboard kon niet worden geladen.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadDashboard(false);
    setRefreshing(false);
  }

  async function handleStripeOnboarding(): Promise<void> {
    setSettingUpStripe(true);
    clearMessages();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        router.replace("/trainer-login");
        return;
      }

      const response = await fetch("/api/stripe/connect/onboarding", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const result = (await response.json()) as { onboardingUrl?: string; error?: string };
      if (!response.ok || !result.onboardingUrl) {
        showError(result.error || "Uitbetalingen instellen lukt nu niet.");
        return;
      }

      window.location.href = result.onboardingUrl;
    } catch {
      showError("Uitbetalingen instellen lukt nu niet.");
    } finally {
      setSettingUpStripe(false);
    }
  }

  function openTrainerCancellation(booking: Booking): void {
    clearMessages();
    setPendingTrainerIssueBooking(null);
    setPendingTrainerCancellation(booking);

    window.setTimeout(() => {
      trainerCancellationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      trainerCancellationRef.current?.focus();
    }, 50);
  }

  function closeTrainerCancellation(): void {
    setPendingTrainerCancellation(null);
  }

  function openTrainerIssueReport(booking: Booking): void {
    clearMessages();
    setPendingTrainerCancellation(null);
    setPendingTrainerIssueBooking(booking);
  }

  function closeTrainerIssueReport(): void {
    setPendingTrainerIssueBooking(null);
  }

  function handleTrainerIssueSubmitted(): void {
    setPendingTrainerIssueBooking(null);
    setSuccessMessage("Je melding is verstuurd naar GowTrain.");
  }

  async function handleTrainerCancellation(
  booking: Booking
): Promise<void> {
  if (cancellingBookingId) return;

  if (!canTrainerCancelBooking(booking)) {
    showError("Deze training kan niet meer geannuleerd worden.");
    setPendingTrainerCancellation(null);
    return;
  }

  setCancellingBookingId(booking.id);
  clearMessages();

  try {
    const { data, error } = await supabase.rpc(
      "request_trainer_lesson_cancellation",
      {
        p_booking_id: booking.id,
      }
    );

    if (error) {
      console.error("Trainerannulering mislukt:", {
        code: error.code,
        message: error.message,
      });

      showError(
        error.code === "P0001" || error.code === "42501"
          ? error.message
          : "De annulering kon niet worden bevestigd. Vernieuw het overzicht voordat je opnieuw probeert."
      );

      return;
    }

    const result = data as {
      booking_id: string;
      refund_request_id: string;
      refund_status: string;
      refund_amount_cents: number;
      currency: string;
      message: string;
    } | null;

    if (
      !result ||
      result.booking_id !== booking.id ||
      !result.refund_request_id
    ) {
      showError(
        "Het resultaat kon niet worden bevestigd. Vernieuw het overzicht voordat je opnieuw probeert."
      );
      return;
    }

    setPendingTrainerCancellation(null);

    await loadDashboard(false);

    setSuccessMessage(result.message);

    /*
     * Geen fetch naar /api/stripe/refunds/create.
     * Annulering en refundopdracht zijn samen opgeslagen.
     */
  } catch {
    showError(
      "De verbinding is onderbroken. De annulering kan al geregistreerd zijn. Controleer eerst het overzicht."
    );
  } finally {
    setCancellingBookingId(null);
  }
}

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    router.replace("/trainer-login");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">DASHBOARD LADEN...</p>
        </div>
      </main>
    );
  }

  if (profileMissing) {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">TRAINERPROFIEL ONTBREEKT</p>
              <h1 className="mt-4 font-display text-5xl leading-[0.85]">JE ACCOUNT IS NOG NIET GEKOPPELD.</h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">Je bent ingelogd, maar er is nog geen trainerprofiel gekoppeld aan dit e-mailadres.</p>
              <button type="button" onClick={() => void handleLogout()} className="mt-8 w-full bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white">UITLOGGEN</button>
            </div>
          </div>
        </section>
        <SiteFooter />
      </main>
    );
  }

  if (trainerAccount?.approval_status !== "approved" || trainerAccount?.is_active !== true) {
    const isRejected = trainerAccount?.approval_status === "rejected";
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">{isRejected ? "AANMELDING AFGEKEURD" : "WACHT OP GOEDKEURING"}</p>
              <h1 className="mt-4 font-display text-5xl leading-[0.85]">{isRejected ? "JE PROFIEL IS NIET GOEDGEKEURD." : "JE PROFIEL IS IN BEHANDELING."}</h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">{isRejected ? "Neem contact op met GowTrain als je denkt dat dit een vergissing is." : "We controleren je trainerprofiel. Je ontvangt bericht zodra je live kunt gaan."}</p>
              <button type="button" onClick={() => void handleLogout()} className="mt-8 w-full bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white">UITLOGGEN</button>
            </div>
          </div>
        </section>
        <SiteFooter />
      </main>
    );
  }

  const firstName = trainerAccount.name.trim().split(" ")[0] || "TRAINER";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          {/* TOP BANNER */}
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">TRAINER DASHBOARD</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                HÉ, {firstName.toUpperCase()}.<br />KLAAR OM TE GOW!EN?
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <Link
                href="/trainer-profiel-bewerken"
                className="border-2 border-white px-4 py-3 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                PROFIEL BEWERKEN
              </Link>

              <button
                type="button"
                onClick={() => {
                  document.getElementById("boekingen-overzicht")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="border-2 border-white px-4 py-3 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                BOEKINGEN ↓
              </button>

              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="font-display text-base text-[#D6FF3F] transition hover:text-white disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          {/* RODE NOTIFICATIE BANNER VOOR ONGELEZEN BERICHTEN */}
          {unreadBookings.length > 0 && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[8px_8px_0_0_#D6FF3F] flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="font-display text-2xl text-white">
                  {unreadBookings.length === 1 ? "1 NIEUW BERICHT VAN JE SPELER!" : `${unreadBookings.length} NIEUWE BERICHTEN VAN JE SPELERS!`}
                </p>
                <p className="mt-1 text-sm text-white/90">
                  {unreadBookings.length === 1
                    ? `${unreadBookings[0].player_name} heeft een bericht gestuurd voor de training op ${formatDate(unreadBookings[0].availability_slots?.starts_at)}.`
                    : `Je hebt ongelezen berichten van spelers voor ${unreadBookings.length} van je geplande trainingen.`}
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

          {errorMessage && <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">{errorMessage}</div>}
          {successMessage && <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-5 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">{successMessage}</div>}

          {/* CHAT MODAL */}
          {chatBooking && (
            <BookingChatModal
              bookingId={chatBooking.id}
              recipientName={chatBooking.player_name}
              trainingLabel={`${chatBooking.availability_slots?.sport?.toUpperCase() || "TRAINING"} · ${formatDate(chatBooking.availability_slots?.starts_at)} (${formatTime(chatBooking.availability_slots?.starts_at)} - ${formatTime(chatBooking.availability_slots?.ends_at)})`}
              venueLabel={chatBooking.availability_slots?.venue ? getVenueLabel(chatBooking.availability_slots.venue) : ""}
              currentUserRole="trainer"
              currentUserId={currentUserId}
              currentUserName={trainerAccount?.name || "Trainer"}
              onClose={() => setChatBooking(null)}
              onMessagesRead={() => void loadDashboard(false)}
            />
          )}

          {/* STRIPE & AGENDA CARDS */}
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section className="border-2 border-[#FF4B3E] bg-white/5 p-5 sm:p-6 shadow-[6px_6px_0_0_#FF4B3E] flex flex-col justify-between h-full">
              <div>
                <p className="font-display text-sm text-[#FF4B3E]">UITBETALINGEN &amp; STRIPE</p>
                <h2 className="mt-1 font-display text-2xl text-white">
                  {stripeIsReady ? "STRIPE IS ACTIEF & GEKOPPELD" : stripeHasStarted ? "MAAK JE STRIPE GEGEVENS COMPLEET" : "STEL JE UITBETALINGEN IN"}
                </h2>
                <p className="mt-2 text-xs text-[#B9BEC2] leading-relaxed">
                  {stripeIsReady ? "Je bankrekening is gekoppeld via Stripe. GowTrain kan je automatische uitbetalingen na elke les verwerken." : "Koppel je bankrekening veilig via Stripe om uitbetalingen van geboekte lessen te ontvangen."}
                </p>
              </div>

              <div className="mt-5">
                {stripeIsReady ? (
                  <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-3 text-[#14171A]">
                    <p className="font-display text-base">ACTIEF - STRIPE CONNECT GEKOPPELD</p>
                  </div>
                ) : (
                  <button type="button" onClick={() => void handleStripeOnboarding()} disabled={settingUpStripe} className="w-full bg-[#D6FF3F] px-5 py-3.5 font-display text-sm text-[#14171A] hover:bg-white transition disabled:opacity-60">
                    {settingUpStripe ? "STRIPE OPENEN..." : stripeHasStarted ? "ONBOARDING AFRONDEN →" : "KOPPEL STRIPE. GOW! →"}
                  </button>
                )}
              </div>
            </section>

            <section className="border-2 border-[#D6FF3F] bg-[#14171A] p-5 sm:p-6 shadow-[6px_6px_0_0_#D6FF3F] flex flex-col justify-between h-full">
              <div>
                <p className="font-display text-xs text-[#D6FF3F]">AUTOMATISCHE AGENDA SYNC</p>
                <h3 className="mt-1 font-display text-2xl text-white">TELEFOON &amp; PC AGENDA</h3>
                <p className="mt-2 text-xs text-[#B9BEC2] leading-relaxed">
                  Koppel GowTrain met Outlook, Google Calendar of Apple Calendar. Alle nieuwe boekingen verschijnen automatisch in je agenda.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`https://${typeof window !== "undefined" ? window.location.host : "gowtrain.app"}/api/calendar/trainer/${trainerAccount?.calendar_feed_token || ""}.ics`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center bg-[#D6FF3F] px-3.5 font-display text-s !text-[#14171A] leading-none transition hover:bg-white select-none shrink-0">
                  GOOGLE
                </a>
                <a href={`webcal://${typeof window !== "undefined" ? window.location.host : "gowtrain.app"}/api/calendar/trainer/${trainerAccount?.calendar_feed_token || ""}.ics`} className="inline-flex h-10 items-center justify-center bg-[#D6FF3F] px-3.5 font-display text-s !text-[#14171A] leading-none transition hover:bg-white select-none shrink-0">
                  OUTLOOK / APPLE
                </a>
                <button type="button" onClick={() => {
                  if (trainerAccount?.calendar_feed_token) {
                    const feedUrl = `https://${window.location.host}/api/calendar/trainer/${trainerAccount.calendar_feed_token}.ics`;
                    navigator.clipboard.writeText(feedUrl);
                    alert("Agenda-link gekopieerd!");
                  }
                }} className="inline-flex h-10 items-center justify-center bg-[#D6FF3F] px-3.5 font-display text-xs !text-[#14171A] leading-none transition hover:bg-white select-none shrink-0">
                  LINK
                </button>
              </div>
            </section>
          </div>

          {/* COUNTERS */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{availableSlotsCount}</p>
              <p className="mt-2 font-display text-base">OPEN TIJDSLOTEN</p>
            </div>
            <div className="border-2 border-white bg-white p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{paymentPendingCount}</p>
              <p className="mt-2 font-display text-base">IN BETALING (SPELERS)</p>
            </div>
            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-5xl">{confirmedBookingsCount}</p>
              <p className="mt-2 font-display text-base">BEVESTIGDE BOEKINGEN</p>
            </div>
          </div>

          {/* ANNULEREN DIALOG */}
          {pendingTrainerCancellation && (
            <section ref={trainerCancellationRef} tabIndex={-1} className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none sm:p-6 shadow-[8px_8px_0_0_#14171A]">
              <p className="font-display text-3xl">TRAINING ANNULEREN?</p>
              <p className="mt-3 max-w-2xl leading-relaxed text-white/90">
                Je annuleert de training met <strong>{pendingTrainerCancellation.player_name}</strong> op {formatDate(pendingTrainerCancellation.availability_slots?.starts_at)} om {formatTime(pendingTrainerCancellation.availability_slots?.starts_at)}.
              </p>
              <div className="mt-5 border-l-2 border-white pl-4">
                <p className="font-display text-lg">SPELER ONTVANGT 100% TERUG</p>
                <p className="mt-1 text-sm leading-relaxed text-white/90">{formatEuro(pendingTrainerCancellation.total_price_cents, pendingTrainerCancellation.currency)} wordt automatisch teruggestort.</p>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={closeTrainerCancellation} disabled={cancellingBookingId === pendingTrainerCancellation.id} className="border-2 border-white px-5 py-3 font-display text-base text-white hover:bg-white hover:text-[#14171A]">TERUG</button>
                <button type="button" onClick={() => void handleTrainerCancellation(pendingTrainerCancellation)} disabled={cancellingBookingId === pendingTrainerCancellation.id} className="bg-[#14171A] px-5 py-3 font-display text-base text-white hover:bg-white hover:text-[#14171A]">
                  {cancellingBookingId === pendingTrainerCancellation.id ? "VERWERKEN..." : "JA, ANNULEER LES"}
                </button>
              </div>
            </section>
          )}

          {/* ISSUE REPORT MODAL (POP-UP) */}
          {pendingTrainerIssueBooking && (
            <TrainerBookingIssueModal
              bookingId={pendingTrainerIssueBooking.id}
              playerName={pendingTrainerIssueBooking.player_name}
              trainingLabel={`${formatDate(pendingTrainerIssueBooking.availability_slots?.starts_at)} · ${formatTime(pendingTrainerIssueBooking.availability_slots?.starts_at)} – ${formatTime(pendingTrainerIssueBooking.availability_slots?.ends_at)}`}
              onClose={closeTrainerIssueReport}
              onSubmitted={handleTrainerIssueSubmitted}
            />
          )}

          {/* QUICK LINKS */}
          <div className="mt-12">
            <p className="font-display text-lg text-[#FF4B3E]">SNEL BEHEREN</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Link href="/trainer-slot-toevoegen" className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-6 !text-[#14171A] transition hover:-translate-y-1 shadow-[6px_6px_0_0_#FF4B3E]">
                <p className="font-display text-3xl">+ SLOT</p>
                <p className="mt-2 text-xs font-semibold">Zet een losse les open voor spelers.</p>
                <p className="mt-6 font-display text-sm text-[#FF4B3E]">TOEVOEGEN →</p>
              </Link>

              <Link href="/trainer-pakket-toevoegen" className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-6 text-white transition hover:-translate-y-1 shadow-[6px_6px_0_0_#D6FF3F]">
                <p className="font-display text-3xl">+ PAKKET</p>
                <p className="mt-2 text-xs font-semibold text-white/90">Bied een 5-12 weken traject aan.</p>
                <p className="mt-6 font-display text-sm text-[#D6FF3F]">AANMAKEN →</p>
              </Link>

              <Link href="/trainer-beschikbaarheid" className="border-2 border-white bg-white p-6 !text-[#14171A] transition hover:-translate-y-1 shadow-[6px_6px_0_0_#FF4B3E]">
                <p className="font-display text-3xl">ROOSTER</p>
                <p className="mt-2 text-xs text-[#53595E]">Stel je wekelijkse vaste tijden in.</p>
                <p className="mt-6 font-display text-sm">BEHEREN →</p>
              </Link>

              <Link href="/trainer-slots" className="border-2 border-white bg-[#14171A] p-6 text-white transition hover:-translate-y-1 shadow-[6px_6px_0_0_#D6FF3F]">
                <p className="font-display text-3xl text-[#D6FF3F]">SLOTS</p>
                <p className="mt-2 text-xs text-[#B9BEC2]">Bekijk al je open slots &amp; pakketten.</p>
                <p className="mt-6 font-display text-sm text-[#D6FF3F]">BEKIJK ALLES →</p>
              </Link>
            </div>
          </div>

          {/* INKOMSTEN BANNER */}
          <div className="mt-12 border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E] flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-display text-xs opacity-80">NETTO INKOMSTEN DEZE MAAND</p>
              <p className="font-display text-4xl leading-none mt-1">{formatEuro(thisMonthNetEarningsCents)}</p>
            </div>
            <Link href="/trainer-inkomsten" className="inline-flex items-center justify-center bg-[#14171A] px-6 py-4 font-display text-base !text-white hover:bg-white hover:!text-[#14171A] transition shadow-[4px_4px_0_0_#FF4B3E]">
              OPEN FINANCIEEL DASHBOARD &amp; GRAFIEKEN →
            </Link>
          </div>

          {/* BOEKINGEN OVERZICHT */}
          <div id="boekingen-overzicht" className="mt-12 scroll-mt-10">
            <div className="flex flex-col justify-between gap-5 border-b-2 border-white/20 pb-5 lg:flex-row lg:items-end">
              <div>
                <p className="font-display text-lg text-[#FF4B3E]">JOUW AGENDA & BOEKINGEN</p>
                <h2 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl">OVERZICHT.</h2>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["ALLES", "all"],
                      ["IN BETALING", "payment_pending"],
                      ["BEVESTIGD", "confirmed"],
                      ["AFGEROND", "completed"],
                      ["REFUND", "refund_pending"],
                      ["GEANNULEERD", "cancelled"],
                    ] as [string, BookingFilter][]
                  ).map(([label, value]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBookingFilter(value)}
                      className={`border-2 px-3 py-2 font-display text-xs transition ${
                        bookingFilter === value
                          ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                          : "border-white/30 text-white hover:border-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* 💡 GEFIXTE DATUMPRIKKER FILTER (VAN EN TOT) */}
                <div className="flex items-center gap-2 border-t border-white/10 pt-2 sm:border-t-0 sm:pt-0 sm:border-l sm:border-white/20 sm:pl-3">
                  <div className="flex items-center gap-1">
                    <span className="font-display text-[10px] text-[#D6FF3F]">VAN:</span>
                    <input
                      type="date"
                      value={startDateFilter}
                      onChange={(e) => setStartDateFilter(e.target.value)}
                      className="border-2 border-white/30 bg-[#14171A] px-2 py-1 font-display text-xs text-white outline-none focus:border-[#D6FF3F] [color-scheme:dark]"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-display text-[10px] text-[#D6FF3F]">TOT:</span>
                    <input
                      type="date"
                      value={endDateFilter}
                      onChange={(e) => setEndDateFilter(e.target.value)}
                      className="border-2 border-white/30 bg-[#14171A] px-2 py-1 font-display text-xs text-white outline-none focus:border-[#D6FF3F] [color-scheme:dark]"
                    />
                  </div>
                  {(startDateFilter || endDateFilter) && (
                    <button
                      type="button"
                      onClick={() => { setStartDateFilter(""); setEndDateFilter(""); }}
                      className="border border-[#FF4B3E] px-2 py-1 font-display text-[10px] text-[#FF4B3E] hover:bg-[#FF4B3E] hover:text-white"
                    >
                      RESET
                    </button>
                  )}
                </div>
              </div>
            </div>

            {bookingSections.length === 0 ? (
              <div className="mt-6 border-2 border-white/20 p-6 text-center">
                <p className="font-display text-3xl text-[#D6FF3F]">GEEN BOEKINGEN VOOR DIT FILTER.</p>
                <p className="mt-2 text-sm text-[#B9BEC2]">Kies een ander filter of voeg meer tijdsloten toe.</p>
              </div>
            ) : (
              <div className="mt-8 space-y-12">
                {bookingSections.map((section) => (
                  <section key={section.title}>
                    <h3 className="font-display text-xl text-[#FF4B3E]">{section.title}</h3>

                    <div className="mt-4 grid gap-6 lg:grid-cols-2">
                      {section.bookings.map((booking) => {
                        const slot = booking.availability_slots;
                        const canCancel = canTrainerCancelBooking(booking);
                        const isCompleted = booking.status === "completed";
                        const chat = booking.chat_state;

                        return (
                          <article key={booking.id} className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                            <div className="bg-[#14171A] p-5 text-white">
                              
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="font-display text-2xl text-white">{booking.player_name}</p>
                                  <p className="mt-0.5 truncate text-xs text-[#B9BEC2]">{booking.player_email}</p>
                                </div>

                                <span className={`shrink-0 px-3 py-1.5 font-display text-xs ${getStatusClass(booking.status)}`}>
                                  {getStatusLabel(booking.status)}
                                </span>
                              </div>

                              <div className="mt-6 border-y border-white/20 py-4">
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <p className="font-display text-lg text-[#D6FF3F]">{formatDate(slot?.starts_at)}</p>
                                    <p className="mt-1 font-display text-2xl">{formatTime(slot?.starts_at)} – {formatTime(slot?.ends_at)}</p>
                                    {slot && (
                                      <p className="mt-1 font-display text-xs text-[#B9BEC2]">{slot.sport.toUpperCase()} · {booking.participant_count} {booking.participant_count === 1 ? "SPELER" : "SPELERS"}</p>
                                    )}
                                  </div>

                                  <div className="text-right">
                                    <p className="font-display text-[10px] text-[#8A8F94]">INKOMSTEN</p>
                                    <p className="mt-1 font-display text-3xl text-[#D6FF3F]">{formatEuro(booking.total_price_cents, booking.currency)}</p>
                                    <p className="mt-0.5 font-display text-[10px] text-[#B9BEC2]">INCL. BAANHUUR</p>
                                  </div>
                                </div>
                              </div>

                              {slot?.venue && (
                                <div className="mt-4">
                                  <p className="font-display text-xs text-[#FF4B3E]">LOCATIE</p>
                                  <p className="mt-1 font-display text-base text-white">{getVenueLabel(slot.venue)}</p>
                                  <p className="mt-1 text-xs text-[#B9BEC2]">{slot.venue.address_line}, {slot.venue.city}</p>
                                </div>
                              )}

                              <div className="mt-4 border-l-2 border-[#D6FF3F] pl-4">
                                <p className="text-xs text-[#D7D9DA]">{getStatusExplanation(booking.status)}</p>
                              </div>

                              {/* 💡 CHATKNOP VOOR BEVESTIGDE LESSEN */}
                              {booking.status === "confirmed" && (
                                <div className="mt-6">
                                  <button
                                    type="button"
                                    onClick={() => setChatBooking(booking)}
                                    className={`w-full h-11 inline-flex items-center justify-center px-4 font-display text-xs font-bold leading-none tracking-tight transition select-none ${
                                      chat?.has_unread_player_message
                                        ? "bg-[#FF4B3E] !text-white animate-pulse shadow-[0_0_12px_#FF4B3E]"
                                        : "bg-[#D6FF3F] !text-[#14171A] hover:bg-white"
                                    }`}
                                  >
                                    {chat?.has_unread_player_message
                                      ? "NIEUW BERICHT VAN SPELER!"
                                      : chat?.has_messages
                                      ? "CHAT OPENEN"
                                      : "CHAT MET SPELER"}
                                  </button>
                                </div>
                              )}

                              {canCancel && (
                                <button type="button" disabled={cancellingBookingId === booking.id || pendingTrainerCancellation?.id === booking.id} onClick={() => openTrainerCancellation(booking)} className="mt-3 w-full bg-[#FF4B3E] px-4 py-3.5 font-display text-sm text-white hover:bg-white hover:text-[#14171A]">
                                  TRAINING ANNULEREN
                                </button>
                              )}

                              {/* 💡 SUBTIELE GARANTIE / PROBLEEM MELDEN LINK (ALLEEN BINNEN 24 UUR NA AFGERONDE LES) */}
                              {isCompleted && (
                                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                                  <span className="text-[#B9BEC2] text-xs">Les afgerond</span>

                                  {slot?.ends_at && new Date().getTime() - new Date(slot.ends_at).getTime() <= 24 * 60 * 60 * 1000 && (
                                    <button
                                      type="button"
                                      onClick={() => openTrainerIssueReport(booking)}
                                      className="text-[#B9BEC2] hover:text-[#FF4B3E] transition text-right text-[11px] font-semibold"
                                    >
                                      Iets misgegaan met deze les? Meld binnen 24u →
                                    </button>
                                  )}
                                </div>
                              )}

                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}