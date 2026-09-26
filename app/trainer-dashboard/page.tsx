"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import BookingChatModal from "@/components/BookingChatModal";

import { supabase } from "@/lib/supabase-browser";
import { getBookingMessageStates } from "@/lib/booking-message-state";

/* TYPES */

type ApprovalStatus = "pending" | "approved" | "rejected";

type BookingStatus =
  | "payment_pending"
  | "confirmed"
  | "refund_pending"
  | "cancelled"
  | "refunded"
  | "completed";

type BookingFilter = "all" | BookingStatus;

type StripeCapabilityStatus =
  | "active"
  | "pending"
  | "restricted"
  | "unsupported";

type TrainerAccount = {
  id: string;
  name: string;
  is_active: boolean;
  approval_status: ApprovalStatus;
  stripe_account_id: string | null;
  stripe_account_api: "accounts_v1" | "accounts_v2" | null;
  stripe_account_livemode: boolean | null;
  stripe_account_closed: boolean | null;
  stripe_transfers_status: StripeCapabilityStatus | null;
  stripe_payouts_status: StripeCapabilityStatus | null;
  stripe_account_checked_at: string | null;
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
  paid_at: string | null;
  trainer_payout_status: string | null;
  stripe_transfer_id: string | null;
  trainer_paid_at: string | null;
  availability_slots: BookingSlot;
  chat_state?: MessageState;
};

type BookingSection = {
  title: string;
  bookings: Booking[];
};

/* CONSTANTEN */

const BOOKING_FILTERS: [string, BookingFilter][] = [
  ["ALLES", "all"],
  ["IN BETALING", "payment_pending"],
  ["BEVESTIGD", "confirmed"],
  ["AFGEROND", "completed"],
  ["REFUND", "refund_pending"],
  ["GEANNULEERD", "cancelled"],
];

const QUICK_LINKS = [
  {
    href: "/trainer-slot-toevoegen",
    title: "+ SLOT",
    description: "Zet een losse les open voor spelers.",
    action: "TOEVOEGEN →",
    cardClass:
      "border-[#D6FF3F] bg-[#D6FF3F] !text-[#14171A] shadow-[5px_5px_0_0_#FF4B3E]",
    descriptionClass: "text-[#14171A]",
    actionClass: "text-[#14171A]",
  },
  {
    href: "/trainer-pakket-toevoegen",
    title: "+ PAKKET",
    description: "Bied een compleet lestraject aan.",
    action: "AANMAKEN →",
    cardClass:
      "border-[#FF4B3E] bg-[#FF4B3E] !text-white shadow-[5px_5px_0_0_#D6FF3F]",
    descriptionClass: "text-white",
    actionClass: "text-white",
  },
  {
    href: "/trainer-beschikbaarheid",
    title: "ROOSTER",
    description: "Beheer je wekelijkse vaste momenten.",
    action: "BEHEREN →",
    cardClass:
      "border-white bg-white !text-[#14171A] shadow-[5px_5px_0_0_#FF4B3E]",
    descriptionClass: "text-[#53595E]",
    actionClass: "text-[#14171A]",
  },
  {
    href: "/trainer-slots",
    title: "AANBOD",
    description: "Bekijk je losse slots en lespakketten.",
    action: "BEKIJK ALLES →",
    cardClass:
      "border-white bg-[#14171A] !text-[#D6FF3F] shadow-[5px_5px_0_0_#D6FF3F]",
    descriptionClass: "text-[#B9BEC2]",
    actionClass: "text-[#D6FF3F]",
  },
] as const;

/* HELPERS */

function formatDate(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "GEEN DATUM";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  })
    .format(new Date(value))
    .toUpperCase();
}

function formatTime(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
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

  if (
    status === "payment_pending" ||
    status === "refund_pending"
  ) {
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
      return "De eindtijd is verstreken; deze les is administratief afgerond. Dit bevestigt geen trainertransfer en sluit een tijdige probleemmelding niet uit.";
  }
}

function getBookingTime(booking: Booking): number {
  const startsAt = booking.availability_slots?.starts_at;
  const timestamp = startsAt ? Date.parse(startsAt) : NaN;

  return Number.isFinite(timestamp)
    ? timestamp
    : Number.MAX_SAFE_INTEGER;
}

function getAmsterdamSlotDate(isoDate?: string): string {
  if (!isoDate || !Number.isFinite(Date.parse(isoDate))) {
    return "";
  }

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

  return Boolean(
    startsAt && Date.parse(startsAt) > Date.now()
  );
}

function stripeCapabilityLabel(
  status: StripeCapabilityStatus | null | undefined
): string {
  switch (status) {
    case "active":
      return "Actief";
    case "pending":
      return "In afwachting";
    case "restricted":
      return "Beperkt";
    case "unsupported":
      return "Niet ondersteund";
    default:
      return "Onbekend";
  }
}

/* PAGINA */

