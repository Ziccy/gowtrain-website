"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type SlotStatus = "available" | "held" | "booked" | "cancelled" | "completed";
type ViewTab = "slots" | "packages";

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

type TrainerPackageItem = {
  id: string;
  title: string;
  sport: "padel" | "tennis";
  lesson_count: number;
  duration_minutes: number;
  starts_at: string;
  price_cents: number;
  currency: string;
  max_participants: number;
  is_active: boolean;
  venue: VenueSummary | null;
};

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
  if (status === "available") return "bg-[#D6FF3F] text-[#14171A]";
  if (status === "held") return "bg-white text-[#14171A]";
  if (status === "booked") return "bg-[#FF4B3E] text-white";
  return "bg-[#303438] text-white";
}

export default function TrainerSlotsPage() {
  const router = useRouter();
  const cancelConfirmationRef = useRef<HTMLElement | null>(null);

  const [activeTab, setActiveTab] = useState<ViewTab>("slots");

  // FILTERS STATE
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  const [trainerAccount, setTrainerAccount] = useState<TrainerAccount | null>();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [packages, setPackages] = useState<TrainerPackageItem[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [pendingCancelSlot, setPendingCancelSlot] = useState<Slot | null>();
  const [pendingCancelPackage, setPendingCancelPackage] = useState<TrainerPackageItem | null>();
  const [updatingId, setUpdatingId] = useState<string | null>();

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    void loadData();
  }, []);

  const availableSlotsCount = useMemo(
    () => slots.filter((slot) => slot.status === "available").length,
    [slots]
  );
  const heldSlotsCount = useMemo(
    () => slots.filter((slot) => slot.status === "held").length,
    [slots]
  );
  const bookedSlotsCount = useMemo(
    () => slots.filter((slot) => slot.status === "booked").length,
    [slots]
  );

  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    const currentList = activeTab === "slots" ? slots : packages;
    currentList.forEach((item) => {
      if (item.starts_at) {
        const date = new Date(item.starts_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        months.add(key);
      }
    });
    return Array.from(months).sort();
  }, [slots, packages, activeTab]);

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) {
        return false;
      }
      if (selectedMonth !== "all") {
        const date = new Date(s.starts_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (key !== selectedMonth) return false;
      }
      return true;
    });
  }, [slots, statusFilter, selectedMonth]);

  const filteredPackages = useMemo(() => {
    return packages.filter((p) => {
      if (statusFilter === "available" && !p.is_active) return false;
      if (statusFilter === "booked" && p.is_active) return false;

      if (selectedMonth !== "all") {
        const date = new Date(p.starts_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (key !== selectedMonth) return false;
      }
      return true;
    });
  }, [packages, statusFilter, selectedMonth]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function getCurrentTrainer(): Promise<TrainerAccount | null> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace("/trainer-login");
      return null;
    }

    const { data: trainerData, error: trainerError } = await supabase
      .from("trainers")
      .select("id, is_active, approval_status")
      .eq("user_id", session.user.id)
      .single();

    if (trainerError || !trainerData) {
      showError("Je trainerprofiel kon niet worden geladen.");
      return null;
    }

    return trainerData as TrainerAccount;
  }

  async function loadData(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setErrorMessage("");

    try {
      const trainer = await getCurrentTrainer();
      if (!trainer) return;

      setTrainerAccount(trainer);

      // 1. Losse slots ophalen
      const { data: slotData } = await supabase
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
              id, name, city, address_line, postal_code
            )
          `
        )
        .eq("trainer_id", trainer.id)
        .in("status", ["available", "held", "booked"])
        .gte("starts_at", new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString())
        .order("starts_at", { ascending: true });

      setSlots((slotData ?? []) as unknown as Slot[]);

      // 2. Lespakketten ophalen
      const { data: packageData } = await supabase
        .from("trainer_packages")
        .select(
          `
            id,
            title,
            sport,
            lesson_count,
            duration_minutes,
            starts_at,
            price_cents,
            currency,
            max_participants,
            is_active,
            venue:venues!trainer_packages_location_id_fkey (
              id, name, city, address_line, postal_code
            )
          `
        )
        .eq("trainer_id", trainer.id)
        .order("created_at", { ascending: false });

      setPackages((packageData ?? []) as unknown as TrainerPackageItem[]);
    } catch {
      showError("De gegevens konden niet worden geladen.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadData(false);
    setRefreshing(false);
  }

  function openSlotCancelConfirmation(slot: Slot): void {
    clearMessages();
    setPendingCancelPackage(null);
    setPendingCancelSlot(slot);

    window.setTimeout(() => {
      cancelConfirmationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      cancelConfirmationRef.current?.focus();
    }, 50);
  }

  function openPackageCancelConfirmation(pkg: TrainerPackageItem): void {
    clearMessages();
    setPendingCancelSlot(null);
    setPendingCancelPackage(pkg);

    window.setTimeout(() => {
      cancelConfirmationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      cancelConfirmationRef.current?.focus();
    }, 50);
  }

  function closeCancelConfirmation(): void {
    setPendingCancelSlot(null);
    setPendingCancelPackage(null);
  }

  async function cancelSlot(slot: Slot): Promise<void> {
    if (slot.status !== "available") {
      showError("Alleen beschikbare slots kunnen worden geannuleerd.");
      setPendingCancelSlot(null);
      return;
    }

    setUpdatingId(slot.id);
    clearMessages();

    try {
      const { data: cancelledSlotId, error } = await supabase.rpc(
        "cancel_own_available_slot",
        { p_slot_id: slot.id }
      );

      if (error || !cancelledSlotId) {
        showError("Dit slot kon niet worden geannuleerd.");
        return;
      }

      setPendingCancelSlot(null);
      setSuccessMessage(`${formatDate(slot.starts_at)} om ${formatTime(slot.starts_at)} uur is geannuleerd.`);
      await loadData(false);
    } catch {
      showError("Dit slot kon niet worden geannuleerd.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function cancelPackage(pkg: TrainerPackageItem): Promise<void> {
    setUpdatingId(pkg.id);
    clearMessages();

    try {
      const { error } = await supabase
        .from("trainer_packages")
        .delete()
        .eq("id", pkg.id);

      if (error) {
        showError("Het lespakket kon niet worden geannuleerd.");
        return;
      }

      setPendingCancelPackage(null);
      setSuccessMessage(`Lespakket '${pkg.title}' is geannuleerd en verwijderd van je profiel.`);
      await loadData(false);
    } catch {
      showError("Het lespakket kon niet worden geannuleerd.");
    } finally {
      setUpdatingId(null);
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
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">SLOTS LADEN...</p>
        </div>
      </main>
    );
  }

  const trainerIsActive = trainerAccount?.approval_status === "approved" && trainerAccount.is_active === true;

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* 💡 UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">BESCHIKBAARHEID &amp; AANBOD</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                MIJN SLOTS &amp; PAKKETEN.
              </h1>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="border-2 border-white px-4 py-3 font-display text-sm text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>

              <Link
                href={activeTab === "slots" ? "/trainer-slot-toevoegen" : "/trainer-pakket-toevoegen"}
                className={`inline-flex items-center justify-center px-5 py-3 font-display text-sm transition ${
                  trainerIsActive
                    ? "bg-[#FF4B3E] text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                    : "pointer-events-none bg-[#53595E] text-white/60"
                }`}
              >
                {activeTab === "slots" ? "+ NIEUW SLOT" : "+ NIEUW PAKKET"}
              </Link>
            </div>
          </div>

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

          {/* CONFIRMATION BANNER VOOR SLOT ANNULEREN */}
          {pendingCancelSlot && (
            <section ref={cancelConfirmationRef} tabIndex={-1} className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none shadow-[8px_8px_0_0_#14171A]">
              <p className="font-display text-3xl">SLOT ANNULEREN?</p>
              <p className="mt-2 text-sm">{formatDate(pendingCancelSlot.starts_at)} om {formatTime(pendingCancelSlot.starts_at)} uur wordt verwijderd uit je agenda.</p>
              <div className="mt-5 flex gap-3">
                <button type="button" onClick={closeCancelConfirmation} className="border-2 border-white px-5 py-3 font-display text-sm text-white hover:bg-white hover:text-[#14171A]">TERUG</button>
                <button type="button" onClick={() => void cancelSlot(pendingCancelSlot)} className="bg-[#14171A] px-5 py-3 font-display text-sm text-white hover:bg-white hover:text-[#14171A]">JA, ANNULEER SLOT</button>
              </div>
            </section>
          )}

          {/* CONFIRMATION BANNER VOOR PAKKET ANNULEREN */}
          {pendingCancelPackage && (
            <section ref={cancelConfirmationRef} tabIndex={-1} className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none shadow-[8px_8px_0_0_#14171A]">
              <p className="font-display text-3xl">LESPAKKET ANNULEREN?</p>
              <p className="mt-2 text-sm">Lespakket '{pendingCancelPackage.title}' wordt geannuleerd en verwijderd van je profiel.</p>
              <div className="mt-5 flex gap-3">
                <button type="button" onClick={closeCancelConfirmation} className="border-2 border-white px-5 py-3 font-display text-sm text-white hover:bg-white hover:text-[#14171A]">TERUG</button>
                <button type="button" onClick={() => void cancelPackage(pendingCancelPackage)} className="bg-[#14171A] px-5 py-3 font-display text-sm text-white hover:bg-white hover:text-[#14171A]">JA, ANNULEER PAKKET</button>
              </div>
            </section>
          )}

          {/* TAB SWITCHER */}
          <div className="mt-8 flex gap-3 border-b-2 border-white/20 pb-4">
            <button
              type="button"
              onClick={() => { clearMessages(); setActiveTab("slots"); setStatusFilter("all"); }}
              className={`border-2 px-6 py-3 font-display text-lg transition ${
                activeTab === "slots"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              LOSSE SLOTS ({availableSlotsCount})
            </button>

            <button
              type="button"
              onClick={() => { clearMessages(); setActiveTab("packages"); setStatusFilter("all"); }}
              className={`border-2 px-6 py-3 font-display text-lg transition ${
                activeTab === "packages"
                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[4px_4px_0_0_#FF4B3E]"
                  : "border-white/30 text-white hover:border-white"
              }`}
            >
              LESPAKKETTEN &amp; TRAJECTEN ({packages.length})
            </button>
          </div>

          {/* FILTER BALK VOOR STATUS EN MAAND */}
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/15 pb-6">
            <div className="flex flex-wrap gap-2">
              {activeTab === "slots" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className={`border px-3 py-1.5 font-display text-xs transition ${
                      statusFilter === "all" ? "bg-[#D6FF3F] text-[#14171A] border-[#D6FF3F]" : "text-white border-white/30"
                    }`}
                  >
                    ALLES
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("available")}
                    className={`border px-3 py-1.5 font-display text-xs transition ${
                      statusFilter === "available" ? "bg-[#D6FF3F] text-[#14171A] border-[#D6FF3F]" : "text-white border-white/30"
                    }`}
                  >
                    BESCHIKBAAR ({availableSlotsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("booked")}
                    className={`border px-3 py-1.5 font-display text-xs transition ${
                      statusFilter === "booked" ? "bg-[#D6FF3F] text-[#14171A] border-[#D6FF3F]" : "text-white border-white/30"
                    }`}
                  >
                    GEBOEKT ({bookedSlotsCount})
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className={`border px-3 py-1.5 font-display text-xs transition ${
                      statusFilter === "all" ? "bg-[#D6FF3F] text-[#14171A] border-[#D6FF3F]" : "text-white border-white/30"
                    }`}
                  >
                    ALLES
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("available")}
                    className={`border px-3 py-1.5 font-display text-xs transition ${
                      statusFilter === "available" ? "bg-[#D6FF3F] text-[#14171A] border-[#D6FF3F]" : "text-white border-white/30"
                    }`}
                  >
                    ACTIEF
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("booked")}
                    className={`border px-3 py-1.5 font-display text-xs transition ${
                      statusFilter === "booked" ? "bg-[#D6FF3F] text-[#14171A] border-[#D6FF3F]" : "text-white border-white/30"
                    }`}
                  >
                    GEPAUZEERD / GEBOEKT
                  </button>
                </>
              )}
            </div>

            {monthOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-display text-xs text-[#D6FF3F]">PER MAAND:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="border border-white/30 bg-[#14171A] px-3 py-1.5 font-display text-xs text-white outline-none focus:border-[#D6FF3F]"
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

          {/* TAB 1: LOSSE SLOTS */}
          {activeTab === "slots" && (
            <div className="mt-8 space-y-8">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A]">
                  <p className="font-display text-5xl">{availableSlotsCount}</p>
                  <p className="mt-2 font-display text-base">BESCHIKBAAR</p>
                </div>
                <div className="border-2 border-white bg-white p-5 text-[#14171A]">
                  <p className="font-display text-5xl">{heldSlotsCount}</p>
                  <p className="mt-2 font-display text-base">IN BETALING</p>
                </div>
                <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white">
                  <p className="font-display text-5xl">{bookedSlotsCount}</p>
                  <p className="mt-2 font-display text-base">GEBOEKT</p>
                </div>
              </div>

              {filteredSlots.length === 0 ? (
                <div className="border-2 border-white/20 p-8 text-center text-[#B9BEC2]">
                  Geen slots gevonden voor dit filter.
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {filteredSlots.map((slot) => (
                    <article key={slot.id} className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                      <div className="bg-[#14171A] p-5 text-white">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-display text-xl text-[#D6FF3F]">{formatShortDate(slot.starts_at)}</p>
                            <p className="font-display text-3xl mt-1">{formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}</p>
                          </div>
                          <span className={`px-2.5 py-1 font-display text-xs ${getStatusClass(slot.status)}`}>{getStatusLabel(slot.status)}</span>
                        </div>

                        <div className="mt-4 border-y border-white/20 py-3 flex justify-between">
                          <div>
                            <p className="font-display text-[10px] text-[#8A8F94]">SPORT</p>
                            <p className="font-display text-base text-white">{slot.sport.toUpperCase()}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-display text-[10px] text-[#8A8F94]">PRIJS</p>
                            <p className="font-display text-2xl text-[#D6FF3F]">{formatEuro(slot.price_cents)}</p>
                          </div>
                        </div>

                        {slot.status === "available" && (
                          <div className="mt-5 grid grid-cols-2 gap-3">
                            <Link
                              href={`/trainer-slots/${slot.id}/wijzigen`}
                              className="flex items-center justify-center border-2 border-white px-4 py-3.5 font-display text-sm !text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                            >
                              WIJZIG SLOT
                            </Link>

                            <button
                              type="button"
                              onClick={() => openSlotCancelConfirmation(slot)}
                              className="bg-[#FF4B3E] px-4 py-3.5 font-display text-sm text-white transition hover:bg-white hover:!text-[#14171A]"
                            >
                              ANNULEER SLOT
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LESPAKKETTEN & TRAJECTEN */}
          {activeTab === "packages" && (
            <div className="mt-8 space-y-6">
              {filteredPackages.length === 0 ? (
                <div className="border-2 border-white/20 p-8 text-center text-[#B9BEC2]">
                  <p className="font-display text-2xl text-[#D6FF3F]">GEEN LESPAKKETTEN GEVONDEN BINNEN DIT FILTER.</p>
                  <Link href="/trainer-pakket-toevoegen" className="mt-6 inline-flex bg-[#FF4B3E] px-6 py-4 font-display text-lg text-white hover:bg-[#D6FF3F] hover:!text-[#14171A]">
                    + NIEUW PAKKET TOEVOEGEN →
                  </Link>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {filteredPackages.map((pkg) => {
                    const isUpdating = updatingId === pkg.id;

                    return (
                      <article key={pkg.id} className="border-2 border-[#D6FF3F] bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#D6FF3F]">
                        <div className="bg-[#14171A] p-5 text-white flex flex-col justify-between h-full">
                          <div>
                            <div className="flex justify-between items-start gap-4">
                              <div>
                                <span className="bg-[#FF4B3E] px-2.5 py-0.5 font-display text-[10px] text-white">
                                  {pkg.lesson_count} LESSEN TRAJECT
                                </span>
                                <h3 className="font-display text-2xl mt-2">{pkg.title}</h3>
                              </div>

                              <span className={`px-2.5 py-1 font-display text-xs ${pkg.is_active ? "bg-[#D6FF3F] text-[#14171A]" : "bg-[#303438] text-white"}`}>
                                {pkg.is_active ? "ACTIEF" : "GEPAUZEERD / GEBOEKT"}
                              </span>
                            </div>

                            <div className="mt-5 border-y border-white/20 py-4 space-y-1.5 text-xs text-[#B9BEC2]">
                              <p>🗓️ <strong>Start:</strong> {formatShortDate(pkg.starts_at)} om {formatTime(pkg.starts_at)} uur</p>
                              <p>⏳ <strong>Duur:</strong> {pkg.duration_minutes} min per les ({pkg.lesson_count} weken)</p>
                              <p>💰 <strong>Totaalprijs:</strong> <span className="text-[#D6FF3F] font-display text-lg">{formatEuro(pkg.price_cents)}</span> (incl. baanhuur)</p>
                            </div>
                          </div>

                          <div className="mt-6 grid grid-cols-2 gap-3">
                            <Link
                              href={`/trainer-pakket/${pkg.id}/wijzigen`}
                              className="flex items-center justify-center border-2 border-white px-4 py-3.5 font-display text-sm !text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                            >
                              WIJZIG PAKKET
                            </Link>

                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => openPackageCancelConfirmation(pkg)}
                              className="bg-[#FF4B3E] px-4 py-3.5 font-display text-sm text-white transition hover:bg-white hover:!text-[#14171A] disabled:opacity-60"
                            >
                              {isUpdating ? "..." : "ANNULEER PAKKET"}
                            </button>
                          </div>

                        </div>
                      </article>
                    );
                  })}
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