"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type PeriodFilter = "this_month" | "last_month" | "this_year" | "all";

type TrainerAccount = {
  id: string;
  name: string;
  stripe_payouts_enabled: boolean;
};

type EarningBooking = {
  id: string;
  player_name: string;
  player_email: string;
  total_price_cents: number;
  commission_amount_cents: number;
  trainer_net_amount_cents: number;
  currency: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  trainer_payout_status: string;
  availability_slots: {
    starts_at: string;
    ends_at: string;
    sport: string;
    venues: {
      name: string;
      city: string;
    } | null;
  } | null;
};

const monthNames = ["JAN", "FEB", "MRT", "APR", "MEI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC"];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatEuro(cents: number, currency = "eur"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function getPayoutStatusBadge(payoutStatus: string, bookingStatus: string) {
  if (payoutStatus === "paid") {
    return <span className="bg-[#D6FF3F] px-2.5 py-1 font-display text-xs text-[#14171A]">✓ UITBETAALD</span>;
  }
  if (payoutStatus === "eligible" || payoutStatus === "processing") {
    return <span className="bg-white px-2.5 py-1 font-display text-xs text-[#14171A]">⏱️ UITBETALING ONDERWEG</span>;
  }
  return <span className="bg-[#303438] px-2.5 py-1 font-display text-xs text-[#B9BEC2]">📅 GEPLAND (VOLGT NA LES)</span>;
}

export default function TrainerInkomstenPage() {
  const router = useRouter();

  const [trainer, setTrainer] = useState<TrainerAccount | null>();
  const [bookings, setBookings] = useState<EarningBooking[]>([]);
  const [period, setPeriod] = useState<PeriodFilter>("this_month");
  
  // JAAR FILTER VOOR DE GRAFIEKEN
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    void loadInkomstenData();
  }, []);

  async function loadInkomstenData(): Promise<void> {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace("/trainer-login");
        return;
      }

      const { data: trainerData, error: trainerError } = await supabase
        .from("trainers")
        .select("id, name, stripe_payouts_enabled")
        .eq("user_id", session.user.id)
        .single();

      if (trainerError || !trainerData) {
        setErrorMessage("Je trainerprofiel kon niet worden geladen.");
        return;
      }

      setTrainer(trainerData as TrainerAccount);

      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .select(
          `
            id,
            player_name,
            player_email,
            total_price_cents,
            commission_amount_cents,
            trainer_net_amount_cents,
            currency,
            status,
            paid_at,
            created_at,
            trainer_payout_status,
            availability_slots (
              starts_at,
              ends_at,
              sport,
              venues ( name, city )
            )
          `
        )
        .eq("trainer_id", trainerData.id)
        .in("status", ["confirmed", "completed"])
        .order("created_at", { ascending: false });

      if (bookingError) {
        setErrorMessage("Je inkomsten konden niet worden geladen.");
        return;
      }

      setBookings((bookingData ?? []) as unknown as EarningBooking[]);
    } catch {
      setErrorMessage("Er is een fout opgetreden.");
    } finally {
      setLoading(false);
    }
  }

  // BESCHIKBARE JAREN VERZAMELEN
  const availableYears = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    bookings.forEach((b) => {
      if (b.created_at) years.add(new Date(b.created_at).getFullYear());
      const startsAt = b.availability_slots?.starts_at;
      if (startsAt) years.add(new Date(startsAt).getFullYear());
    });
    return Array.from(years).sort().reverse();
  }, [bookings]);

  // GEFILERDE INKOMSTEN VOOR KAARTEN
  const filteredBookings = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    return bookings.filter((b) => {
      const startsAt = b.availability_slots?.starts_at;
      const date = startsAt ? new Date(startsAt) : new Date(b.created_at);

      if (period === "this_month") {
        return date.getFullYear() === currentYear && date.getMonth() === currentMonth;
      }
      if (period === "last_month") {
        const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
        return (
          date.getFullYear() === lastMonthDate.getFullYear() &&
          date.getMonth() === lastMonthDate.getMonth()
        );
      }
      if (period === "this_year") {
        return date.getFullYear() === currentYear;
      }

      return true; // "all"
    });
  }, [bookings, period]);

  // TOTAAL BEREKENINGEN
  const totals = useMemo(() => {
    let grossCents = 0;
    let commissionCents = 0;
    let netCents = 0;
    let paidOutCents = 0;
    let upcomingCents = 0;

    filteredBookings.forEach((b) => {
      const net = b.trainer_net_amount_cents || (b.total_price_cents - b.commission_amount_cents);
      grossCents += b.total_price_cents || 0;
      commissionCents += b.commission_amount_cents || 0;
      netCents += net;

      if (b.trainer_payout_status === "paid") {
        paidOutCents += net;
      } else {
        upcomingCents += net;
      }
    });

    return { grossCents, commissionCents, netCents, paidOutCents, upcomingCents };
  }, [filteredBookings]);

  // 📊 GRAFIEK 1: NETTO OMZET PER MAAND (JAN T/M DEC OP LESDATUM)
  const revenueChartData = useMemo(() => {
    const monthlyData = monthNames.map((name, index) => ({
      monthIndex: index,
      label: name,
      netCents: 0,
    }));

    bookings.forEach((b) => {
      const startsAt = b.availability_slots?.starts_at;
      if (!startsAt) return;
      const date = new Date(startsAt);
      if (date.getFullYear() === selectedYear) {
        monthlyData[date.getMonth()].netCents +=
          b.trainer_net_amount_cents || (b.total_price_cents - b.commission_amount_cents);
      }
    });

    const maxCents = Math.max(...monthlyData.map((m) => m.netCents), 10000);
    return { monthlyData, maxCents };
  }, [bookings, selectedYear]);

  // 📊 GRAFIEK 2: AANTAL RESERVERINGEN PER MAAND
  const bookingsCountChartData = useMemo(() => {
    const monthlyData = monthNames.map((name, index) => ({
      monthIndex: index,
      label: name,
      count: 0,
    }));

    bookings.forEach((b) => {
      if (!b.created_at) return;
      const date = new Date(b.created_at);
      if (date.getFullYear() === selectedYear) {
        monthlyData[date.getMonth()].count += 1;
      }
    });

    const maxCount = Math.max(...monthlyData.map((m) => m.count), 5);
    return { monthlyData, maxCount };
  }, [bookings, selectedYear]);

  // EXPORTEER NAAR CSV
  function exportToCsv(): void {
    if (filteredBookings.length === 0) return;

    const headers = ["Lesdatum", "Speler", "Sport", "Bruto Omzet", "GowTrain Commissie (5%)", "Netto Inkomsten", "Uitbetaalstatus"];
    const rows = filteredBookings.map((b) => [
      b.availability_slots?.starts_at ? formatDate(b.availability_slots.starts_at) : formatDate(b.created_at),
      `"${b.player_name}"`,
      b.availability_slots?.sport.toUpperCase() || "PADEL/TENNIS",
      (b.total_price_cents / 100).toFixed(2),
      (b.commission_amount_cents / 100).toFixed(2),
      (b.trainer_net_amount_cents / 100).toFixed(2),
      b.trainer_payout_status,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(";"), ...rows.map((e) => e.join(";"))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `GowTrain_Inkomsten_${period}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">INKOMSTEN LADEN...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* 💡 UNIVERSELE DYNAMISCHE SITE HEADER */}
      <SiteHeader />

      {/* CONTENT */}
      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04]">
          EURO
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 md:flex-row md:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">FINANCIEEL OVERZICHT</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                INKOMSTEN &amp;<br />UITBETALINGEN.
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/trainer-dashboard"
                className="inline-flex border-2 border-white px-4 py-3 font-display text-sm text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
              >
                ← DASHBOARD
              </Link>

              <button
                type="button"
                onClick={exportToCsv}
                disabled={filteredBookings.length === 0}
                className="inline-flex items-center justify-center bg-[#D6FF3F] px-5 py-3 font-display text-sm text-[#14171A] hover:bg-white disabled:opacity-50 shadow-[4px_4px_0_0_#FF4B3E]"
              >
                📊 EXPORTEER NAAR CSV / EXCEL →
              </button>
            </div>
          </div>

          {errorMessage && (
            <div role="alert" className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {/* PERIODE FILTERS VOOR DE COUNTER CARDS */}
          <div className="mt-8 flex flex-wrap gap-2">
            {(
              [
                ["DEZE MAAND", "this_month"],
                ["VORIGE MAAND", "last_month"],
                ["DIT JAAR", "this_year"],
                ["ALLE INKOMSTEN", "all"],
              ] as [string, PeriodFilter][]
            ).map(([label, value]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`border-2 px-4 py-2.5 font-display text-xs transition ${
                  period === value
                    ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[3px_3px_0_0_#FF4B3E]"
                    : "border-white/30 text-white hover:border-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* FINANCIËLE COUNTER CARDS */}
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-2 border-white bg-white p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-xs text-[#53595E]">BRUTO OMZET</p>
              <p className="font-display text-3xl mt-2">{formatEuro(totals.grossCents)}</p>
              <p className="mt-1 text-[10px] text-[#53595E]">Training + baanhuur</p>
            </div>

            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-xs opacity-90">COMMISSIE (5%)</p>
              <p className="font-display text-3xl mt-2">- {formatEuro(totals.commissionCents)}</p>
              <p className="mt-1 text-[10px] opacity-80">Platformkosten</p>
            </div>

            <div className="border-2 border-white/40 bg-[#14171A] p-5 text-white shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-xs text-[#D6FF3F]">GEPLAND (AANKOMEND)</p>
              <p className="font-display text-3xl mt-2 text-[#D6FF3F]">{formatEuro(totals.upcomingCents)}</p>
              <p className="mt-1 text-[10px] text-[#B9BEC2]">Volgt na lesafhandeling</p>
            </div>

            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-xs">REEDS UITBETAALD</p>
              <p className="font-display text-3xl mt-2">{formatEuro(totals.paidOutCents)}</p>
              <p className="mt-1 text-[10px] font-semibold">Op je bankrekening</p>
            </div>
          </div>

          {/* 📊 GRAFIEKEN SECTIE MET JAAR-FILTER */}
          <div className="mt-14 space-y-8">
            
            {/* JAAR SWITCHER KOP */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b-2 border-white/20 pb-4">
              <h3 className="font-display text-3xl text-white">GRAFIEKEN &amp; TRENDS</h3>
              
              <div className="flex items-center gap-2">
                <span className="font-display text-xs text-[#D6FF3F]">KIES JAAR:</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="border-2 border-[#D6FF3F] bg-[#14171A] px-4 py-2 font-display text-sm text-[#D6FF3F] outline-none"
                >
                  {availableYears.map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* GRAFIEK 1: NETTO OMZET PER MAAND (JAN T/M DEC OP LESDATUM) */}
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-6 text-white">
                <div className="flex items-center justify-between border-b border-white/20 pb-4">
                  <div>
                    <p className="font-display text-xs text-[#D6FF3F]">01 / OMZET TREND ({selectedYear})</p>
                    <h4 className="font-display text-3xl text-white">NETTO INKOMSTEN PER MAAND (JAN T/M DEC)</h4>
                  </div>
                </div>

                <div className="mt-8 flex items-end justify-between gap-2 sm:gap-3 h-52 pt-6 pb-2 px-1 sm:px-2 border-b border-white/20">
                  {revenueChartData.monthlyData.map((m) => {
                    const heightPercent = Math.min(
                      100,
                      Math.round((m.netCents / revenueChartData.maxCents) * 100)
                    );

                    return (
                      <div key={m.label} className="flex-1 flex flex-col items-center h-full justify-end group">
                        <span className="text-[9px] sm:text-[10px] font-display text-[#D6FF3F] mb-1 opacity-0 group-hover:opacity-100 transition truncate">
                          {formatEuro(m.netCents)}
                        </span>
                        <div
                          style={{ height: `${Math.max(heightPercent, 4)}%` }}
                          className={`w-full max-w-[36px] transition-all duration-300 ${
                            m.netCents > 0 ? "bg-[#D6FF3F] group-hover:bg-white" : "bg-white/10"
                          }`}
                        />
                        <span className="mt-3 font-display text-[10px] sm:text-xs text-[#B9BEC2]">
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* GRAFIEK 2: AANTAL RESERVERINGEN PER MAAND */}
            <div className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
              <div className="bg-[#14171A] p-6 text-white">
                <div className="flex items-center justify-between border-b border-white/20 pb-4">
                  <div>
                    <p className="font-display text-xs text-[#FF4B3E]">02 / BOEKINGSVOLUME ({selectedYear})</p>
                    <h4 className="font-display text-3xl text-white">AANTAL RESERVERINGEN (OP MAAKDATUM)</h4>
                  </div>
                  <span className="text-xs text-[#B9BEC2] hidden sm:inline">Wanneer spelers de boeking geplaatst hebben</span>
                </div>

                <div className="mt-8 flex items-end justify-between gap-2 sm:gap-3 h-52 pt-6 pb-2 px-1 sm:px-2 border-b border-white/20">
                  {bookingsCountChartData.monthlyData.map((m) => {
                    const heightPercent = Math.min(
                      100,
                      Math.round((m.count / bookingsCountChartData.maxCount) * 100)
                    );

                    return (
                      <div key={m.label} className="flex-1 flex flex-col items-center h-full justify-end group">
                        <span className="text-[10px] sm:text-xs font-display text-[#FF4B3E] mb-1 opacity-0 group-hover:opacity-100 transition">
                          {m.count}x
                        </span>
                        <div
                          style={{ height: `${Math.max(heightPercent, 4)}%` }}
                          className={`w-full max-w-[36px] transition-all duration-300 ${
                            m.count > 0 ? "bg-[#FF4B3E] group-hover:bg-white" : "bg-white/10"
                          }`}
                        />
                        <span className="mt-3 font-display text-[10px] sm:text-xs text-[#B9BEC2]">
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>

          {/* TRANSACTIE OVERZICHT */}
          <div className="mt-14">
            <p className="font-display text-lg text-[#FF4B3E]">TRANSACTIES ({filteredBookings.length})</p>

            {filteredBookings.length === 0 ? (
              <div className="mt-6 border-2 border-white/20 p-8 text-center text-[#B9BEC2]">
                <p className="font-display text-2xl text-[#D6FF3F]">GEEN INKOMSTEN BINNEN DEZE PERIODE.</p>
                <p className="mt-2 text-sm">Kies een andere periode of zet meer tijdsloten open in je agenda.</p>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {filteredBookings.map((b) => (
                  <article key={b.id} className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
                    <div className="bg-[#14171A] p-5 text-white flex flex-col justify-between gap-4 md:flex-row md:items-center">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="font-display text-lg text-[#D6FF3F]">
                            {b.availability_slots?.starts_at
                              ? formatDate(b.availability_slots.starts_at)
                              : formatDate(b.created_at)}
                          </span>
                          {getPayoutStatusBadge(b.trainer_payout_status, b.status)}
                        </div>

                        <p className="font-display text-2xl mt-1 text-white">{b.player_name}</p>
                        <p className="text-xs text-[#B9BEC2]">
                          {b.availability_slots?.sport?.toUpperCase() || "LESSEN"} · {b.availability_slots?.venues ? `${b.availability_slots.venues.city} — ${b.availability_slots.venues.name}` : "Locatie"}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-8 border-t border-white/20 pt-3 md:border-t-0 md:pt-0">
                        <div className="text-right">
                          <span className="block text-[10px] text-[#8A8F94]">BRUTO</span>
                          <span className="font-display text-lg text-[#B9BEC2]">{formatEuro(b.total_price_cents)}</span>
                        </div>

                        <div className="text-right">
                          <span className="block text-[10px] text-[#FF4B3E]">COMMISSIE (5%)</span>
                          <span className="font-display text-lg text-[#FF4B3E]">- {formatEuro(b.commission_amount_cents)}</span>
                        </div>

                        <div className="text-right border-l border-white/20 pl-6">
                          <span className="block text-[10px] text-[#D6FF3F]">NETTO ONTVANGEN</span>
                          <span className="font-display text-2xl text-[#D6FF3F]">{formatEuro(b.trainer_net_amount_cents)}</span>
                        </div>
                      </div>
                    </div>
                  </article>
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