export default function TrainerDashboardPage() {
  const router = useRouter();

  const mountedRef = useRef(false);
  const dashboardLoadSequenceRef = useRef(0);
  const loadedUserIdRef = useRef("");

  const refreshBusyRef = useRef(false);
  const trainerCancelBusyRef = useRef(false);
  const stripeRequestBusyRef = useRef(false);

  const trainerCancellationRef = useRef<HTMLElement | null>(null);

  const [trainerAccount, setTrainerAccount] =
    useState<TrainerAccount | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [availableSlotsCount, setAvailableSlotsCount] = useState(0);

  const [bookingFilter, setBookingFilter] =
    useState<BookingFilter>("all");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);

  const [chatBooking, setChatBooking] = useState<Booking | null>(null);
  const [chatStatusError, setChatStatusError] = useState("");
  const [chatRefreshVersion, setChatRefreshVersion] = useState(0);

  const [stripeExpanded, setStripeExpanded] = useState(false);
  const [settingUpStripe, setSettingUpStripe] = useState(false);
  const [checkingStripeStatus, setCheckingStripeStatus] =
    useState(false);
  const [stripeError, setStripeError] = useState("");
  const [stripeSuccess, setStripeSuccess] = useState("");

  const [
    pendingTrainerCancellation,
    setPendingTrainerCancellation,
  ] = useState<Booking | null>(null);

  const [cancellingBookingId, setCancellingBookingId] =
    useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());

  /*
   * Normale opening:
   * alleen opgeslagen dashboardgegevens ophalen.
   *
   * Stripe-return:
   * blok openen en eenmaal de bestaande statusroute aanroepen.
   *
   * Uitgestelde start voorkomt een dubbele initialisatie
   * tijdens de development-effectcontrole van React.
   */
  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    async function initializeDashboard(): Promise<void> {
      const url = new URL(window.location.href);
      const returnedFromStripe =
        url.searchParams.get("stripe") === "return";

      if (returnedFromStripe) {
        setStripeExpanded(true);
        url.searchParams.delete("stripe");

        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`
        );
      }

      const loaded = await loadDashboard();

      if (active && returnedFromStripe && loaded) {
        await handleStripeStatusRefresh();
      }
    }

    const timer = window.setTimeout(() => {
      void initializeDashboard();
    }, 0);

    return () => {
      active = false;
      mountedRef.current = false;
      dashboardLoadSequenceRef.current += 1;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const timer = window.setInterval(updateClock, 10_000);

    window.addEventListener("focus", updateClock);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateClock);
    };
  }, []);

  /*
   * Alleen een veranderde verzameling boekingen moet
   * de gesprekkenlijst opnieuw configureren.
   */
  const chatBookingIdsKey = useMemo(
    () => JSON.stringify(bookings.map((booking) => booking.id).sort()),
    [bookings]
  );

  /*
   * Centrale berichtenstatus zonder localStorage.
   * Fouten wissen de laatst bekende badges niet.
   */
  useEffect(() => {
    if (!currentUserId) return;

    const bookingIds = JSON.parse(chatBookingIdsKey) as string[];

    if (bookingIds.length === 0) {
      setChatStatusError("");
      return;
    }

    let active = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refreshMessageStates(): Promise<void> {
      if (!active || busy) return;
      if (document.visibilityState !== "visible") return;

      busy = true;

      try {
        const states = await getBookingMessageStates(bookingIds);

        if (!active) return;

        setBookings((previous) =>
          previous.map((booking) => {
            const state = states.get(booking.id);

            if (!state) return booking;

            return {
              ...booking,
              chat_state: {
                has_messages: state.has_messages,
                has_unread_player_message: state.unread_count > 0,
                last_sender_role: state.last_sender_role,
              },
            };
          })
        );

        setChatStatusError("");
      } catch (error: unknown) {
        if (!active) return;

        setChatStatusError(
          error instanceof Error
            ? error.message
            : "De berichtenstatus kon niet worden geladen."
        );
      } finally {
        busy = false;
      }
    }

    async function poll(): Promise<void> {
      await refreshMessageStates();

      if (active) {
        timer = setTimeout(() => void poll(), 10_000);
      }
    }

    function handleReturn(): void {
      if (document.visibilityState === "visible") {
        void refreshMessageStates();
      }
    }

    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);

    void poll();

    return () => {
      active = false;

      if (timer !== undefined) clearTimeout(timer);

      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);
    };
  }, [currentUserId, chatBookingIdsKey, chatRefreshVersion]);

  /* AFGELEIDE GEGEVENS */

  const unreadBookings = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.chat_state?.has_unread_player_message
      ),
    [bookings]
  );

  const paymentPendingCount = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.status === "payment_pending"
      ).length,
    [bookings]
  );

  const confirmedBookingsCount = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.status === "confirmed"
      ).length,
    [bookings]
  );

  /*
   * Bestaande indicatieve dashboardberekening behouden.
   * Geen berekening van uitgevoerde bankuitbetalingen.
   */
  const thisMonthNetEarningsCents = useMemo(() => {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();

    let totalCents = 0;

    bookings.forEach((booking) => {
      if (
        booking.status === "confirmed" ||
        booking.status === "completed"
      ) {
        const startsAt = booking.availability_slots?.starts_at;
        const date = startsAt
          ? new Date(startsAt)
          : new Date(booking.created_at);

        if (
          date.getFullYear() === currentYear &&
          date.getMonth() === currentMonth
        ) {
          totalCents +=
            booking.trainer_net_amount_cents ||
            (
              booking.total_price_cents -
              (booking.commission_amount_cents || 0)
            );
        }
      }
    });

    return totalCents;
  }, [bookings]);

  const stripeHasStarted = Boolean(
    trainerAccount?.stripe_account_id
  );

  const stripeCheckedAt =
    trainerAccount?.stripe_account_checked_at;

  const stripeHasValidCheck = Boolean(
    stripeCheckedAt &&
    Number.isFinite(Date.parse(stripeCheckedAt))
  );

  // Opgeslagen v2-testcontext, geen actuele uitvoerautorisatie.
  const stripeHasVerifiedContext =
    stripeHasStarted &&
    trainerAccount?.stripe_account_api === "accounts_v2" &&
    trainerAccount?.stripe_account_livemode === false &&
    trainerAccount?.stripe_account_closed === false &&
    stripeHasValidCheck;

  const stripeCapabilitiesActive =
    stripeHasVerifiedContext &&
    trainerAccount?.stripe_transfers_status === "active" &&
    trainerAccount?.stripe_payouts_status === "active";

  const stripeLinkRequiresReview =
    stripeHasStarted && !stripeHasVerifiedContext;

  const stripeCheckedAtLabel =
    stripeHasValidCheck && stripeCheckedAt
      ? new Intl.DateTimeFormat("nl-NL", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Amsterdam",
        }).format(new Date(stripeCheckedAt))
      : null;

  const stripeSummaryLabel = stripeError
    ? "Laatste aanvraag niet bevestigd"
    : checkingStripeStatus
      ? "Status controleren..."
      : settingUpStripe
        ? "Onboarding openen..."
        : stripeLinkRequiresReview
          ? "Koppeling vereist controle"
          : stripeCapabilitiesActive
            ? "Capabilities actief bij laatste controle"
            : stripeHasStarted
              ? "Testaccount gekoppeld — controleer status"
              : "Nog geen testaccount gekoppeld";

  const bookingSections = useMemo((): BookingSection[] => {
    let sortedBookings = [...bookings].sort(
      (first, second) =>
        getBookingTime(first) - getBookingTime(second)
    );

    if (startDateFilter || endDateFilter) {
      sortedBookings = sortedBookings.filter((booking) => {
        const slotDate = getAmsterdamSlotDate(
          booking.availability_slots?.starts_at ||
          booking.created_at
        );

        if (startDateFilter && slotDate < startDateFilter) {
          return false;
        }

        if (endDateFilter && slotDate > endDateFilter) {
          return false;
        }

        return true;
      });
    }

    if (bookingFilter !== "all") {
      const filteredBookings = sortedBookings.filter(
        (booking) => booking.status === bookingFilter
      );

      const titles: Record<
        Exclude<BookingFilter, "all">,
        string
      > = {
        payment_pending: "IN BETALING",
        confirmed: "BEVESTIGDE BOEKINGEN",
        refund_pending: "REFUNDS IN VERWERKING",
        cancelled: "GEANNULEERDE BOEKINGEN",
        refunded: "TERUGBETAALDE BOEKINGEN",
        completed: "AFGEROND",
      };

      return filteredBookings.length
        ? [
            {
              title: titles[bookingFilter],
              bookings: filteredBookings,
            },
          ]
        : [];
    }

    const pendingPayments = sortedBookings.filter(
      (booking) => booking.status === "payment_pending"
    );

    const futureConfirmed = sortedBookings.filter(
      (booking) =>
        booking.status === "confirmed" &&
        getBookingTime(booking) >= now
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
  }, [
    bookings,
    bookingFilter,
    startDateFilter,
    endDateFilter,
    now,
  ]);

  /* MELDINGEN */

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  function showStripeError(message: string): void {
    setStripeExpanded(true);
    setStripeSuccess("");
    setStripeError(message);
  }

  /* DASHBOARD OPHALEN */

  async function loadDashboard(
    showLoading = true
  ): Promise<boolean> {
    const sequence = ++dashboardLoadSequenceRef.current;

    const isCurrent = () =>
      mountedRef.current &&
      sequence === dashboardLoadSequenceRef.current;

    if (!mountedRef.current) return false;

    if (showLoading) setLoading(true);

    setErrorMessage("");
    setProfileMissing(false);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!isCurrent()) return false;

      if (userError || !user) {
        router.replace("/trainer-login");
        return false;
      }

      const userChanged = loadedUserIdRef.current !== user.id;
      loadedUserIdRef.current = user.id;

      if (userChanged) {
        setBookings([]);
        setChatBooking(null);
        setChatStatusError("");
        setTrainerAccount(null);
        setAvailableSlotsCount(0);
        setPendingTrainerCancellation(null);
      }

      setCurrentUserId(user.id);

      // calendar_feed_token wordt bewust niet opgehaald.
      const { data: trainerData, error: trainerError } =
        await supabase
          .from("trainers")
          .select(`
            id,
            name,
            is_active,
            approval_status,
            stripe_account_id,
            stripe_account_api,
            stripe_account_livemode,
            stripe_account_closed,
            stripe_transfers_status,
            stripe_payouts_status,
            stripe_account_checked_at
          `)
          .eq("user_id", user.id)
          .maybeSingle();

      if (!isCurrent()) return false;

      if (trainerError) {
        throw new Error("Je trainerprofiel kon niet worden geladen.");
      }

      if (!trainerData) {
        setTrainerAccount(null);
        setBookings([]);
        setAvailableSlotsCount(0);
        setProfileMissing(true);
        return false;
      }

      const trainer = trainerData as TrainerAccount;
      setTrainerAccount(trainer);

      if (
        trainer.approval_status !== "approved" ||
        trainer.is_active !== true
      ) {
        setBookings([]);
        setChatBooking(null);
        setAvailableSlotsCount(0);
        return false;
      }

      const { data: bookingData, error: bookingError } =
        await supabase
          .from("bookings")
          .select(`
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
            paid_at,
            trainer_payout_status,
            stripe_transfer_id,
            trainer_paid_at,
            availability_slots (
              starts_at,
              ends_at,
              sport,
              venue:venues!availability_slots_location_id_fkey (
                id, name, city, address_line, postal_code
              )
            )
          `)
          .eq("trainer_id", trainer.id)
          .order("created_at", { ascending: false });

      if (!isCurrent()) return false;

      if (bookingError) {
        throw new Error("Je boekingen konden niet worden geladen.");
      }

      const rawBookings =
        (bookingData ?? []) as unknown as Booking[];

      /*
       * Chatstatus behouden bij gewone dashboardverversing.
       * Een aparte controle vernieuwt uitsluitend de badges.
       */
      setBookings((previous) => {
        const previousById = new Map(
          previous.map((booking) => [booking.id, booking])
        );

        return rawBookings.map((booking) => ({
          ...booking,
          chat_state: userChanged
            ? undefined
            : previousById.get(booking.id)?.chat_state,
        }));
      });

      setChatRefreshVersion((value) => value + 1);
      setNow(Date.now());

      const { count, error: slotsError } = await supabase
        .from("availability_slots")
        .select("id", { count: "exact", head: true })
        .eq("trainer_id", trainer.id)
        .eq("status", "available")
        .gte("starts_at", new Date().toISOString());

      if (!isCurrent()) return false;

      if (slotsError) {
        showError(
          "De boekingen zijn geladen, maar het aantal open tijdsloten kon niet worden vernieuwd."
        );
        return false;
      }

      setAvailableSlotsCount(count ?? 0);
      return true;
    } catch (error: unknown) {
      if (isCurrent()) {
        showError(
          error instanceof Error
            ? error.message
            : "Je dashboard kon niet worden geladen."
        );
      }

      return false;
    } finally {
      if (isCurrent() && showLoading) {
        setLoading(false);
      }
    }
  }

  async function handleRefresh(): Promise<void> {
    if (refreshBusyRef.current) return;

    refreshBusyRef.current = true;
    setRefreshing(true);
    clearMessages();

    try {
      await loadDashboard(false);
    } finally {
      refreshBusyRef.current = false;

      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }

  /* STRIPE */

  async function handleStripeStatusRefresh(): Promise<void> {
    if (stripeRequestBusyRef.current) return;

    stripeRequestBusyRef.current = true;
    setCheckingStripeStatus(true);
    setStripeExpanded(true);
    setStripeError("");
    setStripeSuccess("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mountedRef.current) return;

      if (!session?.access_token) {
        router.replace("/trainer-login");
        return;
      }

      const response = await fetch("/api/stripe/connect/status", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      const result = (await response.json()) as {
        statusChecked?: boolean;
        checkedAt?: string;
        error?: string;
      };

      if (!mountedRef.current) return;

      if (!response.ok) {
        showStripeError(
          result.error ||
            "De Stripe-status kon niet worden vernieuwd. De getoonde status kan verouderd zijn."
        );
        return;
      }

      if (
        result.statusChecked !== true ||
        typeof result.checkedAt !== "string" ||
        !Number.isFinite(Date.parse(result.checkedAt))
      ) {
        showStripeError(
          "Het resultaat van de Stripe-controle kon niet worden bevestigd. De getoonde status kan verouderd zijn."
        );
        return;
      }

      const loaded = await loadDashboard(false);

      if (!mountedRef.current) return;

      if (loaded) {
        setStripeSuccess(
          "Stripe-status gecontroleerd en opgeslagen gegevens vernieuwd."
        );
      } else {
        showStripeError(
          "De API heeft de Stripe-controle bevestigd, maar het dashboard kon niet volledig worden vernieuwd. Klik bovenaan op Ververs; start niet onnodig opnieuw de Stripe-controle."
        );
      }
    } catch {
      if (mountedRef.current) {
        showStripeError(
          "De verbinding tijdens de Stripe-controle is onderbroken. Controle en opslag kunnen al hebben plaatsgevonden. Er wordt niet automatisch opnieuw geprobeerd; de getoonde status kan verouderd zijn."
        );
      }
    } finally {
      stripeRequestBusyRef.current = false;

      if (mountedRef.current) {
        setCheckingStripeStatus(false);
      }
    }
  }

  async function handleStripeOnboarding(): Promise<void> {
    if (stripeRequestBusyRef.current) return;

    stripeRequestBusyRef.current = true;
    setSettingUpStripe(true);
    setStripeExpanded(true);
    setStripeError("");
    setStripeSuccess("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mountedRef.current) return;

      if (!session?.access_token) {
        router.replace("/trainer-login");
        return;
      }

      const response = await fetch(
        "/api/stripe/connect/onboarding",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const result = (await response.json()) as {
        onboardingUrl?: string;
        error?: string;
      };

      if (!mountedRef.current) return;

      if (!response.ok || !result.onboardingUrl) {
        showStripeError(
          result.error || "Uitbetalingen instellen lukt nu niet."
        );
        return;
      }

      // Alleen de bestaande Stripe-hosted onboarding openen.
      const onboardingUrl = new URL(result.onboardingUrl);

      if (
        onboardingUrl.protocol !== "https:" ||
        onboardingUrl.hostname !== "connect.stripe.com" ||
        onboardingUrl.port !== "" ||
        onboardingUrl.username !== "" ||
        onboardingUrl.password !== ""
      ) {
        showStripeError(
          "De ontvangen Stripe-link kon niet veilig worden gecontroleerd."
        );
        return;
      }

      window.location.href = onboardingUrl.href;
    } catch {
      if (mountedRef.current) {
        showStripeError(
          "De onboardingaanvraag kon niet worden bevestigd. Er wordt niet automatisch opnieuw geprobeerd. Controleer eerst de opgeslagen koppeling via Ververs."
        );
      }
    } finally {
      stripeRequestBusyRef.current = false;

      if (mountedRef.current) {
        setSettingUpStripe(false);
      }
    }
  }

  /* ANNULEREN */

  function openTrainerCancellation(booking: Booking): void {
    if (trainerCancelBusyRef.current) return;

    clearMessages();
    setPendingTrainerCancellation(booking);

    window.setTimeout(() => {
      trainerCancellationRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      trainerCancellationRef.current?.focus();
    }, 50);
  }

  function closeTrainerCancellation(): void {
    if (trainerCancelBusyRef.current) return;
    setPendingTrainerCancellation(null);
  }

  async function handleTrainerCancellation(
    booking: Booking
  ): Promise<void> {
    if (trainerCancelBusyRef.current) return;

    if (!canTrainerCancelBooking(booking)) {
      showError("Deze training kan niet meer geannuleerd worden.");
      setPendingTrainerCancellation(null);
      return;
    }

    trainerCancelBusyRef.current = true;
    setCancellingBookingId(booking.id);
    clearMessages();

    try {
      const { data, error } = await supabase.rpc(
        "request_trainer_lesson_cancellation",
        { p_booking_id: booking.id }
      );

      if (!mountedRef.current) return;

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
          "De annulering kon niet worden bevestigd. Vernieuw het overzicht voordat je opnieuw probeert."
        );
        return;
      }

      setPendingTrainerCancellation(null);
      await loadDashboard(false);

      if (mountedRef.current) {
        setSuccessMessage(result.message);
      }

      // Geen extra refund-API-call.
    } catch {
      if (mountedRef.current) {
        showError(
          "De verbinding is onderbroken. De annulering kan al geregistreerd zijn. Controleer eerst het overzicht."
        );
      }
    } finally {
      trainerCancelBusyRef.current = false;

      if (mountedRef.current) {
        setCancellingBookingId(null);
      }
    }
  }

  async function handleLogout(): Promise<void> {
    await supabase.auth.signOut();
    router.replace("/trainer-login");
    router.refresh();
  }

  /* LADEN EN ACCOUNTSTATUS */

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">
              GOWTRAIN
            </span>
            <span className="h-0 w-0 border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent motion-safe:animate-pulse" />
          </div>

          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
            DASHBOARD LADEN...
          </p>
        </div>
      </main>
    );
  }

  /*
   * Een laadfout niet presenteren als afkeuring
   * of ontbrekend trainerprofiel.
   */
  if (!trainerAccount && !profileMissing) {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <SiteHeader />

        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white/30 p-6">
            <h1 className="font-display text-3xl text-[#D6FF3F]">
              DASHBOARD NIET GELADEN
            </h1>

            <p role="alert" className="mt-4 text-sm text-[#B9BEC2]">
              {errorMessage || "Je account kon niet worden geladen."}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="min-h-11 bg-[#D6FF3F] px-5 py-3 font-display text-[#14171A] disabled:opacity-60"
              >
                {refreshing ? "LADEN..." : "OPNIEUW LADEN"}
              </button>

              <button
                type="button"
                onClick={() => void handleLogout()}
                className="min-h-11 border border-white/30 px-5 py-3 font-display"
              >
                UITLOGGEN
              </button>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    );
  }

  if (profileMissing) {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">
                TRAINERPROFIEL ONTBREEKT
              </p>

              <h1 className="mt-4 font-display text-5xl leading-tight">
                JE ACCOUNT IS NOG NIET GEKOPPELD.
              </h1>

              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                Je bent ingelogd, maar er is nog geen trainerprofiel
                gekoppeld aan dit e-mailadres.
              </p>

              <button
                type="button"
                onClick={() => void handleLogout()}
                className="mt-8 min-h-11 w-full bg-[#FF4B3E] px-6 py-4 font-display text-xl text-white"
              >
                UITLOGGEN
              </button>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    );
  }

  if (
    !trainerAccount ||
    trainerAccount.approval_status !== "approved" ||
    trainerAccount.is_active !== true
  ) {
    const isRejected =
      trainerAccount?.approval_status === "rejected";

    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">
                {isRejected
                  ? "AANMELDING AFGEKEURD"
                  : "WACHT OP GOEDKEURING"}
              </p>

              <h1 className="mt-4 font-display text-5xl leading-tight">
                {isRejected
                  ? "JE PROFIEL IS NIET GOEDGEKEURD."
                  : "JE PROFIEL IS IN BEHANDELING."}
              </h1>

              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                {isRejected
                  ? "Neem contact op met Gowtrain als je denkt dat dit een vergissing is."
                  : "We controleren je trainerprofiel. Je ontvangt bericht zodra je live kunt gaan."}
              </p>

              <button
                type="button"
                onClick={() => void handleLogout()}
                className="mt-8 min-h-11 w-full bg-[#FF4B3E] px-6 py-4 font-display text-xl text-white"
              >
                UITLOGGEN
              </button>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    );
  }

  const firstName =
    trainerAccount.name.trim().split(" ")[0] || "TRAINER";

  /* DASHBOARD */

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-8 sm:py-12">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          {/* TOPBANNER */}
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-7 lg:flex-row lg:items-end">
            <div className="min-w-0">
              <p className="font-display text-base text-[#FF4B3E]">
                TRAINER DASHBOARD
              </p>

              <h1 className="mt-3 break-words font-display text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
                HÉ, {firstName.toUpperCase()}.
                <br />
                KLAAR OM TE GOW!EN?
              </h1>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Link
                href="/trainer-profiel-bewerken"
                className="inline-flex min-h-11 items-center justify-center border-2 border-white px-4 py-3 font-display text-sm !text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                PROFIEL BEWERKEN
              </Link>

              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("boekingen-overzicht")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="min-h-11 border-2 border-white px-4 py-3 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]"
              >
                BOEKINGEN ↓
              </button>

              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing || cancellingBookingId !== null}
                className="min-h-11 px-2 font-display text-sm text-[#D6FF3F] transition hover:text-white disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          {/* ONGELEZEN BERICHTEN */}
          {unreadBookings.length > 0 && (
            <div
              role="status"
              className="mt-7 flex flex-col justify-between gap-4 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[5px_5px_0_0_#D6FF3F] sm:flex-row sm:items-center"
            >
              <div className="min-w-0">
                <p className="font-display text-2xl">
                  {unreadBookings.length}{" "}
                  {unreadBookings.length === 1
                    ? "TRAINING MET NIEUWE BERICHTEN"
                    : "TRAININGEN MET NIEUWE BERICHTEN"}
                </p>

                <p className="mt-1 text-sm leading-relaxed text-white/90">
                  {unreadBookings.length === 1
                    ? `${unreadBookings[0].player_name} heeft ongelezen berichten voor de training op ${formatDate(
                        unreadBookings[0].availability_slots?.starts_at
                      )}.`
                    : `Er zijn ongelezen berichten van spelers bij ${unreadBookings.length} trainingen.`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setChatBooking(unreadBookings[0])}
                className="inline-flex min-h-11 shrink-0 items-center justify-center bg-[#14171A] px-5 py-3 font-display text-base text-[#D6FF3F] transition hover:bg-white hover:text-[#14171A]"
              >
                OPEN BERICHT. GOW! →
              </button>
            </div>
          )}

          {chatStatusError && (
            <div
              role="status"
              className="mt-7 border-2 border-[#FF4B3E] p-4 text-sm text-[#D7D9DA]"
            >
              <p className="font-semibold text-[#FF4B3E]">
                BERICHTENSTATUS NIET ACTUEEL
              </p>
              <p className="mt-1">{chatStatusError}</p>
              <p className="mt-1 text-xs text-[#B9BEC2]">
                Eventuele badges tonen de laatst geladen status.
                Klik op Ververs om opnieuw te controleren.
              </p>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="mt-7 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white"
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="mt-7 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A]"
            >
              {successMessage}
            </div>
          )}

          {/* CHAT */}
          {chatBooking && (
            <BookingChatModal
              bookingId={chatBooking.id}
              recipientName={chatBooking.player_name}
              trainingLabel={`${
                chatBooking.availability_slots?.sport?.toUpperCase() ||
                "TRAINING"
              } · ${formatDate(
                chatBooking.availability_slots?.starts_at
              )} (${formatTime(
                chatBooking.availability_slots?.starts_at
              )} - ${formatTime(
                chatBooking.availability_slots?.ends_at
              )})`}
              venueLabel={
                chatBooking.availability_slots?.venue
                  ? getVenueLabel(chatBooking.availability_slots.venue)
                  : ""
              }
              currentUserRole="trainer"
              currentUserId={currentUserId}
              currentUserName={trainerAccount.name || "Trainer"}
              onClose={() => setChatBooking(null)}
              onMessagesRead={() =>
                setChatRefreshVersion((value) => value + 1)
              }
            />
          )}

          {/* STRIPE — STANDAARD INGEKLAPT */}
          <section className="mt-7 border border-white/20 bg-white/[0.02]">
            <h2>
              <button
                type="button"
                aria-expanded={stripeExpanded}
                aria-controls="trainer-stripe-panel"
                onClick={() => setStripeExpanded((value) => !value)}
                className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-white/[0.04] sm:px-5"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-base text-white">
                      STRIPE CONNECT
                    </span>
                    <span className="border border-white/20 px-2 py-0.5 font-display text-[10px] text-[#B9BEC2]">
                      TESTOMGEVING
                    </span>
                  </span>

                  <span
                    className={`mt-1 block text-xs ${
                      stripeError || stripeLinkRequiresReview
                        ? "text-[#FF4B3E]"
                        : "text-[#B9BEC2]"
                    }`}
                  >
                    {stripeSummaryLabel}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2 font-display text-xs text-[#B9BEC2]">
                  <span className="hidden sm:inline">
                    {stripeExpanded ? "INKLAPPEN" : "BEKIJKEN"}
                  </span>
                  <span aria-hidden="true" className="text-xl">
                    {stripeExpanded ? "−" : "+"}
                  </span>
                </span>
              </button>
            </h2>

            <div
              id="trainer-stripe-panel"
              hidden={!stripeExpanded}
              className="border-t border-white/15"
            >
              <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <div className="min-w-0 p-5 sm:p-6">
                  <h3 className="font-display text-xl text-white">
                    {stripeLinkRequiresReview
                      ? "STRIPE-KOPPELING VEREIST CONTROLE"
                      : stripeCapabilitiesActive
                        ? "STRIPE-CAPABILITIES ACTIEF"
                        : stripeHasStarted
                          ? "STRIPE-STATUS CONTROLEREN"
                          : "KOPPEL JE STRIPE-TESTACCOUNT"}
                  </h3>

                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#B9BEC2]">
                    {stripeLinkRequiresReview
                      ? "Deze bestaande koppeling is niet bevestigd als een open v2-testaccount. Er wordt vanuit dit dashboard geen vervangend account aangemaakt. Neem contact op met Gowtrain."
                      : stripeCapabilitiesActive
                        ? "Bij de laatst opgeslagen Stripe-controle waren transfers en bankpayouts actief. Dit bewijst geen uitgevoerde transfer of bankuitbetaling."
                        : stripeHasStarted
                          ? "De laatst opgeslagen controle bevestigt nog niet dat beide capabilities actief zijn. Stripe kan nog gegevens verwerken of aanvullende informatie vragen."
                          : "Open de beveiligde Stripe-hosted onboarding om je testaccount te koppelen. De onboarding opent buiten Gowtrain."}
                  </p>

                  {stripeHasVerifiedContext && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="border border-white/15 p-3">
                        <p className="text-xs text-[#B9BEC2]">
                          Transfers naar Stripe-account
                        </p>
                        <p className="mt-1 font-display text-base">
                          {stripeCapabilityLabel(
                            trainerAccount.stripe_transfers_status
                          )}
                        </p>
                      </div>

                      <div className="border border-white/15 p-3">
                        <p className="text-xs text-[#B9BEC2]">
                          Bankpayout-capability
                        </p>
                        <p className="mt-1 font-display text-base">
                          {stripeCapabilityLabel(
                            trainerAccount.stripe_payouts_status
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  {stripeCheckedAtLabel && (
                    <p className="mt-3 text-xs leading-relaxed text-[#B9BEC2]">
                      Laatste opgeslagen Stripe-controle:{" "}
                      {stripeCheckedAtLabel} (Amsterdam).
                    </p>
                  )}

                  <p className="mt-4 border-t border-white/15 pt-4 text-xs leading-relaxed text-[#B9BEC2]">
                    Automatische trainertransfers staan tijdens deze
                    testfase uit. Een transfer naar het Stripe-account
                    is niet hetzelfde als een uitbetaling naar de bank.
                  </p>
                </div>

                <div className="flex flex-col justify-center gap-3 border-t border-white/15 p-5 sm:p-6 lg:border-l lg:border-t-0">
                  {stripeHasVerifiedContext && (
                    <button
                      type="button"
                      onClick={() => void handleStripeStatusRefresh()}
                      disabled={checkingStripeStatus || settingUpStripe}
                      className="min-h-11 w-full border border-white/40 px-4 py-3 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
                    >
                      {checkingStripeStatus
                        ? "STRIPE-STATUS CONTROLEREN..."
                        : "STRIPE-STATUS VERNIEUWEN"}
                    </button>
                  )}

                  {!stripeLinkRequiresReview && (
                    <button
                      type="button"
                      onClick={() => void handleStripeOnboarding()}
                      disabled={settingUpStripe || checkingStripeStatus}
                      className="min-h-11 w-full border border-[#D6FF3F]/60 px-4 py-3 font-display text-sm text-[#D6FF3F] transition hover:bg-[#D6FF3F] hover:text-[#14171A] disabled:opacity-60"
                    >
                      {settingUpStripe
                        ? "STRIPE OPENEN..."
                        : stripeHasStarted
                          ? "BESTAANDE ONBOARDING OPENEN →"
                          : "KOPPEL STRIPE. GOW! →"}
                    </button>
                  )}

                  <details className="border-t border-white/15 pt-2">
                    <summary className="cursor-pointer py-3 font-display text-xs text-[#B9BEC2]">
                      HOE WERKT DE CONTROLE?
                    </summary>

                    <div className="space-y-3 pb-2 text-xs leading-relaxed text-[#B9BEC2]">
                      {stripeHasVerifiedContext && (
                        <p>
                          Opnieuw openen controleert eerst je bestaande
                          Stripe-account en opent daarna de Stripe-hosted
                          onboarding. Dit start geen transfer of
                          bankuitbetaling.
                        </p>
                      )}

                      <p>
                        ‘Ververs’ bovenaan leest alleen de opgeslagen
                        dashboardgegevens. ‘Stripe-status vernieuwen’
                        controleert je bestaande account bij Stripe,
                        zonder onboarding te openen.
                      </p>

                      <p>
                        Uitklappen start geen Stripe-aanvraag. Na
                        terugkeer uit de onboarding wordt de
                        statuscontrole eenmaal automatisch uitgevoerd.
                      </p>
                    </div>
                  </details>
                </div>
              </div>

              {stripeError && (
                <div
                  role="alert"
                  className="mx-5 mb-5 border border-[#FF4B3E]/60 bg-[#FF4B3E]/5 p-4 text-sm text-[#FF4B3E] sm:mx-6"
                >
                  {stripeError}
                </div>
              )}

              {stripeSuccess && (
                <div
                  role="status"
                  className="mx-5 mb-5 border border-[#D6FF3F]/40 p-4 text-sm text-[#D6FF3F] sm:mx-6"
                >
                  {stripeSuccess}
                </div>
              )}
            </div>
          </section>

          {/* COUNTERS */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]">
              <p className="font-display text-4xl sm:text-5xl">
                {availableSlotsCount}
              </p>
              <p className="mt-2 font-display text-sm">
                OPEN TIJDSLOTEN
              </p>
            </div>

            <div className="border-2 border-white bg-white p-5 text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]">
              <p className="font-display text-4xl sm:text-5xl">
                {paymentPendingCount}
              </p>
              <p className="mt-2 font-display text-sm">
                IN BETALING (SPELERS)
              </p>
            </div>

            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[4px_4px_0_0_#D6FF3F]">
              <p className="font-display text-4xl sm:text-5xl">
                {confirmedBookingsCount}
              </p>
              <p className="mt-2 font-display text-sm">
                BEVESTIGDE BOEKINGEN
              </p>
            </div>
          </div>

          {/* ANNULERINGSBEVESTIGING */}
          {pendingTrainerCancellation && (
            <section
              ref={trainerCancellationRef}
              tabIndex={-1}
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none shadow-[5px_5px_0_0_#14171A] sm:p-6"
            >
              <p className="font-display text-3xl">
                TRAINING ANNULEREN?
              </p>

              <p className="mt-3 max-w-2xl leading-relaxed text-white/90">
                Je annuleert de training met{" "}
                <strong>
                  {pendingTrainerCancellation.player_name}
                </strong>{" "}
                op{" "}
                {formatDate(
                  pendingTrainerCancellation.availability_slots?.starts_at
                )}{" "}
                om{" "}
                {formatTime(
                  pendingTrainerCancellation.availability_slots?.starts_at
                )}
                .
              </p>

              <div className="mt-5 border-l-2 border-white pl-4">
                <p className="font-display text-lg">
                  VOLLEDIG LESBEDRAG KLAARZETTEN VOOR REFUND
                </p>

                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/90">
                  Voor deze ene les wordt een refundopdracht van{" "}
                  {formatEuro(
                    pendingTrainerCancellation.total_price_cents,
                    pendingTrainerCancellation.currency
                  )}{" "}
                  geregistreerd. De speler ontvangt na succesvolle
                  verwerking een afzonderlijke bevestiging. Voor deze
                  les is geen trainersdeel verschuldigd en het slot
                  wordt niet opnieuw aangeboden.
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeTrainerCancellation}
                  disabled={cancellingBookingId !== null}
                  className="min-h-11 border-2 border-white px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  TERUG
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void handleTrainerCancellation(
                      pendingTrainerCancellation
                    )
                  }
                  disabled={cancellingBookingId !== null}
                  className="min-h-11 bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {cancellingBookingId === pendingTrainerCancellation.id
                    ? "VERWERKEN..."
                    : "JA, ANNULEER LES"}
                </button>
              </div>
            </section>
          )}

          {/* SNEL BEHEREN */}
          <section className="mt-10">
            <p className="font-display text-lg text-[#FF4B3E]">
              SNEL BEHEREN
            </p>

            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {QUICK_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-full flex-col border-2 p-5 transition hover:-translate-y-1 ${item.cardClass}`}
                >
                  <p className="font-display text-3xl">
                    {item.title}
                  </p>

                  <p
                    className={`mt-2 text-xs leading-relaxed ${item.descriptionClass}`}
                  >
                    {item.description}
                  </p>

                  <p
                    className={`mt-auto pt-6 font-display text-sm ${item.actionClass}`}
                  >
                    {item.action}
                  </p>
                </Link>
              ))}
            </div>
          </section>

          {/* FINANCIEEL OVERZICHT */}
          <section className="mt-10 flex flex-col justify-between gap-5 border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[5px_5px_0_0_#FF4B3E] sm:flex-row sm:items-center sm:p-6">
            <div>
              <p className="font-display text-xs">
                INDICATIEF TRAINERSDEEL DEZE MAAND — NIET UITBETAALD
              </p>
              <p className="mt-2 font-display text-4xl leading-none">
                {formatEuro(thisMonthNetEarningsCents)}
              </p>
            </div>

            <Link
              href="/trainer-inkomsten"
              className="inline-flex min-h-11 shrink-0 items-center justify-center bg-[#14171A] px-5 py-3 font-display text-sm !text-white transition hover:bg-white hover:!text-[#14171A]"
            >
              OPEN FINANCIEEL OVERZICHT →
            </Link>
          </section>

          {/* BOEKINGEN */}
          <section
            id="boekingen-overzicht"
            className="mt-12 scroll-mt-10"
          >
            <div className="border-b-2 border-white/20 pb-5">
              <p className="font-display text-lg text-[#FF4B3E]">
                JOUW AGENDA &amp; BOEKINGEN
              </p>

              <h2 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">
                OVERZICHT.
              </h2>

              <div className="mt-5 flex flex-wrap gap-2">
                {BOOKING_FILTERS.map(([label, value]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={bookingFilter === value}
                    onClick={() => setBookingFilter(value)}
                    className={`min-h-11 border-2 px-3 py-2 font-display text-xs transition ${
                      bookingFilter === value
                        ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                        : "border-white/30 text-white hover:border-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-display text-[10px] text-[#D6FF3F]">
                    VAN
                  </span>
                  <input
                    type="date"
                    value={startDateFilter}
                    onChange={(event) =>
                      setStartDateFilter(event.target.value)
                    }
                    className="min-h-11 border-2 border-white/30 bg-[#14171A] px-3 py-2 font-display text-xs text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-display text-[10px] text-[#D6FF3F]">
                    TOT
                  </span>
                  <input
                    type="date"
                    value={endDateFilter}
                    onChange={(event) =>
                      setEndDateFilter(event.target.value)
                    }
                    className="min-h-11 border-2 border-white/30 bg-[#14171A] px-3 py-2 font-display text-xs text-white outline-none [color-scheme:dark] focus:border-[#D6FF3F]"
                  />
                </label>

                {(startDateFilter || endDateFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setStartDateFilter("");
                      setEndDateFilter("");
                    }}
                    className="min-h-11 border border-[#FF4B3E] px-3 py-2 font-display text-xs text-[#FF4B3E] transition hover:bg-[#FF4B3E] hover:text-white"
                  >
                    RESET DATUMS
                  </button>
                )}
              </div>
            </div>

            {bookingSections.length === 0 ? (
              <div className="mt-6 border-2 border-white/20 p-6 text-center">
                <p className="font-display text-2xl text-[#D6FF3F]">
                  GEEN BOEKINGEN VOOR DIT FILTER.
                </p>
                <p className="mt-2 text-sm text-[#B9BEC2]">
                  Kies een ander filter of voeg meer tijdsloten toe.
                </p>
              </div>
            ) : (
              <div className="mt-7 space-y-10">
                {bookingSections.map((section) => (
                  <section key={section.title}>
                    <h3 className="font-display text-xl text-[#FF4B3E]">
                      {section.title}
                    </h3>

                    <div className="mt-4 grid gap-6 lg:grid-cols-2">
                      {section.bookings.map((booking) => {
                        const slot = booking.availability_slots;
                        const canCancel =
                          canTrainerCancelBooking(booking);
                        const chat = booking.chat_state;

                        return (
                          <article
                            key={booking.id}
                            className="h-full border-2 border-white bg-white p-2.5 text-[#14171A] shadow-[5px_5px_0_0_#FF4B3E]"
                          >
                            <div className="flex h-full flex-col bg-[#14171A] p-4 text-white sm:p-5">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="break-words font-display text-2xl">
                                    {booking.player_name}
                                  </p>

                                  <p className="mt-1 break-all text-xs text-[#B9BEC2]">
                                    {booking.player_email}
                                  </p>
                                </div>

                                <span
                                  className={`px-2.5 py-1.5 font-display text-[10px] ${getStatusClass(
                                    booking.status
                                  )}`}
                                >
                                  {getStatusLabel(booking.status)}
                                </span>
                              </div>

                              <div className="mt-5 border-y border-white/20 py-4">
                                <p className="font-display text-base text-[#D6FF3F]">
                                  {formatDate(slot?.starts_at)}
                                </p>

                                <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
                                  <div>
                                    <p className="font-display text-3xl">
                                      {formatTime(slot?.starts_at)} –{" "}
                                      {formatTime(slot?.ends_at)}
                                    </p>

                                    {slot && (
                                      <p className="mt-1 font-display text-xs text-[#B9BEC2]">
                                        {slot.sport.toUpperCase()} ·{" "}
                                        {booking.participant_count}{" "}
                                        {booking.participant_count === 1
                                          ? "SPELER"
                                          : "SPELERS"}
                                      </p>
                                    )}
                                  </div>

                                  <div>
                                    <p className="font-display text-[10px] text-[#8A8F94]">
                                      LESBEDRAG
                                    </p>
                                    <p className="font-display text-3xl text-[#D6FF3F]">
                                      {formatEuro(
                                        booking.total_price_cents,
                                        booking.currency
                                      )}
                                    </p>
                                    <p className="text-[10px] text-[#B9BEC2]">
                                      Niet je netto-uitbetaling
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {slot?.venue && (
                                <div className="mt-4">
                                  <p className="font-display text-xs text-[#FF4B3E]">
                                    LOCATIE
                                  </p>
                                  <p className="mt-1 font-display text-base">
                                    {getVenueLabel(slot.venue)}
                                  </p>
                                  <p className="mt-1 text-xs leading-relaxed text-[#B9BEC2]">
                                    {slot.venue.address_line},{" "}
                                    {slot.venue.city}
                                  </p>
                                </div>
                              )}

                              <div className="mt-4 border-l-2 border-[#D6FF3F] pl-3">
                                <p className="text-xs leading-relaxed text-[#D7D9DA]">
                                  {getStatusExplanation(booking.status)}
                                </p>
                              </div>

                              <div className="mt-auto space-y-3 pt-5">
                                {/*
                                 * Ook na afloop en annulering bereikbaar.
                                 * Versturen wordt afzonderlijk gecontroleerd.
                                 */}
                                <div>
  {chat?.has_messages && (
    <p className="mb-2 font-display text-[11px] tracking-wide text-[#B9BEC2]">
      AL EERDER GECHAT
    </p>
  )}

  <button
    type="button"
    onClick={() => setChatBooking(booking)}
    className={`inline-flex min-h-11 w-full items-center justify-center border-2 px-4 py-3 font-display text-sm transition ${
      chat?.has_unread_player_message
        ? "border-[#FF4B3E] bg-[#FF4B3E] !text-white motion-safe:animate-pulse"
        : chat?.has_messages
          ? "border-[#D6FF3F] bg-[#D6FF3F] !text-[#14171A] hover:border-white hover:bg-white"
          : "border-white/30 bg-transparent text-[#B9BEC2] hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
    }`}
  >
    {chat?.has_unread_player_message
      ? "NIEUW BERICHT VAN SPELER!"
      : chat?.has_messages
        ? "GESPREK BEKIJKEN"
        : "GESPREK OPENEN"}
  </button>
</div>

                                {canCancel && (
                                  <button
                                    type="button"
                                    disabled={
                                      cancellingBookingId !== null ||
                                      pendingTrainerCancellation?.id ===
                                        booking.id
                                    }
                                    onClick={() =>
                                      openTrainerCancellation(booking)
                                    }
                                    className="min-h-11 w-full bg-[#FF4B3E] px-4 py-3 font-display text-sm text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                                  >
                                    TRAINING ANNULEREN
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}