"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import BookingIssueModal from "@/components/BookingIssueModal";
import { supabase } from "@/lib/supabase-browser";

type PlayerProfile = {
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

function getBookingTime(booking: PlayerBooking): number {
  const startsAt = booking.availability_slots?.starts_at;
  if (!startsAt) return Number.MAX_SAFE_INTEGER;
  return new Date(startsAt).getTime();
}

function isUpcomingConfirmedBooking(booking: PlayerBooking): boolean {
  const startsAt = booking.availability_slots?.starts_at;
  return (
    booking.status === "confirmed" &&
    Boolean(startsAt) &&
    new Date(startsAt as string).getTime() >= Date.now()
  );
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

function canReportBookingIssue(booking: PlayerBooking): boolean {
  return booking.status === "confirmed" || booking.status === "completed";
}

export default function MijnBoekingenPage() {
  const router = useRouter();
  const issueReportRef = useRef<HTMLDivElement | null>(null);

  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [bookings, setBookings] = useState<PlayerBooking[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>();
  const [payingBookingId, setPayingBookingId] = useState<string | null>();

  const [pendingCancellation, setPendingCancellation] = useState<PlayerBooking | null>();
  const [pendingIssueBooking, setPendingIssueBooking] = useState<PlayerBooking | null>();

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    void loadPlayerBookings();
  }, []);

  const bookingSections = useMemo((): BookingSection[] => {
    const pendingPayments = bookings
      .filter((booking) => booking.status === "payment_pending")
      .sort((a, b) => getBookingTime(a) - getBookingTime(b));

    const pendingRefunds = bookings
      .filter((booking) => booking.status === "refund_pending")
      .sort((a, b) => getBookingTime(a) - getBookingTime(b));

    const upcoming = bookings
      .filter(isUpcomingConfirmedBooking)
      .sort((a, b) => getBookingTime(a) - getBookingTime(b));

    const previous = bookings
      .filter(
        (booking) =>
          booking.status !== "payment_pending" &&
          booking.status !== "refund_pending" &&
          !isUpcomingConfirmedBooking(booking)
      )
      .sort((a, b) => getBookingTime(b) - getBookingTime(a));

    const sections: BookingSection[] = [];

    if (pendingPayments.length > 0) {
      sections.push({
        title: "BETALING NOG AFRONDEN",
        bookings: pendingPayments,
      });
    }

    if (pendingRefunds.length > 0) {
      sections.push({
        title: "TERUGBETALING WORDT VERWERKT",
        bookings: pendingRefunds,
      });
    }

    if (upcoming.length > 0) {
      sections.push({
        title: "VOLGENDE TRAINING",
        bookings: [upcoming[0]],
      });

      if (upcoming.length > 1) {
        sections.push({
          title: "AANKOMENDE TRAININGEN",
          bookings: upcoming.slice(1),
        });
      }
    }

    if (previous.length > 0) {
      sections.push({
        title: "EERDERE BOEKINGEN",
        bookings: previous,
      });
    }

    return sections;
  }, [bookings]);

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
      const { error: cleanupError } = await supabase.rpc(
        "release_expired_booking_holds"
      );

      if (cleanupError) {
        console.error("Verlopen reserveringen opruimen fout:", cleanupError.message);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/speler-login");
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        await supabase.auth.signOut();
        router.replace("/speler-login");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profileData) {
        await supabase.auth.signOut();
        router.replace("/speler-login");
        return;
      }

      const profile = profileData as PlayerProfile;

      if (profile.role !== "player") {
        await supabase.auth.signOut();
        router.replace("/speler-login");
        return;
      }

      setPlayerProfile(profile);

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
                name,
                city,
                address_line,
                postal_code
              )
            ),

            trainers (
              id,
              name,
              sport,
              focus,
              image_url,
              initials
            )
          `
        )
        .eq("player_id", user.id)
        .order("created_at", { ascending: false });

      if (bookingError) {
        console.error("Spelerboekingen ophalen fout:", bookingError.message);
        setBookings([]);
        showError("Je boekingen konden niet worden geladen. Probeer het opnieuw.");
        return;
      }

      setBookings((bookingData ?? []) as unknown as PlayerBooking[]);
    } catch (error) {
      console.error("Mijn boekingen laden fout:", error);
      setBookings([]);
      showError("Je boekingen konden niet worden geladen.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadPlayerBookings(false);
    setRefreshing(false);
  }

  async function handleCheckout(bookingId: string): Promise<void> {
    setPayingBookingId(bookingId);
    clearMessages();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/speler-login");
        return;
      }

      const response = await fetch("/api/stripe/checkout/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ bookingId }),
      });

      const result = (await response.json()) as {
        checkoutUrl?: string;
        error?: string;
      };

      if (!response.ok || !result.checkoutUrl) {
        console.error("Stripe Checkout fout:", result.error);
        showError(
          result.error ||
            "De betaalpagina kon niet worden geopend. Probeer het opnieuw."
        );
        return;
      }

      window.location.href = result.checkoutUrl;
    } catch (error) {
      console.error("Onverwachte Checkout-fout:", error);
      showError("De betaalpagina kon niet worden geopend. Probeer het opnieuw.");
    } finally {
      setPayingBookingId(null);
    }
  }

  function openCancellationConfirmation(booking: PlayerBooking): void {
    clearMessages();
    setPendingIssueBooking(null);
    setPendingCancellation(booking);
  }

  function closeCancellationConfirmation(): void {
    setPendingCancellation(null);
  }

  function openIssueReport(booking: PlayerBooking): void {
    clearMessages();
    setPendingCancellation(null);
    setPendingIssueBooking(booking);

    window.setTimeout(() => {
      issueReportRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      issueReportRef.current?.focus();
    }, 50);
  }

  function closeIssueReport(): void {
    setPendingIssueBooking(null);
  }

  function handleIssueSubmitted(): void {
    setPendingIssueBooking(null);
    setSuccessMessage(
      "Je melding is verstuurd naar GowTrain. We nemen zo snel mogelijk contact met je op."
    );
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
        console.error("Spelerannulering fout:", error.message);
        showError(error.message || "Je training kon niet worden geannuleerd.");
        return;
      }

      const result = (
        Array.isArray(data) ? data[0] : data
      ) as CancellationResult | null;

      if (!result) {
        showError("Je training kon niet worden geannuleerd.");
        return;
      }

      if (result.refund_required) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

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
          showError(
            refundResult.error ||
              "Je annulering is verwerkt, maar de terugbetaling kon niet direct worden gestart."
          );
          await loadPlayerBookings(false);
          return;
        }

        setSuccessMessage(
          `Je training is geannuleerd. ${formatEuro(
            result.refund_amount_cents,
            result.currency
          )} wordt terugbetaald via je oorspronkelijke betaalmethode.`
        );
      } else {
        setSuccessMessage(result.message);
      }

      setPendingCancellation(null);
      await loadPlayerBookings(false);
    } catch (error) {
      console.error("Onverwachte spelerannulering fout:", error);
      showError("Je training kon niet worden geannuleerd.");
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
    router.replace("/speler-login");
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
            BOEKINGEN LADEN...
          </p>
        </div>
      </main>
    );
  }

  const firstName =
    playerProfile?.full_name?.trim().split(" ")[0]?.toUpperCase() ?? "SPELER";

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
            <span
              aria-hidden="true"
              className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform group-hover:translate-x-1"
            />
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/trainers"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              VIND TRAINER →
            </Link>

            <button
              type="button"
              onClick={() => void handleLogout()}
              className="border-2 border-white px-4 py-2 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:text-[#14171A]"
            >
              UITLOGGEN
            </button>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-12 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">SPELER PORTAL</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                HÉ, {firstName}.<br />
                JOUW BOEKINGEN.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
                Overzicht van je geplande trainingen, betaalstatus en historie op de baan.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="border-2 border-white px-4 py-3 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>

              <Link
                href="/trainers"
                className="inline-flex items-center justify-center bg-[#FF4B3E] px-5 py-3 font-display text-sm text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A]"
              >
                BOEK TRAINING →
              </Link>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold leading-relaxed text-white"
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-5 font-semibold leading-relaxed text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]"
            >
              {successMessage}
            </div>
          )}

          {/* CONFIRMATION DIALOG VOOR ANNULEREN */}
          {pendingCancellation && (
            <section className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white sm:p-6 shadow-[8px_8px_0_0_#14171A]">
              <p className="font-display text-3xl">TRAINING ANNULEREN?</p>
              <p className="mt-3 max-w-2xl leading-relaxed text-white/90">
                {formatDate(pendingCancellation.availability_slots?.starts_at)} om{" "}
                {formatTime(pendingCancellation.availability_slots?.starts_at)} bij{" "}
                {pendingCancellation.trainers?.name || "je trainer"}.
              </p>

              {isTimelyCancellation(pendingCancellation) ? (
                <div className="mt-5 border-l-2 border-white pl-4">
                  <p className="font-display text-lg">JE ONTVANGT 100% TERUG</p>
                  <p className="mt-1 text-sm leading-relaxed text-white/90">
                    Je annuleert ruim 24 uur van tevoren.{" "}
                    {formatEuro(
                      pendingCancellation.total_price_cents,
                      pendingCancellation.currency
                    )}{" "}
                    wordt direct teruggestort.
                  </p>
                </div>
              ) : (
                <div className="mt-5 border-l-2 border-white pl-4">
                  <p className="font-display text-lg">GEEN TERUGBETALING MOGELIJK</p>
                  <p className="mt-1 text-sm leading-relaxed text-white/90">
                    Je annuleert binnen 24 uur voor de training. Omdat de baan en trainer gereserveerd staan, vervalt het recht op restitutie.
                  </p>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeCancellationConfirmation}
                  disabled={cancellingBookingId === pendingCancellation.id}
                  className="border-2 border-white px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  TERUG
                </button>

                <button
                  type="button"
                  disabled={cancellingBookingId === pendingCancellation.id}
                  onClick={() => void handleCancellation(pendingCancellation)}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {cancellingBookingId === pendingCancellation.id
                    ? "ANNULERING VERWERKEN..."
                    : "JA, ANNULEER TRAINING"}
                </button>
              </div>
            </section>
          )}

          {/* ISSUE REPORT MODAL */}
          {pendingIssueBooking && (
            <div
              ref={issueReportRef}
              id="booking-issue-report"
              tabIndex={-1}
              className="outline-none"
            >
              <BookingIssueModal
                bookingId={pendingIssueBooking.id}
                trainerName={pendingIssueBooking.trainers?.name || "je trainer"}
                trainingLabel={`${formatDate(
                  pendingIssueBooking.availability_slots?.starts_at
                )} · ${formatTime(
                  pendingIssueBooking.availability_slots?.starts_at
                )} – ${formatTime(
                  pendingIssueBooking.availability_slots?.ends_at
                )}`}
                onClose={closeIssueReport}
                onSubmitted={handleIssueSubmitted}
              />
            </div>
          )}

          {/* GEEN BOEKINGEN */}
          {!errorMessage && bookingSections.length === 0 && (
            <section className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-6 text-white sm:p-8">
                <p className="font-display text-4xl text-[#D6FF3F]">NOG GEEN BOEKINGEN.</p>
                <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#B9BEC2]">
                  Vind een trainer bij jou in de buurt, kies je tijdslot en sta vandaag nog op de baan.
                </p>
                <Link
                  href="/trainers"
                  className="mt-7 inline-flex bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
                >
                  VIND TRAINER. GOW! →
                </Link>
              </div>
            </section>
          )}

          {/* LIJST MET BOEKINGEN PER SECTIE */}
          {!errorMessage && bookingSections.length > 0 && (
            <div className="mt-10 space-y-12">
              {bookingSections.map((section) => (
                <section key={section.title}>
                  <p className="font-display text-lg text-[#FF4B3E]">{section.title}</p>

                  <div className="mt-4 grid gap-6 lg:grid-cols-2">
                    {section.bookings.map((booking) => {
                      const trainer = booking.trainers;
                      const slot = booking.availability_slots;
                      const canCancel = canPlayerCancel(booking);
                      const canReportIssue = canReportBookingIssue(booking);

                      const isNextUp = section.title === "VOLGENDE TRAINING";

                      return (
                        <article
                          key={booking.id}
                          className={`border-2 border-white bg-white p-3 text-[#14171A] transition ${
                            isNextUp
                              ? "shadow-[10px_10px_0_0_#D6FF3F]"
                              : "shadow-[6px_6px_0_0_#FF4B3E]"
                          }`}
                        >
                          <div className="bg-[#14171A] p-5 text-white">
                            
                            {/* TOP BAR BOEKING */}
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex min-w-0 items-center gap-4">
                                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A]">
                                  {trainer?.image_url ? (
                                    <img
                                      src={trainer.image_url}
                                      alt={`Profielfoto van ${trainer.name}`}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span className="font-display text-xl text-[#D6FF3F]">
                                      {getTrainerInitials(booking)}
                                    </span>
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <p className="font-display text-2xl leading-[0.9]">
                                    {trainer?.name || "TRAINER"}
                                  </p>
                                  {trainer && (
                                    <p className="mt-1 truncate text-xs text-[#B9BEC2]">
                                      {trainer.sport} · {trainer.focus}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <span
                                className={`shrink-0 px-3 py-1.5 font-display text-xs ${getStatusClass(
                                  booking.status
                                )}`}
                              >
                                {getStatusLabel(booking.status)}
                              </span>
                            </div>

                            {/* TIJD & PRIJS */}
                            <div className="mt-6 border-y border-white/20 py-4">
                              <div className="flex items-end justify-between gap-4">
                                <div>
                                  <p className="font-display text-lg text-[#D6FF3F]">
                                    {formatDate(slot?.starts_at)}
                                  </p>
                                  <p className="mt-1 font-display text-3xl">
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
                                  <p className="font-display text-[10px] text-[#8A8F94]">PRIJS</p>
                                  <p className="mt-1 font-display text-3xl text-[#D6FF3F]">
                                    {formatEuro(booking.total_price_cents, booking.currency)}
                                  </p>
                                  <p className="mt-0.5 font-display text-[10px] text-[#B9BEC2]">
                                    INCL. BAANHUUR
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* LOCATIE */}
                            {slot?.venue && (
                              <div className="mt-4">
                                <p className="font-display text-xs text-[#FF4B3E]">LOCATIE</p>
                                <p className="mt-1 font-display text-base leading-tight text-white">
                                  {getVenueLabel(slot.venue)}
                                </p>
                                <p className="mt-1 text-xs text-[#B9BEC2]">
                                  {slot.venue.address_line}, {slot.venue.city}
                                </p>
                              </div>
                            )}

                            {/* EXPLANATION */}
                            <div className="mt-5 border-l-2 border-[#D6FF3F] pl-4">
                              <p className="text-xs leading-relaxed text-[#D7D9DA]">
                                {getStatusExplanation(booking)}
                              </p>
                              {booking.status === "payment_pending" && booking.hold_expires_at && (
                                <p className="mt-1 text-xs font-bold text-[#FF4B3E]">
                                  ⏱️ Tijdelijke reservering tot {formatTime(booking.hold_expires_at)}.
                                </p>
                              )}
                            </div>

                            {/* DIRECTE BETAALKNOP MET STRIPE CHECKOUT INTEGRATIE */}
                            {booking.status === "payment_pending" && (
                              <button
                                type="button"
                                disabled={payingBookingId === booking.id}
                                onClick={() => void handleCheckout(booking.id)}
                                className="mt-6 flex w-full items-center justify-center gap-2 bg-[#D6FF3F] px-4 py-3.5 font-display text-lg !text-[#14171A] font-bold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {payingBookingId === booking.id
                                  ? "BETAALPAGINA OPENEN..."
                                  : "ROND BETALING AF. GOW! →"}
                              </button>
                            )}

                            {/* ANNULEERKNOP */}
                            {canCancel && (
                              <button
                                type="button"
                                disabled={
                                  cancellingBookingId === booking.id ||
                                  pendingCancellation?.id === booking.id
                                }
                                onClick={() => openCancellationConfirmation(booking)}
                                className="mt-5 w-full bg-[#FF4B3E] px-4 py-3.5 font-display text-sm text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                              >
                                LES ANNULEREN
                              </button>
                            )}

                            {/* PROBLEEM MELDEN */}
                            {canReportIssue && (
                              <button
                                type="button"
                                onClick={() => openIssueReport(booking)}
                                className="mt-3 w-full border-2 border-white/20 px-4 py-2.5 font-display text-xs text-[#B9BEC2] transition hover:border-[#FF4B3E] hover:text-[#FF4B3E]"
                              >
                                PROBLEEM MELDEN
                              </button>
                            )}

                            {trainer && (
                              <div className="mt-5 pt-2 border-t border-white/10 flex justify-between items-center">
                                <Link
                                  href={`/trainers/${trainer.id}`}
                                  className="font-display text-xs text-[#D6FF3F] transition hover:text-[#FF4B3E]"
                                >
                                  PROFIEL TRAINER →
                                </Link>
                              </div>
                            )}

                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}

              <div className="border-t-2 border-white/20 pt-8 text-center">
                <Link
                  href="/trainers"
                  className="inline-flex items-center gap-3 bg-[#FF4B3E] px-7 py-5 font-display text-xl text-white transition hover:-translate-y-1 hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                >
                  VIND EEN NIEUW MOMENT
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          )}

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}