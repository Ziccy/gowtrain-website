"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type SlotStatus = "available" | "held" | "booked" | "cancelled" | "completed";

type TrainerAccount = {
  id: string;
  is_active: boolean;
  approval_status: "pending" | "approved" | "rejected";
};

type VenueSummary = {
  id: string;
  name: string;
  city: string;
  address_line: string;
  postal_code: string | null;
};

type Slot = {
  id: string;
  starts_at: string;
  ends_at: string;
  sport: "padel" | "tennis";
  max_participants: number;
  price_cents: number;
  currency: string;
  status: SlotStatus;
  venue: VenueSummary | null;
};

type PendingCancel = Slot | null;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date(value))
    .toUpperCase();
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
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

function getStatusLabel(status: SlotStatus): string {
  switch (status) {
    case "available":
      return "BESCHIKBAAR";
    case "held":
      return "IN BETALING";
    case "booked":
      return "GEBOEKT";
    case "completed":
      return "AFGEROND";
    case "cancelled":
      return "GEANNULEERD";
  }
}

function getStatusClass(status: SlotStatus): string {
  if (status === "available") {
    return "bg-[#D6FF3F] text-[#14171A]";
  }
  if (status === "held") {
    return "bg-white text-[#14171A]";
  }
  if (status === "booked") {
    return "bg-[#FF4B3E] text-white";
  }
  return "bg-[#303438] text-white";
}

function getStatusExplanation(status: SlotStatus): string {
  switch (status) {
    case "held":
      return "Een speler is bezig met betalen. Dit slot is tijdelijk gereserveerd.";
    case "booked":
      return "Dit slot is definitief geboekt en betaald.";
    case "completed":
      return "Deze training is afgerond.";
    case "cancelled":
      return "Dit slot is geannuleerd.";
    default:
      return "";
  }
}

