"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type IssueStatus = "open" | "in_review" | "resolved" | "closed";

type IssueType =
  | "weather"
  | "court_unavailable"
  | "player_no_show"
  | "trainer_no_show"
  | "other";

type ResolutionType =
  | "rescheduled"
  | "gowtrain_credit"
  | "full_refund"
  | "no_action"
  | "other";

type IssueFilter = "all" | IssueStatus;

type AdminProfile = {
  id: string;
  full_name: string | null;
  role: string;
};

type VenueSummary = {
  name: string;
  city: string;
  address_line: string;
  postal_code: string | null;
};

type IssueSlot = {
  starts_at: string;
  ends_at: string;
  sport: string;
  venue: VenueSummary | null;
} | null;

type IssueTrainer = {
  id: string;
  name: string;
  image_url: string | null;
} | null;

type IssueBooking = {
  id: string;
  player_name: string;
  player_email: string;
  participant_count: number;
  total_price_cents: number;
  currency: string;
  status: string;
  cancellation_policy: string | null;
  trainers: IssueTrainer;
  availability_slots: IssueSlot;
} | null;

type BookingIssue = {
  id: string;
  booking_id: string;
  reporter_user_id: string;
  reporter_role: "player" | "trainer";
  issue_type: IssueType;
  description: string | null;
  status: IssueStatus;
  resolution_type: ResolutionType | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  booking: IssueBooking;
};

type AdminRefundResult = {
  booking_id: string;
  issue_id: string;
  refund_amount_cents: number;
  currency: string;
  message: string;
};

const issueFilters: Array<{ label: string; value: IssueFilter }> = [
  { label: "ALLES", value: "all" },
  { label: "OPEN", value: "open" },
  { label: "IN BEHANDELING", value: "in_review" },
  { label: "OPGELOST", value: "resolved" },
  { label: "GESLOTEN", value: "closed" },
];

const resolutionOptions: Array<{
  value: ResolutionType;
  label: string;
}> = [
  { value: "rescheduled", label: "TRAINING VERPLAATST" },
  { value: "gowtrain_credit", label: "GOWTRAIN-TEGOED" },
  { value: "full_refund", label: "VOLLEDIGE REFUND" },
  { value: "no_action", label: "GEEN ACTIE" },
  { value: "other", label: "ANDERS" },
];

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

