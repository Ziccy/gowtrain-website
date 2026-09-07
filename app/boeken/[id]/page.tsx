"use client";

import Link from "next/link";
import {
  useParams,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type PlayerProfile = {
  full_name: string | null;
  role: string;
};

type AuthenticatedPlayer = {
  id: string;
  email: string;
  fullName: string;
};

type Trainer = {
  id: string;
  initials: string;
  name: string;
  sport: string;
  focus: string;
  city: string | null;
  province: string | null;
  image_url: string | null;
};

type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address_line: string;
  postal_code: string | null;
};

type AvailabilitySlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  sport: "padel" | "tennis";
  max_participants: number;
  price_cents: number;
  currency: string;
  venue: VenueSummary | null;
};

type CreateBookingHoldResult = {
  booking_id: string;
  hold_expires_at: string;
  total_price_cents: number;
  currency: string;
  trainer_id: string;
};

type BookingHold = {
  bookingId: string;
  holdExpiresAt: string;
  totalPriceCents: number;
  currency: string;
};

type TimeOfDayFilter = "all" | "morning" | "afternoon" | "evening";

function getTrainerInitials(trainer: Trainer): string {
  if (trainer.initials?.trim()) {
    return trainer.initials.trim().toUpperCase();
  }

  const nameParts = trainer.name.trim().split(" ").filter(Boolean);

  if (nameParts.length === 0) return "GT";
  if (nameParts.length === 1) return nameParts[0].slice(0, 2).toUpperCase();

  return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(new Date(value))
    .toUpperCase();
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(value))
    .replace(".", "")
    .toUpperCase();
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
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

function getTrainerLocation(trainer: Trainer): string {
  if (trainer.city && trainer.province) {
    return `${trainer.city} · ${trainer.province}`;
  }
  if (trainer.city) return trainer.city;
  if (trainer.province) return trainer.province;
  return "Locatie volgt";
}

function getVenueLabel(venue: VenueSummary | null): string {
  if (!venue) return "LOCATIE VOLGT";
  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

function getFullVenueAddress(venue: VenueSummary | null): string {
  if (!venue) return "Locatie volgt";
  const postalAndCity = [venue.postal_code, venue.city].filter(Boolean).join(" ");
  return [venue.address_line, postalAndCity].filter(Boolean).join(", ");
}

function getRedirectPath(
  trainerId: string | undefined,
  slotId?: string | null
): string {
  if (!trainerId) return "/trainers";
  if (slotId) return `/boeken/${trainerId}?slot=${slotId}`;
  return `/boeken/${trainerId}`;
}

function getAmsterdamSlotData(isoDate: string): {
  date: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoDate));

  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = Number(getPart("hour"));
  const minute = Number(getPart("minute"));

  return {
    date: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute,
  };
}

function slotMatchesFilters(
  slot: AvailabilitySlot,
  startDate: string,
  endDate: string,
  timeOfDayFilter: TimeOfDayFilter
): boolean {
  const { date, minutes } = getAmsterdamSlotData(slot.starts_at);

  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;

  if (timeOfDayFilter === "morning") return minutes >= 8 * 60 && minutes < 12 * 60;
  if (timeOfDayFilter === "afternoon") return minutes >= 12 * 60 && minutes < 17 * 60;
  if (timeOfDayFilter === "evening") return minutes >= 17 * 60 && minutes < 23 * 60;

  return true;
}

function BoekenContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const trainerId = Array.isArray(params.id) ? params.id[0] : params.id;
  const requestedSlotId = searchParams.get("slot");

  const [player, setPlayer] = useState<AuthenticatedPlayer | null>();
  const [trainer, setTrainer] = useState<Trainer | null>();
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);

  // Filters
  const [selectedStartDate, setSelectedStartDate] = useState<string>("");
  const [selectedEndDate, setSelectedEndDate] = useState<string>("");
  const [timeOfDayFilter, setTimeOfDayFilter] = useState<TimeOfDayFilter>("all");

  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  const [participantCount, setParticipantCount] = useState<number>(1);

  const [bookingHold, setBookingHold] = useState<BookingHold | null>();
  const [reservedSlot, setReservedSlot] = useState<AvailabilitySlot | null>();
  const [reservedParticipantCount, setReservedParticipantCount] = useState<number>(1);

  const [loading, setLoading] = useState<boolean>(true);
  const [booking, setBooking] = useState<boolean>(false);
  const [openingCheckout, setOpeningCheckout] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    if (!trainerId) {
      setLoading(false);
      setErrorMessage("Deze trainer kon niet worden gevonden.");
      return;
    }

    void initializeBookingPage(trainerId);
  }, [trainerId]);

  const filteredSlots = useMemo((): AvailabilitySlot[] => {
    return slots.filter((slot) =>
      slotMatchesFilters(
        slot,
        selectedStartDate,
        selectedEndDate,
        timeOfDayFilter
      )
    );
  }, [slots, selectedStartDate, selectedEndDate, timeOfDayFilter]);

  const selectedSlot = useMemo((): AvailabilitySlot | null => {
    return slots.find((slot) => slot.id === selectedSlotId) ?? null;
  }, [slots, selectedSlotId]);

  const participantOptions = useMemo(() => {
    if (!selectedSlot) return [1];
    return Array.from(
      { length: selectedSlot.max_participants },
      (_, index) => index + 1
    );
  }, [selectedSlot]);

  const hasActiveFilters =
    selectedStartDate !== "" ||
    selectedEndDate !== "" ||
    timeOfDayFilter !== "all";

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function clearFilters(): void {
    setSelectedStartDate("");
    setSelectedEndDate("");
    setTimeOfDayFilter("all");
  }

  function handleStartDateChange(value: string): void {
    setSelectedStartDate(value);
    if (selectedEndDate && value && selectedEndDate < value) {
      setSelectedEndDate(value);
    }
  }

  function handleEndDateChange(value: string): void {
    setSelectedEndDate(value);
    if (selectedStartDate && value && value < selectedStartDate) {
      setSelectedStartDate(value);
    }
  }

  function redirectToPlayerLogin(): void {
    const redirectTo = getRedirectPath(trainerId, requestedSlotId);
    router.replace(
      `/speler-login?redirectTo=${encodeURIComponent(redirectTo)}`
    );
  }

  async function initializeBookingPage(selectedTrainerId: string): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        redirectToPlayerLogin();
        return;
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user || !user.email) {
        await supabase.auth.signOut();
        redirectToPlayerLogin();
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profileData) {
        await supabase.auth.signOut();
        redirectToPlayerLogin();
        return;
      }

      const profile = profileData as PlayerProfile;

      if (profile.role !== "player") {
        if (profile.role === "trainer") {
          router.replace("/trainer-dashboard");
          return;
        }
        await supabase.auth.signOut();
        redirectToPlayerLogin();
        return;
      }

      setPlayer({
        id: user.id,
        email: user.email,
        fullName: profile.full_name?.trim() || user.email.split("@")[0],
      });

      await loadTrainerAndSlots(selectedTrainerId);
    } catch {
      setErrorMessage("De boekingspagina kon niet worden geladen. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTrainerAndSlots(selectedTrainerId: string): Promise<void> {
    const { data: trainerData, error: trainerError } = await supabase
      .from("trainers")
      .select("id, initials, name, sport, focus, city, province, image_url")
      .eq("id", selectedTrainerId)
      .eq("is_active", true)
      .eq("approval_status", "approved")
      .single();

    if (trainerError || !trainerData) {
      setTrainer(null);
      setSlots([]);
      setErrorMessage("Deze trainer is niet gevonden of niet beschikbaar.");
      return;
    }

    setTrainer(trainerData as Trainer);

    const minBookingTime = new Date(
      Date.now() + 2 * 60 * 60 * 1000
    ).toISOString();

    const { data: slotData, error: slotError } = await supabase
      .from("availability_slots")
      .select(
        `
          id,
          starts_at,
          ends_at,
          sport,
          max_participants,
          price_cents,
          currency,
          venue:venues!availability_slots_location_id_fkey (
            id, name, city, address_line, postal_code
          )
        `
      )
      .eq("trainer_id", selectedTrainerId)
      .eq("status", "available")
      .gte("starts_at", minBookingTime)
      .order("starts_at", { ascending: true });

    if (slotError) {
      setSlots([]);
      setErrorMessage("De beschikbare momenten konden niet worden geladen.");
      return;
    }

    const availableSlots = (slotData ?? []) as unknown as AvailabilitySlot[];
    setSlots(availableSlots);

    if (requestedSlotId && availableSlots.some((slot) => slot.id === requestedSlotId)) {
      setSelectedSlotId(requestedSlotId);
    } else if (availableSlots.length > 0) {
      setSelectedSlotId(availableSlots[0].id);
    }
  }

  function selectSlot(slotId: string): void {
    clearMessages();
    setBookingHold(null);
    setReservedSlot(null);
    setSelectedSlotId(slotId);

    const slot = slots.find((item) => item.id === slotId);

    if (slot) {
      setParticipantCount((currentCount) =>
        currentCount > slot.max_participants ? 1 : currentCount
      );
    }
  }

  function selectParticipantCount(count: number): void {
    clearMessages();
    setParticipantCount(count);
  }

  async function handleBooking(): Promise<void> {
    clearMessages();

    if (!player) {
      redirectToPlayerLogin();
      return;
    }

    if (!trainer) {
      setErrorMessage("Deze trainer is niet beschikbaar.");
      return;
    }

    if (!selectedSlot) {
      setErrorMessage("Kies eerst een beschikbaar moment.");
      return;
    }

    setBooking(true);

    try {
      const { data, error } = await supabase.rpc("create_booking_hold", {
        p_slot_id: selectedSlot.id,
        p_participant_count: participantCount,
        p_player_name: player.fullName,
      });

      if (error) {
        setErrorMessage(
          error.message || "Dit moment kon niet tijdelijk worden gereserveerd. Kies een ander moment."
        );
        await loadTrainerAndSlots(trainer.id);
        return;
      }

      const result = (Array.isArray(data) ? data[0] : data) as CreateBookingHoldResult | null;

      if (!result?.booking_id || !result.hold_expires_at) {
        setErrorMessage("Je reservering kon niet worden aangemaakt. Probeer het opnieuw.");
        await loadTrainerAndSlots(trainer.id);
        return;
      }

      setBookingHold({
        bookingId: result.booking_id,
        holdExpiresAt: result.hold_expires_at,
        totalPriceCents: result.total_price_cents,
        currency: result.currency,
      });

      setReservedSlot(selectedSlot);
      setReservedParticipantCount(participantCount);

      setSuccessMessage(
        `Je training bij ${trainer.name} is tijdelijk voor je vastgehouden. Rond je betaling af om te bevestigen.`
      );

      setSlots((currentSlots) => currentSlots.filter((slot) => slot.id !== selectedSlot.id));
      setSelectedSlotId("");
    } catch {
      setErrorMessage("Dit moment kon niet tijdelijk worden gereserveerd.");
    } finally {
      setBooking(false);
    }
  }

  async function handleCheckout(): Promise<void> {
    if (!bookingHold) {
      setErrorMessage("Je reservering kon niet worden gevonden.");
      return;
    }

    setOpeningCheckout(true);
    clearMessages();

    try {
      window.location.href = `/boeken/checkout?bookingId=${bookingHold.bookingId}`;
    } catch {
      setErrorMessage("De betaalpagina kon niet worden geopend. Probeer het opnieuw.");
      setOpeningCheckout(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">MOMENTEN LADEN...</p>
        </div>
      </main>
    );
  }

  if (!trainer || errorMessage === "Deze trainer is niet gevonden of niet beschikbaar.") {
    return (
      <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
        <SiteHeader />
        <section className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-xl border-2 border-white bg-white p-3 text-[#14171A] shadow-[10px_10px_0_0_#FF4B3E]">
            <div className="bg-[#14171A] p-6 text-white sm:p-8">
              <p className="font-display text-lg text-[#FF4B3E]">TRAINER NIET BESCHIKBAAR</p>
              <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">DEZE MATCH IS EVEN WEG.</h1>
              <p className="mt-6 text-lg leading-relaxed text-[#B9BEC2]">
                {errorMessage || "Deze trainer is op dit moment niet beschikbaar."}
              </p>
              <Link
                href="/trainers"
                className="mt-8 inline-flex bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:text-[#14171A]"
              >
                NAAR ALLE TRAINERS →
              </Link>
            </div>
          </div>
        </section>
        <SiteFooter />
      </main>
    );
  }

  const hasReservedMoment = bookingHold && reservedSlot;

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* 💡 SLIMME, DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* MAIN CONTENT MET EXACTE MAX-W-7XL CONTAINER */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 select-none font-display text-[17rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[26rem] lg:text-[34rem]"
        >
          GOW
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          {/* TOP BANNER */}
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                {hasReservedMoment ? "BIJNA KLAAR" : "BOEK JE TRAINING"}
              </p>

              <h1 className="mt-2 font-display text-4xl leading-tight text-white sm:text-5xl lg:text-6xl">
                {hasReservedMoment
                  ? "JE MOMENT STAAT KLAAR. GOW!"
                  : "KIES JE MOMENT. GOW!"}
              </h1>

              <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                {hasReservedMoment
                  ? `Controleer je reservering bij ${trainer.name} hieronder en rond je betaling af.`
                  : `Kies een beschikbaar moment bij ${trainer.name}. Na je reservering houden we dit moment 30 minuten voor je vast.`}
              </p>
            </div>

            {/* TRAINER PROFIEL BADGE */}
            <div className="flex items-center gap-3 border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#14171A] bg-[#D6FF3F]">
                {trainer.image_url ? (
                  <img
                    src={trainer.image_url}
                    alt={trainer.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-display text-lg text-[#14171A]">
                    {getTrainerInitials(trainer)}
                  </span>
                )}
              </div>

              <div>
                <p className="font-display text-xl leading-none">{trainer.name}</p>
                <p className="mt-1 text-xs text-[#53595E]">
                  {trainer.sport} · {getTrainerLocation(trainer)}
                </p>
              </div>
            </div>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {/* BEVESTIGING VAN DE RESERVERING */}
          {successMessage && bookingHold ? (
            <section
              role="status"
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E] sm:p-7"
            >
              <p className="font-display text-3xl">MOMENT GERESERVEERD!</p>
              <p className="mt-2 max-w-3xl font-semibold leading-relaxed">
                {successMessage}
              </p>

              {reservedSlot && (
                <div className="mt-6 border-y-2 border-[#14171A]/20 py-5">
                  <p className="font-display text-xs text-[#14171A]/70 uppercase">
                    JOUW GERESERVEERDE TRAINING
                  </p>

                  <div className="mt-3 grid gap-5 sm:grid-cols-2">
                    <div>
                      <p className="font-display text-[11px] text-[#14171A]/65">TRAINER</p>
                      <p className="mt-1 font-display text-2xl">{trainer.name}</p>
                      <p className="mt-0.5 text-sm font-semibold">
                        {reservedSlot.sport.toUpperCase()} · {reservedParticipantCount} {reservedParticipantCount === 1 ? "SPELER" : "SPELERS"}
                      </p>
                    </div>

                    <div>
                      <p className="font-display text-[11px] text-[#14171A]/65">MOMENT</p>
                      <p className="mt-1 font-display text-2xl">{formatDate(reservedSlot.starts_at)}</p>
                      <p className="mt-0.5 text-sm font-semibold">
                        {formatTime(reservedSlot.starts_at)} – {formatTime(reservedSlot.ends_at)}
                      </p>
                    </div>

                    <div className="sm:col-span-2">
                      <p className="font-display text-[11px] text-[#14171A]/65">LOCATIE</p>
                      <p className="mt-1 font-display text-xl">{getVenueLabel(reservedSlot.venue)}</p>
                      <p className="mt-0.5 text-sm font-semibold">{getFullVenueAddress(reservedSlot.venue)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-5 border-b-2 border-[#14171A]/20 pb-5">
                <p className="font-display text-xs opacity-80 uppercase">TOTAALBEDRAG</p>
                <p className="mt-1 font-display text-4xl">
                  {formatEuro(bookingHold.totalPriceCents, bookingHold.currency)}
                </p>
                <p className="mt-1 text-xs font-semibold">Inclusief professionele training &amp; baanhuur.</p>
                <p className="mt-2 text-xs font-bold text-[#FF4B3E]">
                  ⏱️ Reservering verloopt om {formatTime(bookingHold.holdExpiresAt)}
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void handleCheckout()}
                  disabled={openingCheckout}
                  className="inline-flex items-center justify-center gap-3 bg-[#14171A] px-6 py-4 font-display text-lg !text-white hover:bg-white hover:!text-[#14171A] transition disabled:opacity-60"
                >
                  {openingCheckout ? "BETAALPAGINA OPENEN..." : "BETAAL NU. GOW! →"}
                </button>

                <Link
                  href={`/trainers/${trainer.id}`}
                  className="inline-flex items-center justify-center border-2 border-[#14171A] bg-transparent px-5 py-4 font-display text-base !text-[#14171A] transition hover:bg-[#14171A] hover:!text-white"
                >
                  TERUG NAAR TRAINER
                </Link>
              </div>
            </section>
          ) : null}

          {!bookingHold && (
            <div className="mt-10 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
              
              {/* STAP 1: KIES EEN MOMENT */}
              <section>
                <p className="font-display text-lg text-[#FF4B3E]">STAP 1 / 2</p>
                <h2 className="mt-1 font-display text-3xl text-white sm:text-4xl">
                  KIES JE MOMENT.
                </h2>

                {/* FILTERS */}
                {slots.length > 0 && (
                  <div className="mt-4 border-2 border-white bg-[#14171A] p-4 text-white">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <label htmlFor="booking-start-date" className="shrink-0 font-display text-xs text-[#D6FF3F]">
                          VAN:
                        </label>
                        <input
                          id="booking-start-date"
                          type="date"
                          value={selectedStartDate}
                          max={selectedEndDate || undefined}
                          onChange={(e) => handleStartDateChange(e.target.value)}
                          className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F] [color-scheme:dark]"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <label htmlFor="booking-end-date" className="shrink-0 font-display text-xs text-[#D6FF3F]">
                          TOT:
                        </label>
                        <input
                          id="booking-end-date"
                          type="date"
                          value={selectedEndDate}
                          min={selectedStartDate || undefined}
                          onChange={(e) => handleEndDateChange(e.target.value)}
                          className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F] [color-scheme:dark]"
                        />
                      </div>

                      <div className="flex items-center gap-2 sm:col-span-2">
                        <label htmlFor="booking-daypart" className="shrink-0 font-display text-xs text-[#D6FF3F]">
                          DAGDEEL:
                        </label>
                        <select
                          id="booking-daypart"
                          value={timeOfDayFilter}
                          onChange={(e) => setTimeOfDayFilter(e.target.value as TimeOfDayFilter)}
                          className="w-full border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F]"
                        >
                          <option value="all">ALLE DAGDELEN</option>
                          <option value="morning">OCHTEND (08:00 - 12:00)</option>
                          <option value="afternoon">MIDDAG (12:00 - 17:00)</option>
                          <option value="evening">AVOND (17:00 - 23:00)</option>
                        </select>
                      </div>
                    </div>

                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-3 font-display text-xs text-[#D6FF3F] transition hover:text-white"
                      >
                        × WIS FILTERS
                      </button>
                    )}
                  </div>
                )}

                {/* LIJST MET TIJDSLOTEN */}
                {filteredSlots.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    {filteredSlots.map((slot) => {
                      const isSelected = selectedSlotId === slot.id;

                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => selectSlot(slot.id)}
                          className={`w-full border-2 p-3 text-left transition select-none ${
                            isSelected
                              ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                              : "border-white bg-white text-[#14171A] hover:-translate-y-0.5 hover:border-[#D6FF3F]"
                          }`}
                        >
                          <div className="bg-[#14171A] p-4 text-white">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <span className="bg-[#D6FF3F] px-2.5 py-0.5 font-display text-xs text-[#14171A]">
                                  {formatShortDate(slot.starts_at)}
                                </span>
                                <p className="mt-2 font-display text-3xl">
                                  {formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}
                                </p>
                              </div>

                              <div className="text-right">
                                <p className="font-display text-2xl text-[#D6FF3F]">
                                  {formatEuro(slot.price_cents, slot.currency)}
                                </p>
                                <p className="mt-0.5 font-display text-[10px] text-[#B9BEC2]">
                                  INCL. BAANHUUR
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-2 border-t border-white/20 pt-3 sm:grid-cols-2">
                              <div>
                                <p className="font-display text-[10px] text-[#8A8F94]">SPORT</p>
                                <p className="mt-0.5 font-display text-xs text-white">
                                  {slot.sport.toUpperCase()} · Max. {slot.max_participants} spelers
                                </p>
                              </div>

                              <div>
                                <p className="font-display text-[10px] text-[#8A8F94]">LOCATIE</p>
                                <p className="mt-0.5 truncate font-display text-xs text-white">
                                  {getVenueLabel(slot.venue)}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between px-2 pt-2">
                            <span className="font-display text-xs">
                              {isSelected ? "✓ MOMENT GEKOZEN" : "SELECTEER DIT MOMENT"}
                            </span>
                            <span className="font-display text-base">→</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-5 border-2 border-white bg-[#14171A] p-6 text-center text-white">
                    <p className="font-display text-2xl text-[#D6FF3F]">GEEN MOMENTEN GEVONDEN.</p>
                    <p className="mt-2 text-xs text-[#B9BEC2]">
                      {slots.length > 0
                        ? "Er zijn geen tijdsloten die passen binnen je gekozen periode of dagdeel."
                        : "Deze trainer heeft momenteel geen open slots."}
                    </p>
                  </div>
                )}
              </section>

              {/* STAP 2: SAMENVATTING & BEVESTIGEN */}
              <section className="lg:sticky lg:top-8">
                <p className="font-display text-lg text-[#FF4B3E]">STAP 2 / 2</p>
                <h2 className="mt-1 font-display text-3xl text-white sm:text-4xl">
                  JOUW TRAINING.
                </h2>

                <div className="mt-4 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
                  <div className="bg-[#14171A] p-5 text-white sm:p-6">
                    
                    {selectedSlot ? (
                      <div className="border-l-2 border-[#D6FF3F] pl-4">
                        <p className="font-display text-xs text-[#D6FF3F]">GEKOZEN MOMENT</p>
                        <p className="mt-1 font-display text-xl">{formatDate(selectedSlot.starts_at)}</p>
                        <p className="mt-0.5 text-xs text-[#D7D9DA]">
                          {formatTime(selectedSlot.starts_at)} – {formatTime(selectedSlot.ends_at)}
                        </p>

                        <p className="mt-3 font-display text-3xl text-[#D6FF3F]">
                          {formatEuro(selectedSlot.price_cents, selectedSlot.currency)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#B9BEC2]">Inclusief training en baanhuur.</p>
                      </div>
                    ) : (
                      <div className="border-l-2 border-[#FF4B3E] pl-4">
                        <p className="font-display text-xs text-[#FF4B3E]">KIES EERST EEN MOMENT</p>
                        <p className="mt-1 text-xs text-[#B9BEC2]">Klik links op een beschikbaar tijdstip om verder te gaan.</p>
                      </div>
                    )}

                    <div className="mt-5 border-y border-white/20 py-4">
                      <p className="font-display text-xs text-[#FF4B3E]">AANTAL SPELERS</p>
                      <p className="mt-0.5 text-[11px] text-[#B9BEC2]">Jij reserveert het hele moment.</p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {participantOptions.map((count) => (
                          <button
                            key={count}
                            type="button"
                            disabled={!selectedSlot || booking}
                            onClick={() => selectParticipantCount(count)}
                            className={`border-2 px-4 py-2 font-display text-xs transition disabled:opacity-40 ${
                              participantCount === count
                                ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                                : "border-white/30 text-white hover:border-white"
                            }`}
                          >
                            {count} {count === 1 ? "SPELER" : "SPELERS"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="font-display text-xs text-[#FF4B3E]">SPELER</p>
                      <p className="mt-1 font-display text-lg text-white">{player?.fullName || "SPELER"}</p>
                      <p className="text-xs text-[#B9BEC2]">{player?.email}</p>
                    </div>

                    {selectedSlot?.venue && (
                      <div className="mt-4 border-t border-white/20 pt-4">
                        <p className="font-display text-xs text-[#FF4B3E]">LOCATIE</p>
                        <p className="mt-1 font-display text-sm text-white">{getVenueLabel(selectedSlot.venue)}</p>
                        <p className="mt-0.5 text-xs text-[#B9BEC2]">{getFullVenueAddress(selectedSlot.venue)}</p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleBooking()}
                      disabled={booking || !selectedSlot || slots.length === 0}
                      className="mt-6 flex w-full items-center justify-center gap-2 bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white transition hover:bg-[#D6FF3F] hover:!text-[#14171A] disabled:opacity-60"
                    >
                      {booking ? "RESERVEREN..." : "RESERVEER MOMENT. GOW! →"}
                    </button>

                    <p className="mt-3 text-center text-[11px] text-[#8A8F94]">
                      Na reservering wordt dit tijdslot 30 minuten voor je vastgehouden om te betalen.
                    </p>

                  </div>
                </div>
              </section>

            </div>
          )}

        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function BoekenFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2">
          <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
          <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
        </div>
        <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">BOEKING LADEN...</p>
      </div>
    </main>
  );
}

export default function BoekenPage() {
  return (
    <Suspense fallback={<BoekenFallback />}>
      <BoekenContent />
    </Suspense>
  );
}