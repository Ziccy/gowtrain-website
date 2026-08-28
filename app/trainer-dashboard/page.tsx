"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import TrainerBookingIssueModal from "@/components/TrainerBookingIssueModal";
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

type Booking = {
  id: string;
  slot_id: string | null;
  player_name: string;
  player_email: string;
  participant_count: number;
  total_price_cents: number;
  currency: string;
  status: BookingStatus;
  created_at: string;
  hold_expires_at: string | null;
  cancellation_policy: string | null;
  availability_slots: BookingSlot;
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
  if (status === "confirmed") {
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

function canTrainerCancelBooking(booking: Booking): boolean {
  if (booking.status !== "confirmed") return false;
  const startsAt = booking.availability_slots?.starts_at;
  return Boolean(startsAt && new Date(startsAt).getTime() > Date.now());
}

function canTrainerReportIssue(booking: Booking): boolean {
  return booking.status === "confirmed" || booking.status === "completed";
}

export default function TrainerDashboardPage() {
  const router = useRouter();

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [availableSlotsCount, setAvailableSlotsCount] = useState(0);

  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingUpStripe, setSettingUpStripe] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);

  const [pendingTrainerCancellation, setPendingTrainerCancellation] = useState<Booking | null>();
  const [pendingTrainerIssueBooking, setPendingTrainerIssueBooking] = useState<Booking | null>();
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>();

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const trainerCancellationRef = useRef<HTMLElement | null>(null);
  const trainerIssueRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  const paymentPendingCount = useMemo(
    () => bookings.filter((booking) => booking.status === "payment_pending").length,
    [bookings]
  );

  const confirmedBookingsCount = useMemo(
    () => bookings.filter((booking) => booking.status === "confirmed").length,
    [bookings]
  );

  const stripeIsReady =
    trainerAccount?.stripe_details_submitted === true &&
    trainerAccount?.stripe_payouts_enabled === true;

  const stripeHasStarted = Boolean(trainerAccount?.stripe_account_id);

  const bookingSections = useMemo((): BookingSection[] => {
    const sortedBookings = [...bookings].sort(
      (first, second) => getBookingTime(first) - getBookingTime(second)
    );

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
        completed: "AFGERONDE TRAININGEN",
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
  }, [bookings, bookingFilter]);

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
      const { error: cleanupError } = await supabase.rpc("release_expired_booking_holds");

      if (cleanupError) {
        console.error("Verlopen reserveringen opruimen fout:", cleanupError.message);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/trainer-login");
        return;
      }

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
        .select(
          `
            id,
            name,
            is_active,
            approval_status,
            stripe_account_id,
            stripe_details_submitted,
            stripe_charges_enabled,
            stripe_payouts_enabled
          `
        )
        .eq("user_id", user.id)
        .single();

      if (trainerError || !trainerData) {
        console.error("Trainer ophalen fout:", trainerError?.message);
        setTrainerAccount(null);
        setBookings([]);
        setAvailableSlotsCount(0);
        setProfileMissing(true);
        return;
      }

      const trainer = trainerData as TrainerAccount;
      setTrainerAccount(trainer);

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
                id,
                name,
                city,
                address_line,
                postal_code
              )
            )
          `
        )
        .eq("trainer_id", trainer.id)
        .order("created_at", { ascending: false });

      if (bookingError) {
        console.error("Boekingen ophalen fout:", bookingError.message);
        setBookings([]);
        showError("Je boekingen konden niet worden geladen.");
      } else {
        setBookings((bookingData ?? []) as unknown as Booking[]);
      }

      const { count, error: countError } = await supabase
        .from("availability_slots")
        .select("id", { count: "exact", head: true })
        .eq("trainer_id", trainer.id)
        .eq("status", "available")
        .gte("starts_at", new Date().toISOString());

      if (countError) {
        console.error("Slots tellen fout:", countError.message);
        setAvailableSlotsCount(0);
      } else {
        setAvailableSlotsCount(count ?? 0);
      }
    } catch (error) {
      console.error("Dashboard laden fout:", error);
      showError("Je dashboard kon niet worden geladen. Probeer het opnieuw.");
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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/trainer-login");
        return;
      }

      const response = await fetch("/api/stripe/connect/onboarding", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const result = (await response.json()) as {
        onboardingUrl?: string;
        error?: string;
      };

      if (!response.ok || !result.onboardingUrl) {
        showError(
          result.error || "Uitbetalingen instellen lukt nu niet. Probeer het opnieuw."
        );
        return;
      }

      window.location.href = result.onboardingUrl;
    } catch (error) {
      console.error("Stripe onboarding fout:", error);
      showError("Uitbetalingen instellen lukt nu niet. Probeer het opnieuw.");
    } finally {
      setSettingUpStripe(false);
    }
  }

  function openTrainerCancellation(booking: Booking): void {
    clearMessages();
    setPendingTrainerIssueBooking(null);
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
    setPendingTrainerCancellation(null);
  }

  function openTrainerIssueReport(booking: Booking): void {
    clearMessages();
    setPendingTrainerCancellation(null);
    setPendingTrainerIssueBooking(booking);

    window.setTimeout(() => {
      trainerIssueRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      trainerIssueRef.current?.focus();
    }, 50);
  }

  function closeTrainerIssueReport(): void {
    setPendingTrainerIssueBooking(null);
  }

  function handleTrainerIssueSubmitted(): void {
    setPendingTrainerIssueBooking(null);
    setSuccessMessage(
      "Je melding is verstuurd naar GowTrain. We nemen zo snel mogelijk contact met je op."
    );
  }

  async function handleTrainerCancellation(booking: Booking): Promise<void> {
    if (!canTrainerCancelBooking(booking)) {
      showError("Deze training kan niet meer geannuleerd worden.");
      setPendingTrainerCancellation(null);
      return;
    }

    setCancellingBookingId(booking.id);
    clearMessages();

    try {
      const { data, error } = await supabase.rpc(
        "request_trainer_booking_cancellation",
        { p_booking_id: booking.id }
      );

      if (error) {
        showError(error.message || "De training kon niet worden geannuleerd.");
        return;
      }

      const result = (
        Array.isArray(data) ? data[0] : data
      ) as TrainerCancellationResult | null;

      if (!result) {
        showError("De training kon niet worden geannuleerd.");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/trainer-login");
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
        showError(
          refundResult.error ||
            "De annulering is opgeslagen, maar de terugbetaling kon niet direct worden verwerkt."
        );
        await loadDashboard(false);
        return;
      }

      setPendingTrainerCancellation(null);
      setSuccessMessage(
        `De training met ${booking.player_name} is geannuleerd. ${formatEuro(
          result.refund_amount_cents,
          result.currency
        )} is volledig terugbetaald aan de speler.`
      );

      await loadDashboard(false);
    } catch (error) {
      console.error("Trainerannulering fout:", error);
      showError("De training kon niet worden geannuleerd.");
    } finally {
      setCancellingBookingId(null);
    }
  }

  async function handleLogout(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showError("Uitloggen lukt nu niet.");
      return;
    }
    router.replace("/trainer-login");
    router.refresh();
  }

  /* BRANDBOOK BRANDED LOADER */
  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">
              GOWTRAIN
            </span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
            DASHBOARD LADEN...
          </p>
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
              <h1 className="mt-4 font-display text-5xl leading-[0.85]">
                JE ACCOUNT IS NOG NIET GEKOPPELD.
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                Je bent ingelogd, maar er is nog geen trainerprofiel gekoppeld aan dit e-mailadres.
              </p>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="mt-8 w-full bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white"
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
    trainerAccount?.approval_status !== "approved" ||
    trainerAccount?.is_active !== true
  ) {
    const isRejected = trainerAccount?.approval_status === "rejected";

    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">
                {isRejected ? "AANMELDING AFGEKEURD" : "WACHT OP GOEDKEURING"}
              </p>
              <h1 className="mt-4 font-display text-5xl leading-[0.85]">
                {isRejected
                  ? "JE PROFIEL IS NIET GOEDGEKEURD."
                  : "JE PROFIEL IS IN BEHANDELING."}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                {isRejected
                  ? "Neem contact op met GowTrain als je denkt dat dit een vergissing is."
                  : "We controleren je trainerprofiel. Je ontvangt bericht zodra je live kunt gaan."}
              </p>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="mt-8 w-full bg-[#FF4B3E] px-6 py-5 font-display text-xl text-white"
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

  const firstName = trainerAccount.name.trim().split(" ")[0] || "TRAINER";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link
            href="/"
            aria-label="Terug naar GowTrain home"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform group-hover:translate-x-1" />
          </Link>

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="border-2 border-white px-4 py-2 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]"
          >
            UITLOGGEN
          </button>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          {/* TOP BANNER */}
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">TRAINER DASHBOARD</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                HÉ, {firstName.toUpperCase()}.<br />
                KLAAR OM TE GOW!EN?
              </h1>
            </div>

            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="font-display text-base text-[#D6FF3F] transition hover:text-white disabled:opacity-60"
            >
              {refreshing ? "VERVERSEN..." : "↻ VERVERS DASHBOARD"}
            </button>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-5 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              {successMessage}
            </div>
          )}

          {/* STRIPE CONNECT CARD */}
          <section className="mt-8 border-2 border-white/25 bg-white/5">
            <div className="flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
              <div>
                <p className="font-display text-sm text-[#FF4B3E]">UITBETALINGEN & STRIPE</p>
                <h2 className="mt-1 font-display text-3xl">
                  {stripeIsReady
                    ? "STRIPE IS ACTIEF & GEKOPPELD"
                    : stripeHasStarted
                    ? "MAAK JE STRIPE GEGEVENS COMPLEET"
                    : "STEL JE UITBETALINGEN IN"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-[#B9BEC2]">
                  {stripeIsReady
                    ? "Je bankrekening is gekoppeld via Stripe. GowTrain kan je automatische uitbetalingen na elke les verwerken."
                    : "Koppel je bankrekening veilig via Stripe om uitbetalingen van geboekte lessen te ontvangen."}
                </p>
              </div>

              {stripeIsReady ? (
                <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] px-4 py-3 text-[#14171A]">
                  <p className="font-display text-lg">✓ ACTIEF</p>
                  <p className="font-display text-xs">STRIPE CONNECT</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStripeOnboarding()}
                  disabled={settingUpStripe}
                  className="bg-[#D6FF3F] px-6 py-4 font-display text-base text-[#14171A] transition hover:bg-white disabled:opacity-60"
                >
                  {settingUpStripe
                    ? "STRIPE OPENEN..."
                    : stripeHasStarted
                    ? "ONBOARDING AFRONDEN →"
                    : "KOPPEL STRIPE. GOW! →"}
                </button>
              )}
            </div>
          </section>

          {/* STATS COUNTERS */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{availableSlotsCount}</p>
              <p className="mt-2 font-display text-base">OPEN TIJDSLOTEN</p>
            </div>

            <div className="border-2 border-[#D6FF3F] bg-[#ffffff] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{paymentPendingCount}</p>
              <p className="mt-2 font-display text-base">IN BETALING (SPELERS)</p>
            </div>

            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-5xl">{confirmedBookingsCount}</p>
              <p className="mt-2 font-display text-base">BEVESTIGDE BOEKINGEN</p>
            </div>
          </div>

          {/* TRAINER CANCELLATION BOX */}
          {pendingTrainerCancellation && (
            <section
              ref={trainerCancellationRef}
              tabIndex={-1}
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none sm:p-6 shadow-[8px_8px_0_0_#14171A]"
            >
              <p className="font-display text-3xl">TRAINING ANNULEREN?</p>
              <p className="mt-3 max-w-2xl leading-relaxed text-white/90">
                Je annuleert de training met <strong>{pendingTrainerCancellation.player_name}</strong> op{" "}
                {formatDate(pendingTrainerCancellation.availability_slots?.starts_at)} om{" "}
                {formatTime(pendingTrainerCancellation.availability_slots?.starts_at)}.
              </p>

              <div className="mt-5 border-l-2 border-white pl-4">
                <p className="font-display text-lg">SPELER ONTVANGT 100% TERUG</p>
                <p className="mt-1 text-sm leading-relaxed text-white/90">
                  {formatEuro(
                    pendingTrainerCancellation.total_price_cents,
                    pendingTrainerCancellation.currency
                  )}{" "}
                  wordt automatisch teruggestort. Het tijdslot wordt daarna geannuleerd.
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeTrainerCancellation}
                  disabled={cancellingBookingId === pendingTrainerCancellation.id}
                  className="border-2 border-white px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  TERUG
                </button>

                <button
                  type="button"
                  onClick={() => void handleTrainerCancellation(pendingTrainerCancellation)}
                  disabled={cancellingBookingId === pendingTrainerCancellation.id}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {cancellingBookingId === pendingTrainerCancellation.id
                    ? "VERWERKEN..."
                    : "JA, ANNULEER LES"}
                </button>
              </div>
            </section>
          )}

          {/* ISSUE REPORT MODAL */}
          {pendingTrainerIssueBooking && (
            <div
              ref={trainerIssueRef}
              id="trainer-booking-issue-report"
              tabIndex={-1}
              className="outline-none"
            >
              <TrainerBookingIssueModal
                bookingId={pendingTrainerIssueBooking.id}
                playerName={pendingTrainerIssueBooking.player_name}
                trainingLabel={`${formatDate(
                  pendingTrainerIssueBooking.availability_slots?.starts_at
                )} · ${formatTime(
                  pendingTrainerIssueBooking.availability_slots?.starts_at
                )} – ${formatTime(
                  pendingTrainerIssueBooking.availability_slots?.ends_at
                )}`}
                onClose={closeTrainerIssueReport}
                onSubmitted={handleTrainerIssueSubmitted}
              />
            </div>
          )}

          {/* SNEL ACTIE GRID */}
          <div className="mt-12">
            <p className="font-display text-lg text-[#FF4B3E]">SNEL BEHEREN</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Link
                href="/trainer-slot-toevoegen"
                className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 !text-[#14171A] transition hover:-translate-y-1 shadow-[6px_6px_0_0_#FF4B3E]"
              >
                <p className="font-display text-3xl">+ NIEUW SLOT</p>
                <p className="mt-2 text-xs font-semibold">Zet een los moment open voor spelers.</p>
                <p className="mt-6 font-display text-sm text-[#FF4B3E]">TOEVOEGEN →</p>
              </Link>

              <Link
                href="/trainer-beschikbaarheid"
                className="border-2 border-white bg-white p-5 !text-[#14171A] transition hover:-translate-y-1 shadow-[6px_6px_0_0_#FF4B3E]"
              >
                <p className="font-display text-3xl">ROOSTER</p>
                <p className="mt-2 text-xs text-[#53595E]">Stel je wekelijkse vaste tijden in.</p>
                <p className="mt-6 font-display text-sm">BEHEREN →</p>
              </Link>

              <Link
                href="/trainer-slots"
                className="border-2 border-white bg-[#14171A] p-5 text-white transition hover:-translate-y-1 shadow-[6px_6px_0_0_#D6FF3F]"
              >
                <p className="font-display text-3xl text-[#D6FF3F]">MIJN SLOTS</p>
                <p className="mt-2 text-xs text-[#B9BEC2]">Bekijk en bewerk al je open slots.</p>
                <p className="mt-6 font-display text-sm text-[#D6FF3F]">BEKIJK SLOTS →</p>
              </Link>

              <Link
                href="/trainer-profiel-bewerken"
                className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white transition hover:-translate-y-1 shadow-[6px_6px_0_0_#D6FF3F]"
              >
                <p className="font-display text-3xl">PROFIEL</p>
                <p className="mt-2 text-xs text-white/90">Pas je uurtarief, bio en foto aan.</p>
                <p className="mt-6 font-display text-sm">BEWERKEN →</p>
              </Link>
            </div>
          </div>

          {/* OVERZICHT BOEKINGEN */}
          <div className="mt-14">
            <div className="flex flex-col justify-between gap-5 border-b-2 border-white/20 pb-5 sm:flex-row sm:items-end">
              <div>
                <p className="font-display text-lg text-[#FF4B3E]">JOUW AGENDA & BOEKINGEN</p>
                <h2 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl">OVERZICHT.</h2>
              </div>

              {/* FILTERS */}
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["ALLES", "all"],
                    ["IN BETALING", "payment_pending"],
                    ["BEVESTIGD", "confirmed"],
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
            </div>

            {bookingSections.length === 0 ? (
              <div className="mt-6 border-2 border-white/20 p-6 text-center">
                <p className="font-display text-3xl text-[#D6FF3F]">GEEN BOEKINGEN VOOR DIT FILTER.</p>
                <p className="mt-2 text-sm text-[#B9BEC2]">
                  Kies een ander filter of voeg meer tijdsloten toe aan je agenda.
                </p>
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
                        const canReportIssue = canTrainerReportIssue(booking);

                        return (
                          <article
                            key={booking.id}
                            className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                          >
                            <div className="bg-[#14171A] p-5 text-white">
                              
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="font-display text-2xl text-white">
                                    {booking.player_name}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-[#B9BEC2]">
                                    {booking.player_email}
                                  </p>
                                </div>

                                <span
                                  className={`shrink-0 px-3 py-1.5 font-display text-xs ${getStatusClass(
                                    booking.status
                                  )}`}
                                >
                                  {getStatusLabel(booking.status)}
                                </span>
                              </div>

                              <div className="mt-6 border-y border-white/20 py-4">
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <p className="font-display text-lg text-[#D6FF3F]">
                                      {formatDate(slot?.starts_at)}
                                    </p>
                                    <p className="mt-1 font-display text-2xl">
                                      {formatTime(slot?.starts_at)} – {formatTime(slot?.ends_at)}
                                    </p>
                                    {slot && (
                                      <p className="mt-1 font-display text-xs text-[#B9BEC2]">
                                        {slot.sport.toUpperCase()} · {booking.participant_count}{" "}
                                        {booking.participant_count === 1 ? "SPELER" : "SPELERS"}
                                      </p>
                                    )}
                                  </div>

                                  <div className="text-right">
                                    <p className="font-display text-[10px] text-[#8A8F94]">
                                      INVOEREN INKOMSTEN
                                    </p>
                                    <p className="mt-1 font-display text-3xl text-[#D6FF3F]">
                                      {formatEuro(
                                        booking.total_price_cents,
                                        booking.currency
                                      )}
                                    </p>
                                    <p className="mt-0.5 font-display text-[10px] text-[#B9BEC2]">
                                      INCL. BAANHUUR
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {slot?.venue && (
                                <div className="mt-4">
                                  <p className="font-display text-xs text-[#FF4B3E]">LOCATIE</p>
                                  <p className="mt-1 font-display text-base text-white">
                                    {getVenueLabel(slot.venue)}
                                  </p>
                                  <p className="mt-1 text-xs text-[#B9BEC2]">
                                    {slot.venue.address_line}, {slot.venue.city}
                                  </p>
                                </div>
                              )}

                              <div className="mt-4 border-l-2 border-[#D6FF3F] pl-4">
                                <p className="text-xs text-[#D7D9DA]">
                                  {getStatusExplanation(booking.status)}
                                </p>
                              </div>

                              {canCancel && (
                                <button
                                  type="button"
                                  disabled={
                                    cancellingBookingId === booking.id ||
                                    pendingTrainerCancellation?.id === booking.id
                                  }
                                  onClick={() => openTrainerCancellation(booking)}
                                  className="mt-6 w-full bg-[#FF4B3E] px-4 py-3.5 font-display text-sm text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                                >
                                  TRAINING ANNULEREN
                                </button>
                              )}

                              {canReportIssue && (
                                <button
                                  type="button"
                                  onClick={() => openTrainerIssueReport(booking)}
                                  className="mt-3 w-full border-2 border-white/20 px-4 py-2.5 font-display text-xs text-[#B9BEC2] transition hover:border-[#FF4B3E] hover:text-[#FF4B3E]"
                                >
                                  PROBLEEM MELDEN
                                </button>
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