function formatDateTime(value?: string): string {
  if (!value) return "ONBEKEND";

  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function getIssueTypeLabel(type: IssueType): string {
  const labels: Record<IssueType, string> = {
    weather: "SLECHT WEER",
    court_unavailable: "BAAN NIET BESCHIKBAAR",
    player_no_show: "SPELER NIET VERSCHENEN",
    trainer_no_show: "TRAINER NIET VERSCHENEN",
    other: "ANDER PROBLEEM",
  };

  return labels[type];
}

function getIssueStatusLabel(status: IssueStatus): string {
  const labels: Record<IssueStatus, string> = {
    open: "OPEN",
    in_review: "IN BEHANDELING",
    resolved: "OPGELOST",
    closed: "GESLOTEN",
  };

  return labels[status];
}

function getIssueStatusClass(status: IssueStatus): string {
  if (status === "open") return "bg-[#FF4B3E] text-white";
  if (status === "in_review") return "bg-white text-[#14171A]";
  if (status === "resolved") return "bg-[#D6FF3F] text-[#14171A]";

  return "bg-[#303438] text-white";
}

function getVenueLabel(venue: VenueSummary | null): string {
  if (!venue) return "LOCATIE ONBEKEND";

  return `${venue.city.toUpperCase()} — ${venue.name}`;
}

function getResolutionLabel(value: ResolutionType | null): string {
  if (!value) return "GEEN OPLOSSING VASTGELEGD";

  return (
    resolutionOptions.find((option) => option.value === value)?.label ??
    value.toUpperCase()
  );
}

export default function AdminIssuesPage() {
  const router = useRouter();

  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>();
  const [issues, setIssues] = useState<BookingIssue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>();

  const [filter, setFilter] = useState<IssueFilter>("open");
  const [resolutionType, setResolutionType] = useState<ResolutionType>("rescheduled");
  const [resolutionNote, setResolutionNote] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>();
  const [refundingIssueId, setRefundingIssueId] = useState<string | null>(null);

  const [pendingAdminRefundIssue, setPendingAdminRefundIssue] = useState<BookingIssue | null>();

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const adminRefundRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void loadIssues();
  }, []);

  const filteredIssues = useMemo(() => {
    if (filter === "all") return issues;
    return issues.filter((issue) => issue.status === filter);
  }, [filter, issues]);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? null,
    [issues, selectedIssueId]
  );

  const openCount = useMemo(
    () => issues.filter((issue) => issue.status === "open").length,
    [issues]
  );

  const inReviewCount = useMemo(
    () => issues.filter((issue) => issue.status === "in_review").length,
    [issues]
  );

  const resolvedCount = useMemo(
    () =>
      issues.filter(
        (issue) => issue.status === "resolved" || issue.status === "closed"
      ).length,
    [issues]
  );

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function loadIssues(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/speler-login");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profileData) {
        showError("Je adminprofiel kon niet worden geladen.");
        return;
      }

      const profile = profileData as AdminProfile;

      if (profile.role !== "admin") {
        router.replace("/speler-login");
        return;
      }

      setAdminProfile(profile);

      const { data, error } = await supabase
        .from("booking_issues")
        .select(
          `
            id,
            booking_id,
            reporter_user_id,
            reporter_role,
            issue_type,
            description,
            status,
            resolution_type,
            resolution_note,
            resolved_by,
            resolved_at,
            created_at,
            updated_at,

            booking:bookings (
              id,
              player_name,
              player_email,
              participant_count,
              total_price_cents,
              currency,
              status,
              cancellation_policy,

              trainers (
                id,
                name,
                image_url
              ),

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
              )
            )
          `
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Admin issues ophalen fout:", error.message);
        showError("De probleemmeldingen konden niet worden geladen.");
        setIssues([]);
        return;
      }

      const loadedIssues = (data ?? []) as unknown as BookingIssue[];
      setIssues(loadedIssues);

      setSelectedIssueId((currentId) => {
        if (currentId && loadedIssues.some((issue) => issue.id === currentId)) {
          return currentId;
        }

        const firstActive =
          loadedIssues.find(
            (issue) => issue.status === "open" || issue.status === "in_review"
          ) ?? loadedIssues[0];

        return firstActive?.id ?? null;
      });
    } catch (error) {
      console.error("Onverwachte admin issues-fout:", error);
      showError("De probleemmeldingen konden niet worden geladen.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadIssues(false);
    setRefreshing(false);
  }

  function openIssue(issue: BookingIssue): void {
    clearMessages();
    setPendingAdminRefundIssue(null);
    setSelectedIssueId(issue.id);
    setResolutionType(issue.resolution_type ?? "rescheduled");
    setResolutionNote(issue.resolution_note ?? "");
  }

  function openAdminRefundConfirmation(issue: BookingIssue): void {
    clearMessages();
    setPendingAdminRefundIssue(issue);

    window.setTimeout(() => {
      adminRefundRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      adminRefundRef.current?.focus();
    }, 50);
  }

  async function markInReview(issue: BookingIssue): Promise<void> {
    setUpdatingIssueId(issue.id);
    clearMessages();

    try {
      const { error } = await supabase
        .from("booking_issues")
        .update({ status: "in_review" })
        .eq("id", issue.id)
        .eq("status", "open");

      if (error) {
        showError("Deze melding kon niet in behandeling worden gezet.");
        return;
      }

      setSuccessMessage("De melding staat nu in behandeling.");
      await loadIssues(false);
    } catch {
      showError("Deze melding kon niet in behandeling worden gezet.");
    } finally {
      setUpdatingIssueId(null);
    }
  }

  async function resolveIssue(
    issue: BookingIssue,
    closeIssue = false
  ): Promise<void> {
    if (!adminProfile) return;

    setUpdatingIssueId(issue.id);
    clearMessages();

    try {
      const { error } = await supabase
        .from("booking_issues")
        .update({
          status: closeIssue ? "closed" : "resolved",
          resolution_type: resolutionType,
          resolution_note: resolutionNote.trim() || null,
          resolved_by: adminProfile.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", issue.id)
        .in("status", ["open", "in_review"]);

      if (error) {
        showError("Deze melding kon niet worden afgehandeld.");
        return;
      }

      setSuccessMessage(
        closeIssue
          ? "De melding is gesloten."
          : "De melding is als opgelost gemarkeerd."
      );

      await loadIssues(false);
    } catch {
      showError("Deze melding kon niet worden afgehandeld.");
    } finally {
      setUpdatingIssueId(null);
    }
  }

  async function handleAdminRefund(issue: BookingIssue): Promise<void> {
    if (!issue.booking) {
      showError("De booking bij deze melding kon niet worden gevonden.");
      return;
    }

    setRefundingIssueId(issue.id);
    clearMessages();

    try {
      const { data, error } = await supabase.rpc(
        "request_admin_booking_refund",
        {
          p_booking_id: issue.booking.id,
          p_issue_id: issue.id,
        }
      );

      if (error) {
        console.error("Admin refund aanvragen fout:", error.message);
        showError(
          error.message || "De volledige refund kon niet worden aangevraagd."
        );
        return;
      }

      const result = (
        Array.isArray(data) ? data[0] : data
      ) as AdminRefundResult | null;

      if (!result) {
        showError("De volledige refund kon niet worden aangevraagd.");
        return;
      }

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
        body: JSON.stringify({
          bookingId: issue.booking.id,
          issueId: issue.id,
        }),
      });

      const refundResult = (await response.json()) as {
        refundId?: string;
        error?: string;
      };

      if (!response.ok) {
        showError(
          refundResult.error ||
            "De refund is aangevraagd, maar kon niet direct via Stripe worden gestart."
        );
        await loadIssues(false);
        return;
      }

      setPendingAdminRefundIssue(null);
      setSuccessMessage(
        `Volledige refund van ${formatEuro(
          result.refund_amount_cents,
          result.currency
        )} is verwerkt via Stripe.`
      );

      await loadIssues(false);
    } catch (error) {
      console.error("Onverwachte admin refund-fout:", error);
      showError("De volledige refund kon niet worden gestart.");
    } finally {
      setRefundingIssueId(null);
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
            MELDINGEN LADEN...
          </p>
        </div>
      </main>
    );
  }

  const adminName =
    adminProfile?.full_name?.trim().split(" ")[0]?.toUpperCase() ?? "ADMIN";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      {/* HEADER */}
      <header className="border-b border-white/15">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link
            href="/admin"
            aria-label="Terug naar admin hub"
            className="group inline-flex items-center gap-2"
          >
            <span className="font-display text-3xl leading-none text-[#D6FF3F] sm:text-4xl">
              GOWTRAIN
            </span>
            <span className="mt-1 h-0 w-0 border-b-[9px] border-l-[8px] border-t-[9px] border-b-transparent border-l-[#D6FF3F] border-t-transparent transition-transform duration-200 group-hover:translate-x-1" />
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="font-display text-sm text-white transition hover:text-[#D6FF3F]"
            >
              ← ADMIN HUB
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
          ADMIN
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">ADMIN / ISSUES</p>
              <h1 className="mt-3 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                HÉ, {adminName}.<br />
                PROBLEMEN OPLOSSEN.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#D7D9DA]">
                Beoordeel en los gemelde problemen rondom trainingen, weer, locaties en no-shows op.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="w-fit border-2 border-white px-4 py-3 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
            >
              {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
            </button>
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

          {/* STATS */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[6px_6px_0_0_#D6FF3F]">
              <p className="font-display text-5xl">{openCount}</p>
              <p className="mt-2 font-display text-base">OPEN MELDINGEN</p>
            </div>

            <div className="border-2 border-white bg-white p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{inReviewCount}</p>
              <p className="mt-2 font-display text-base">IN BEHANDELING</p>
            </div>

            <div className="border-2 border-[#D6FF3F] bg-[#D6FF3F] p-5 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              <p className="font-display text-5xl">{resolvedCount}</p>
              <p className="mt-2 font-display text-base">AFGEHANDELD</p>
            </div>
          </div>

          {/* CONFIRMATION BANNER VOOR REFUND */}
          {pendingAdminRefundIssue?.booking && (
            <section
              ref={adminRefundRef}
              tabIndex={-1}
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white outline-none sm:p-6 shadow-[8px_8px_0_0_#14171A]"
            >
              <p className="font-display text-3xl">VOLLEDIGE REFUND STARTEN?</p>
              <p className="mt-3 max-w-2xl leading-relaxed text-white/90">
                Je betaalt <strong>{formatEuro(pendingAdminRefundIssue.booking.total_price_cents, pendingAdminRefundIssue.booking.currency)}</strong> volledig terug aan <strong>{pendingAdminRefundIssue.booking.player_name}</strong>.
              </p>

              <div className="mt-5 border-l-2 border-white pl-4">
                <p className="font-display text-lg">STRIPE REFUND WORDT GEACTIVEERD</p>
                <p className="mt-1 text-sm leading-relaxed text-white/90">
                  De traineruitbetaling wordt geblokkeerd en de melding wordt gesloten zodra Stripe de transactie heeft verwerkt.
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={refundingIssueId === pendingAdminRefundIssue.id}
                  onClick={() => setPendingAdminRefundIssue(null)}
                  className="border-2 border-white px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A]"
                >
                  TERUG
                </button>

                <button
                  type="button"
                  disabled={refundingIssueId === pendingAdminRefundIssue.id}
                  onClick={() => void handleAdminRefund(pendingAdminRefundIssue)}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {refundingIssueId === pendingAdminRefundIssue.id ? "REFUND VERWERKEN..." : "JA, START REFUND"}
                </button>
              </div>
            </section>
          )}

          {/* MAIN GRID: LINKS MELDINGEN, RECHTS DETAIL */}
          <div className="mt-12 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            
            {/* LINKER KOLOM: MELDINGEN LIJST */}
            <section>
              <div className="border-b-2 border-white/20 pb-5">
                <p className="font-display text-lg text-[#FF4B3E]">MELDINGEN</p>
                <h2 className="mt-2 font-display text-4xl leading-[0.83] sm:text-5xl">OVERZICHT.</h2>

                <div className="mt-5 flex flex-wrap gap-2">
                  {issueFilters.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFilter(item.value)}
                      className={`border-2 px-3 py-2 font-display text-xs transition ${
                        filter === item.value
                          ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                          : "border-white/30 text-white hover:border-white"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredIssues.length === 0 ? (
                <div className="mt-6 border-2 border-white/20 p-5 text-[#B9BEC2]">
                  Geen meldingen binnen dit filter.
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {filteredIssues.map((issue) => {
                    const isSelected = issue.id === selectedIssue?.id;

                    return (
                      <button
                        key={issue.id}
                        type="button"
                        onClick={() => openIssue(issue)}
                        className={`w-full border-2 p-4 text-left transition ${
                          isSelected
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                            : "border-white/25 bg-white/5 text-white hover:border-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display text-sm">
                              {getIssueTypeLabel(issue.issue_type)}
                            </p>
                            <p className={`mt-1 text-xs ${isSelected ? "text-[#14171A]/80 font-semibold" : "text-[#B9BEC2]"}`}>
                              {issue.booking?.player_name || "Speler"} · {issue.booking?.trainers?.name || "Trainer"}
                            </p>
                          </div>

                          <span className={`shrink-0 px-2.5 py-1 font-display text-[10px] ${getIssueStatusClass(issue.status)}`}>
                            {getIssueStatusLabel(issue.status)}
                          </span>
                        </div>

                        <p className={`mt-3 text-[10px] ${isSelected ? "text-[#14171A]/70" : "text-[#8A8F94]"}`}>
                          Gemeld door {issue.reporter_role === "player" ? "speler" : "trainer"} · {formatDateTime(issue.created_at)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* RECHTER KOLOM: ISSUE DETAIL & OPLOSSING */}
            <section>
              <p className="font-display text-lg text-[#FF4B3E]">AFHANDELING</p>
              <h2 className="mt-2 font-display text-4xl leading-[0.83] sm:text-5xl">
                {selectedIssue ? "MELDING BEKIJKEN." : "KIES EEN MELDING."}
              </h2>

              {!selectedIssue ? (
                <div className="mt-6 border-2 border-white/20 p-6 text-[#B9BEC2]">
                  Kies links een melding om de details te bekijken.
                </div>
              ) : (
                <div className="mt-6 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]">
                  <div className="bg-[#14171A] p-5 text-white sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-display text-xs text-[#FF4B3E]">
                          {getIssueTypeLabel(selectedIssue.issue_type)}
                        </p>
                        <p className="mt-1 font-display text-2xl">
                          {selectedIssue.booking?.player_name || "SPELER"}{" "}
                          <span className="text-[#D6FF3F]">×</span>{" "}
                          {selectedIssue.booking?.trainers?.name || "TRAINER"}
                        </p>
                      </div>

                      <span className={`shrink-0 px-3 py-1.5 font-display text-xs ${getIssueStatusClass(selectedIssue.status)}`}>
                        {getIssueStatusLabel(selectedIssue.status)}
                      </span>
                    </div>

                    <div className="mt-6 border-y border-white/20 py-4">
                      <p className="font-display text-lg text-[#D6FF3F]">
                        {formatDate(selectedIssue.booking?.availability_slots?.starts_at)}
                      </p>
                      <p className="mt-1 font-display text-2xl">
                        {formatTime(selectedIssue.booking?.availability_slots?.starts_at)} – {formatTime(selectedIssue.booking?.availability_slots?.ends_at)}
                      </p>
                      {selectedIssue.booking && (
                        <p className="mt-2 font-display text-xl text-[#D6FF3F]">
                          {formatEuro(selectedIssue.booking.total_price_cents, selectedIssue.booking.currency)}
                        </p>
                      )}
                    </div>

                    {selectedIssue.booking?.availability_slots?.venue && (
                      <div className="mt-4">
                        <p className="font-display text-xs text-[#FF4B3E]">LOCATIE</p>
                        <p className="mt-1 font-display text-base text-white">
                          {getVenueLabel(selectedIssue.booking.availability_slots.venue)}
                        </p>
                        <p className="mt-0.5 text-xs text-[#B9BEC2]">
                          {selectedIssue.booking.availability_slots.venue.address_line}, {selectedIssue.booking.availability_slots.venue.city}
                        </p>
                      </div>
                    )}

                    <div className="mt-5 border-l-2 border-[#FF4B3E] pl-4">
                      <p className="font-display text-xs text-[#FF4B3E]">
                        MELDING VAN {selectedIssue.reporter_role === "player" ? "SPELER" : "TRAINER"}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#D7D9DA]">
                        {selectedIssue.description || "Geen extra toelichting gegeven."}
                      </p>
                    </div>

                    {/* ACTIES VOOR ADMIN */}
                    {selectedIssue.status === "open" && (
                      <button
                        type="button"
                        disabled={updatingIssueId === selectedIssue.id}
                        onClick={() => void markInReview(selectedIssue)}
                        className="mt-6 w-full bg-[#D6FF3F] py-3.5 font-display text-sm text-[#14171A] transition hover:bg-white disabled:opacity-60"
                      >
                        {updatingIssueId === selectedIssue.id ? "BEZIG..." : "IN BEHANDELING NEMEN"}
                      </button>
                    )}

                    {(selectedIssue.status === "open" || selectedIssue.status === "in_review") && (
                      <div className="mt-6 border-t border-white/20 pt-6">
                        <p className="font-display text-xs text-[#FF4B3E]">KIES OPLOSSING</p>

                        <div className="mt-3 grid gap-2">
                          {resolutionOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              disabled={updatingIssueId === selectedIssue.id}
                              onClick={() => setResolutionType(option.value)}
                              className={`border-2 px-4 py-2.5 text-left font-display text-xs transition ${
                                resolutionType === option.value
                                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                                  : "border-white/30 text-white hover:border-white"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>

                        <div className="mt-4">
                          <label htmlFor="resolution-note" className="mb-2 block font-display text-xs text-[#FF4B3E]">
                            INTERNE NOTITIE
                          </label>
                          <textarea
                            id="resolution-note"
                            rows={3}
                            maxLength={2000}
                            disabled={updatingIssueId === selectedIssue.id}
                            value={resolutionNote}
                            onChange={(e) => setResolutionNote(e.target.value)}
                            placeholder="Bijv. Training opnieuw ingepland of tegoed toegekend."
                            className="w-full resize-y border-2 border-white/25 bg-transparent px-4 py-3 text-xs text-white outline-none focus:border-[#D6FF3F]"
                          />
                        </div>

                        {resolutionType === "full_refund" ? (
                          <button
                            type="button"
                            disabled={updatingIssueId === selectedIssue.id}
                            onClick={() => openAdminRefundConfirmation(selectedIssue)}
                            className="mt-5 w-full bg-[#FF4B3E] px-4 py-4 font-display text-base text-white transition hover:bg-white hover:!text-[#14171A]"
                          >
                            START VOLLEDIGE REFUND →
                          </button>
                        ) : (
                          <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            <button
                              type="button"
                              disabled={updatingIssueId === selectedIssue.id}
                              onClick={() => void resolveIssue(selectedIssue, false)}
                              className="bg-[#D6FF3F] px-4 py-3.5 font-display text-sm text-[#14171A] transition hover:bg-white disabled:opacity-60"
                            >
                              {updatingIssueId === selectedIssue.id ? "BEZIG..." : "MARKEER OPGELOST"}
                            </button>

                            <button
                              type="button"
                              disabled={updatingIssueId === selectedIssue.id}
                              onClick={() => void resolveIssue(selectedIssue, true)}
                              className="border-2 border-white px-4 py-3.5 font-display text-sm !text-white transition hover:border-[#D6FF3F] hover:bg-[#D6FF3F] hover:!text-[#14171A]"
                            >
                              SLUIT MELDING
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {(selectedIssue.status === "resolved" || selectedIssue.status === "closed") && (
                      <div className="mt-6 border-t border-white/20 pt-5">
                        <p className="font-display text-xs text-[#8A8F94]">STATUS AFHANDELING</p>
                        <p className="mt-1 font-display text-base text-[#D6FF3F]">
                          {getResolutionLabel(selectedIssue.resolution_type)}
                        </p>
                        {selectedIssue.resolution_note && (
                          <p className="mt-2 text-xs text-[#B9BEC2]">{selectedIssue.resolution_note}</p>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              )}
            </section>

          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}