export default function TrainerSlotsPage() {
  const router = useRouter();
  const cancelConfirmationRef = useRef<HTMLElement | null>(null);

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [pendingCancel, setPendingCancel] = useState<PendingCancel>();
  const [updatingSlotId, setUpdatingSlotId] = useState<string | null>();

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    void loadSlots();
  }, []);

  const availableSlotsCount = useMemo(() => {
    return slots.filter((slot) => slot.status === "available").length;
  }, [slots]);

  const heldSlotsCount = useMemo(() => {
    return slots.filter((slot) => slot.status === "held").length;
  }, [slots]);

  const bookedSlotsCount = useMemo(() => {
    return slots.filter((slot) => slot.status === "booked").length;
  }, [slots]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function getCurrentTrainer(): Promise<TrainerAccount | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace("/trainer-login");
      return null;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      router.replace("/trainer-login");
      return null;
    }

    const { data: trainerData, error: trainerError } = await supabase
      .from("trainers")
      .select("id, is_active, approval_status")
      .eq("user_id", user.id)
      .single();

    if (trainerError || !trainerData) {
      console.error("Trainer ophalen fout:", trainerError?.message);
      showError("Je trainerprofiel kon niet worden geladen.");
      return null;
    }

    return trainerData as TrainerAccount;
  }

  async function loadSlots(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setErrorMessage("");

    try {
      const trainer = await getCurrentTrainer();
      if (!trainer) {
        setSlots([]);
        return;
      }

      setTrainerAccount(trainer);

      const { data, error } = await supabase
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
            status,
            venue:venues!availability_slots_location_id_fkey (
              id,
              name,
              city,
              address_line,
              postal_code
            )
          `
        )
        .eq("trainer_id", trainer.id)
        .in("status", ["available", "held", "booked"])
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true });

      if (error) {
        console.error("Slots ophalen fout:", error.message);
        showError("Je slots konden niet worden geladen.");
        setSlots([]);
        return;
      }

      setSlots((data ?? []) as unknown as Slot[]);
    } catch (error) {
      console.error("Onverwachte slots-fout:", error);
      showError("Je slots konden niet worden geladen.");
      setSlots([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadSlots(false);
    setRefreshing(false);
  }

  /* 💡 MET AUTOMATISCHE SMOOTH SCROLL NAAR DE MELDING */
  function openCancelConfirmation(slot: Slot): void {
    clearMessages();
    setPendingCancel(slot);

    window.setTimeout(() => {
      cancelConfirmationRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      cancelConfirmationRef.current?.focus();
    }, 50);
  }

  function closeCancelConfirmation(): void {
    setPendingCancel(null);
  }

  async function cancelSlot(slot: Slot): Promise<void> {
    if (slot.status !== "available") {
      showError("Alleen beschikbare slots kunnen worden geannuleerd.");
      setPendingCancel(null);
      return;
    }

    setUpdatingSlotId(slot.id);
    clearMessages();

    try {
      const { data: cancelledSlotId, error } = await supabase.rpc(
        "cancel_own_available_slot",
        { p_slot_id: slot.id }
      );

      if (error) {
        console.error("Slot annuleren fout:", error.message);
        showError("Dit slot kon niet worden geannuleerd.");
        return;
      }

      if (!cancelledSlotId) {
        showError("Dit slot is ondertussen gewijzigd of geboekt.");
        await loadSlots(false);
        return;
      }

      setPendingCancel(null);
      setSuccessMessage(
        `${formatDate(slot.starts_at)} · ${formatTime(slot.starts_at)} – ${formatTime(slot.ends_at)} is geannuleerd.`
      );

      await loadSlots(false);
    } catch (error) {
      console.error("Onverwachte annuleerfout:", error);
      showError("Dit slot kon niet worden geannuleerd.");
    } finally {
      setUpdatingSlotId(null);
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
            SLOTS LADEN...
          </p>
        </div>
      </main>
    );
  }

  const trainerIsActive =
    trainerAccount?.approval_status === "approved" &&
    trainerAccount.is_active === true;

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a
            href="/trainer-dashboard"
            aria-label="Terug naar trainerdashboard"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1 sm:border-b-[11px] sm:border-l-[9px] sm:border-t-[11px]" />
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/trainer-dashboard"
              className="hidden font-display text-sm text-white transition hover:text-[#D6FF3F] sm:block"
            >
              ← DASHBOARD
            </a>

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
          SLOT
        </div>

        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">BESCHIKBAARHEID</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                MIJN SLOTS.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
                Bekijk alle actieve en geplande tijdsloten. Spelers kunnen deze rechtstreeks boeken.
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

              <a
                href="/trainer-slot-toevoegen"
                className={`inline-flex items-center justify-center px-5 py-3 font-display text-sm transition ${
                  trainerIsActive
                    ? "bg-[#FF4B3E] text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    : "pointer-events-none bg-[#53595E] text-white/60"
                }`}
              >
                + NIEUW SLOT
              </a>
            </div>
          </div>

          {!trainerIsActive && (
            <div className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 text-white">
              <p className="font-display text-lg">JE PROFIEL IS NOG NIET ACTIEF</p>
              <p className="mt-2 leading-relaxed text-white/90">
                Je kunt slots toevoegen zodra je trainerprofiel is goedgekeurd.
              </p>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div role="status" className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              {successMessage}
            </div>
          )}

          {/* COUNTERS */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{availableSlotsCount}</p>
              <p className="mt-2 font-display text-base">BESCHIKBAAR</p>
            </div>

            <div className="border-2 border-white bg-white p-5 text-[#14171A]">
              <p className="font-display text-5xl">{heldSlotsCount}</p>
              <p className="mt-2 font-display text-base">IN BETALING</p>
            </div>

            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-5xl">{bookedSlotsCount}</p>
              <p className="mt-2 font-display text-base">GEBOEKT</p>
            </div>
          </div>

          {/* CONFIRMATION BANNER MET AUTOMATISCHE SCROLL */}
          {pendingCancel && (
            <section
              ref={cancelConfirmationRef}
              tabIndex={-1}
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none sm:p-6 shadow-[8px_8px_0_0_#14171A]"
            >
              <p className="font-display text-3xl">SLOT ANNULEREN?</p>
              <p className="mt-3 max-w-2xl leading-relaxed text-white/90">
                {formatDate(pendingCancel.starts_at)} · {formatTime(pendingCancel.starts_at)} – {formatTime(pendingCancel.ends_at)} bij {getVenueLabel(pendingCancel.venue)} wordt geannuleerd.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeCancelConfirmation}
                  className="border-2 border-white px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A]"
                >
                  TERUG
                </button>

                <button
                  type="button"
                  disabled={updatingSlotId === pendingCancel.id}
                  onClick={() => void cancelSlot(pendingCancel)}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {updatingSlotId === pendingCancel.id ? "ANNULEREN..." : "JA, ANNULEER SLOT"}
                </button>
              </div>
            </section>
          )}

          {/* GEEN SLOTS */}
          {slots.length === 0 ? (
            <section className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-6 text-white sm:p-8">
                <p className="font-display text-4xl text-[#D6FF3F]">GEEN TOEKOMSTIGE SLOTS.</p>
                <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#B9BEC2]">
                  Voeg een nieuw tijdslot toe of stel een vaste weekreeks in zodat spelers je kunnen boeken.
                </p>

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="/trainer-slot-toevoegen"
                    className={`inline-flex items-center justify-center px-6 py-4 font-display text-lg transition ${
                      trainerIsActive
                        ? "bg-[#FF4B3E] text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                        : "pointer-events-none bg-[#53595E] text-white/60"
                    }`}
                  >
                    NIEUW SLOT TOEVOEGEN →
                  </a>

                  <a
                    href="/trainer-beschikbaarheid"
                    className="inline-flex items-center justify-center border-2 border-white px-6 py-4 font-display text-lg !text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                  >
                    VASTE MOMENTEN →
                  </a>
                </div>
              </div>
            </section>
          ) : (
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {slots.map((slot) => {
                const canCancel = slot.status === "available";
                const isUpdating = updatingSlotId === slot.id;

                return (
                  <article
                    key={slot.id}
                    className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                  >
                    <div className="bg-[#14171A] p-5 text-white">
                      
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-display text-xl text-[#D6FF3F]">
                            {formatShortDate(slot.starts_at)}
                          </p>
                          <p className="mt-2 font-display text-4xl">
                            {formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 px-3 py-1.5 font-display text-xs ${getStatusClass(
                            slot.status
                          )}`}
                        >
                          {getStatusLabel(slot.status)}
                        </span>
                      </div>

                      <div className="mt-6 border-y border-white/20 py-4">
                        <div className="flex items-start justify-between gap-5">
                          <div>
                            <p className="font-display text-[10px] text-[#8A8F94]">SPORT</p>
                            <p className="mt-1 font-display text-xl text-white">
                              {slot.sport.toUpperCase()}
                            </p>
                            <p className="mt-1 text-xs text-[#B9BEC2]">
                              Max. {slot.max_participants} {slot.max_participants === 1 ? "speler" : "spelers"}
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="font-display text-[10px] text-[#8A8F94]">PRIJS PER LES</p>
                            <p className="mt-1 font-display text-2xl text-[#D6FF3F]">
                              {formatEuro(slot.price_cents, slot.currency)}
                            </p>
                            <p className="mt-0.5 text-xs text-[#B9BEC2]">Incl. baanhuur</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="font-display text-xs text-[#FF4B3E]">LOCATIE</p>
                        <p className="mt-1 font-display text-base text-white">
                          {getVenueLabel(slot.venue)}
                        </p>
                        {slot.venue && (
                          <p className="mt-0.5 text-xs text-[#B9BEC2]">
                            {slot.venue.address_line}, {slot.venue.city}
                          </p>
                        )}
                      </div>

                      {canCancel ? (
                        <div className="mt-6 grid gap-3 sm:grid-cols-2">
                          <a
                            href={`/trainer-slots/${slot.id}/wijzigen`}
                            className="flex items-center justify-center border-2 border-white px-4 py-3.5 font-display text-sm !text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                          >
                            WIJZIG SLOT
                          </a>

                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => openCancelConfirmation(slot)}
                            className="bg-[#FF4B3E] px-4 py-3.5 font-display text-sm text-white transition hover:bg-white hover:!text-[#14171A] disabled:opacity-60"
                          >
                            {isUpdating ? "ANNULEREN..." : "ANNULEER SLOT"}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-5 border-l-2 border-[#FF4B3E] pl-4">
                          <p className="text-xs text-[#B9BEC2]">
                            {getStatusExplanation(slot.status)}
                          </p>
                        </div>
                      )}

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