"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
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

type AvailableResolution = "full_refund" | "no_action";
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
  package_purchase_id: string | null;
  player_name: string;
  player_email: string;
  participant_count: number;
  total_price_cents: number;
  currency: string;
  status: string;
  paid_at: string | null;
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
  refund_request_id: string;
  refund_status: string;
  refund_amount_cents: number;
  currency: string;
  already_registered: boolean;
  message: string;
};

type IssueActionResult = {
  issue_id: string;
  message: string;
};

type PendingAction = {
  issue: BookingIssue;
  action: "refund" | "resolve_no_refund" | "close_no_refund";
  note: string;
};

const issueFilters: Array<{ label: string; value: IssueFilter }> = [
  { label: "ALLES", value: "all" },
  { label: "OPEN", value: "open" },
  { label: "IN BEHANDELING", value: "in_review" },
  { label: "OPGELOST", value: "resolved" },
  { label: "GESLOTEN", value: "closed" },
];

const resolutionLabels: Record<ResolutionType, string> = {
  rescheduled: "TRAINING VERPLAATST",
  gowtrain_credit: "GOWTRAIN-TEGOED",
  full_refund: "VOLLEDIG LESBEDRAG TERUGBETALEN",
  no_action: "AFGEHANDELD ZONDER REFUND",
  other: "ANDERE OPLOSSING",
};

const availableResolutionOptions: Array<{
  value: AvailableResolution;
  label: string;
}> = [
  {
    value: "full_refund",
    label: "VOLLEDIG LESBEDRAG TERUGBETALEN",
  },
  {
    value: "no_action",
    label: "AFHANDELEN ZONDER REFUND",
  },
];

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDate(value?: string | null): string {
  const date = validDate(value);
  if (!date) return "GEEN DATUM";

  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  })
    .format(date)
    .toUpperCase();
}

function formatDateTime(value?: string | null): string {
  const date = validDate(value);
  if (!date) return "ONBEKEND";

  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

function formatTime(value?: string | null): string {
  const date = validDate(value);
  if (!date) return "--:--";

  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(date);
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

  return labels[type] ?? "PROBLEEM";
}

function getIssueStatusLabel(status: IssueStatus): string {
  const labels: Record<IssueStatus, string> = {
    open: "OPEN",
    in_review: "IN BEHANDELING",
    resolved: "OPGELOST",
    closed: "GESLOTEN",
  };

  return labels[status] ?? status;
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
  return resolutionLabels[value] ?? value.toUpperCase();
}

function isActiveIssue(issue: BookingIssue): boolean {
  return issue.status === "open" || issue.status === "in_review";
}

/*
 * Alleen een UI-controle.
 * De database controleert ook bestaande refundopdrachten,
 * transfers, de bronbetaling en de actuele melding.
 */
function hasRefundContext(issue: BookingIssue): boolean {
  return (
    issue.resolution_type === "full_refund" ||
    issue.booking?.status === "refund_pending" ||
    issue.booking?.status === "refunded"
  );
}

function canShowDecisionForm(issue: BookingIssue): boolean {
  return (
    isActiveIssue(issue) &&
    Boolean(issue.booking?.paid_at) &&
    ["confirmed", "completed"].includes(issue.booking?.status ?? "") &&
    !hasRefundContext(issue)
  );
}

export default function AdminIssuesPage() {
  const router = useRouter();

  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [issues, setIssues] = useState<BookingIssue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IssueFilter>("open");

  const [resolutionType, setResolutionType] =
    useState<AvailableResolution>("no_action");
  const [resolutionNote, setResolutionNote] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const actionBusyRef = useRef(false);
  const refreshBusyRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const confirmationRef = useRef<HTMLElement | null>(null);

  const busy = loading || refreshing || updatingIssueId !== null;

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? null,
    [issues, selectedIssueId]
  );

  const filteredIssues = useMemo(
    () =>
      filter === "all"
        ? issues
        : issues.filter((issue) => issue.status === filter),
    [issues, filter]
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

  useEffect(() => {
    void loadIssues();

    return () => {
      loadSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setResolutionType(
      selectedIssue?.resolution_type === "full_refund"
        ? "full_refund"
        : "no_action"
    );
    setResolutionNote(selectedIssue?.resolution_note ?? "");
  }, [selectedIssue?.id, selectedIssue?.updated_at]);

  useEffect(() => {
    if (!pendingAction) return;

    const timeout = window.setTimeout(() => {
      confirmationRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      confirmationRef.current?.focus();
    }, 50);

    return () => window.clearTimeout(timeout);
  }, [pendingAction]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function showError(message: string): void {
    setSuccessMessage("");
    setErrorMessage(message);
  }

  async function loadIssues(showLoading = true): Promise<boolean> {
    const sequence = ++loadSequenceRef.current;
    const isCurrent = () => sequence === loadSequenceRef.current;

    if (showLoading) setLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!isCurrent()) return false;

      if (userError || !user) {
        setIssues([]);
        setAdminProfile(null);
        router.replace("/speler-login");
        return false;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (!isCurrent()) return false;

      if (profileError) {
        throw new Error("Je adminprofiel kon niet worden geladen.");
      }

      if (!profile || profile.role !== "admin") {
        setIssues([]);
        setAdminProfile(null);
        router.replace("/speler-login");
        return false;
      }

      setAdminProfile(profile as AdminProfile);

      const { data, error } = await supabase
        .from("booking_issues")
        .select(`
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
            package_purchase_id,
            player_name,
            player_email,
            participant_count,
            total_price_cents,
            currency,
            status,
            paid_at,
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
        `)
        .order("created_at", { ascending: false });

      if (!isCurrent()) return false;

      if (error) {
        throw new Error("De probleemmeldingen konden niet worden geladen.");
      }

      const loadedIssues = (data ?? []) as unknown as BookingIssue[];
      setIssues(loadedIssues);

      setSelectedIssueId((currentId) => {
        if (currentId && loadedIssues.some((issue) => issue.id === currentId)) {
          return currentId;
        }

        return (
          loadedIssues.find(isActiveIssue)?.id ??
          loadedIssues[0]?.id ??
          null
        );
      });

      return true;
    } catch (error: unknown) {
      if (isCurrent()) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "De probleemmeldingen konden niet worden geladen."
        );
      }

      return false;
    } finally {
      if (isCurrent() && showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    if (actionBusyRef.current || refreshBusyRef.current) return;

    refreshBusyRef.current = true;
    setRefreshing(true);
    setPendingAction(null);
    clearMessages();

    try {
      await loadIssues(false);
    } finally {
      refreshBusyRef.current = false;
      setRefreshing(false);
    }
  }

  function openIssue(issue: BookingIssue): void {
    if (actionBusyRef.current || refreshBusyRef.current) return;

    clearMessages();
    setPendingAction(null);
    setSelectedIssueId(issue.id);
    setResolutionType(
      issue.resolution_type === "full_refund" ? "full_refund" : "no_action"
    );
    setResolutionNote(issue.resolution_note ?? "");
  }

  function changeFilter(nextFilter: IssueFilter): void {
    if (actionBusyRef.current || refreshBusyRef.current) return;

    clearMessages();
    setPendingAction(null);
    setFilter(nextFilter);

    const matchingIssues =
      nextFilter === "all"
        ? issues
        : issues.filter((issue) => issue.status === nextFilter);

    if (!matchingIssues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(matchingIssues[0]?.id ?? null);
    }
  }

  function openDecisionConfirmation(
    issue: BookingIssue,
    action: PendingAction["action"]
  ): void {
    if (actionBusyRef.current || refreshBusyRef.current) return;

    clearMessages();

    if (!canShowDecisionForm(issue)) {
      showError(
        "Deze melding of boekingsstatus vereist eerst controle. Vernieuw het overzicht."
      );
      return;
    }

    const note = resolutionNote.trim();

    if (!note || note.length > 2000) {
      showError("Vul een besluittoelichting van maximaal 2000 tekens in.");
      return;
    }

    /*
     * Bewaar de meldingversie én de toelichting voor deze bevestiging.
     * Latere wijzigingen in het formulier veranderen dit besluit niet.
     */
    setPendingAction({ issue, action, note });
  }

  async function markInReview(issue: BookingIssue): Promise<void> {
    if (actionBusyRef.current || refreshBusyRef.current) return;

    actionBusyRef.current = true;
    setUpdatingIssueId(issue.id);
    setPendingAction(null);
    clearMessages();

    try {
      const { data, error } = await supabase.rpc(
        "admin_set_booking_issue_state",
        {
          p_issue_id: issue.id,
          p_action: "in_review",
          p_note: null,
          p_expected_updated_at: issue.updated_at,
        }
      );

      if (error) {
        showError(
          error.code === "P0001" || error.code === "42501"
            ? error.message
            : "De wijziging kon niet worden bevestigd. Vernieuw het overzicht."
        );
        return;
      }

      const result = data as IssueActionResult | null;

      if (!result || result.issue_id !== issue.id) {
        showError(
          "Het resultaat kon niet worden bevestigd. Vernieuw het overzicht."
        );
        return;
      }

      const refreshed = await loadIssues(false);

      setSuccessMessage(
        refreshed
          ? result.message
          : `${result.message} Vernieuw het overzicht om de actuele status te laden.`
      );
    } catch {
      showError(
        "De verbinding is onderbroken. Controleer de actuele melding voordat je opnieuw probeert."
      );
    } finally {
      actionBusyRef.current = false;
      setUpdatingIssueId(null);
    }
  }

  async function confirmDecision(): Promise<void> {
    if (
      !pendingAction ||
      actionBusyRef.current ||
      refreshBusyRef.current
    ) {
      return;
    }

    const decision = pendingAction;
    const { issue, action, note } = decision;

    if (!issue.booking) {
      showError("De boeking bij deze melding ontbreekt.");
      return;
    }

    actionBusyRef.current = true;
    setUpdatingIssueId(issue.id);
    clearMessages();

    try {
      let message: string;

      if (action === "refund") {
        const { data, error } = await supabase.rpc(
          "request_admin_lesson_refund",
          {
            p_booking_id: issue.booking.id,
            p_issue_id: issue.id,
            p_note: note,
            p_expected_updated_at: issue.updated_at,
          }
        );

        if (error) {
          showError(
            error.code === "P0001" || error.code === "42501"
              ? error.message
              : "Het refundbesluit kon niet worden bevestigd. Controleer eerst de actuele melding."
          );
          return;
        }

        const result = data as AdminRefundResult | null;

        if (
          !result ||
          result.booking_id !== issue.booking.id ||
          result.issue_id !== issue.id ||
          !result.refund_request_id
        ) {
          showError(
            "Het resultaat kon niet worden bevestigd. Vernieuw het overzicht en vraag geen afzonderlijke Stripe-refund aan."
          );
          return;
        }

        message = result.message;

        /*
         * Geen fetch naar /api/stripe/refunds/create.
         * De RPC heeft het besluit en de refundopdracht samen opgeslagen.
         */
      } else {
        const { data, error } = await supabase.rpc(
          "admin_set_booking_issue_state",
          {
            p_issue_id: issue.id,
            p_action: action,
            p_note: note,
            p_expected_updated_at: issue.updated_at,
          }
        );

        if (error) {
          showError(
            error.code === "P0001" || error.code === "42501"
              ? error.message
              : "Het besluit kon niet worden bevestigd. Vernieuw het overzicht."
          );
          return;
        }

        const result = data as IssueActionResult | null;

        if (!result || result.issue_id !== issue.id) {
          showError(
            "Het resultaat kon niet worden bevestigd. Vernieuw het overzicht."
          );
          return;
        }

        message = result.message;
      }

      setPendingAction(null);

      const refreshed = await loadIssues(false);

      setSuccessMessage(
        refreshed
          ? message
          : `${message} Het overzicht kon nog niet worden vernieuwd. Klik op Ververs.`
      );
    } catch {
      showError(
        "De verbinding is onderbroken. Het besluit kan al geregistreerd zijn. Vernieuw het overzicht voordat je opnieuw handelt."
      );
      setPendingAction(null);
    } finally {
      actionBusyRef.current = false;
      setUpdatingIssueId(null);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="text-center">
          <p className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">
            GOWTRAIN
          </p>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">
            MELDINGEN LADEN...
          </p>
        </div>
      </main>
    );
  }

  const adminName =
    adminProfile?.full_name?.trim().split(" ")[0]?.toUpperCase() || "ADMIN";

  const selectedBooking = selectedIssue?.booking ?? null;
  const selectedSlot = selectedBooking?.availability_slots ?? null;
  const decisionFormVisible =
    selectedIssue !== null && canShowDecisionForm(selectedIssue);

  const pendingBooking = pendingAction?.issue.booking ?? null;
  const pendingIsRefund = pendingAction?.action === "refund";

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden py-10 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 select-none font-display text-[16rem] leading-none text-[#D6FF3F] opacity-[0.04] sm:text-[25rem]"
        >
          ADMIN
        </div>

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                ADMIN / ISSUES
              </p>
              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                HÉ, {adminName}.
                <br />
                PROBLEMEN OPLOSSEN.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Beoordeel meldingen bij losse lessen en pakketlessen.
                Leg een besluit vast en zet zo nodig het volledige lesbedrag
                klaar voor terugbetaling.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/admin"
                className="inline-flex border-2 border-white px-4 py-2.5 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
              >
                ← ADMIN HUB
              </Link>

              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={busy}
                className="border-2 border-white px-4 py-2.5 font-display text-xs transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white"
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="mt-8 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A] shadow-[8px_8px_0_0_#FF4B3E]"
            >
              {successMessage}
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 shadow-[6px_6px_0_0_#D6FF3F]">
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

          {/* Bevestiging gebruikt een vastgelegde meldingversie en toelichting. */}
          {pendingAction && pendingBooking && (
            <section
              ref={confirmationRef}
              tabIndex={-1}
              aria-labelledby="admin-decision-title"
              className="mt-8 border-2 border-[#FF4B3E] bg-[#FF4B3E] p-5 text-white shadow-[8px_8px_0_0_#14171A] outline-none sm:p-6"
            >
              <h2 id="admin-decision-title" className="font-display text-3xl">
                {pendingIsRefund
                  ? "VOLLEDIG LESBEDRAG TERUGBETALEN?"
                  : "AFHANDELEN ZONDER REFUND?"}
              </h2>

              <p className="mt-3 leading-relaxed">
                {pendingBooking.player_name} ·{" "}
                {pendingBooking.trainers?.name || "Trainer"}
                <br />
                {formatDate(pendingBooking.availability_slots?.starts_at)} om{" "}
                {formatTime(pendingBooking.availability_slots?.starts_at)}
              </p>

              <div className="mt-5 border-l-2 border-white pl-4">
                {pendingIsRefund ? (
                  <>
                    <p className="font-display text-lg">
                      TERUGBETALING WORDT KLAARGEZET
                    </p>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed">
                      Je zet{" "}
                      <strong>
                        {formatEuro(
                          pendingBooking.total_price_cents,
                          pendingBooking.currency
                        )}
                      </strong>{" "}
                      klaar voor terugbetaling van deze ene les. De
                      trainervergoeding voor deze les wordt geblokkeerd.
                      De melding blijft in behandeling tot de refund succesvol
                      en administratief is afgerond.
                    </p>
                    {pendingBooking.package_purchase_id && (
                      <p className="mt-2 text-sm font-semibold">
                        Dit is één pakketles, niet het volledige pakket.
                        De andere lessen worden door dit besluit niet gewijzigd.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-display text-lg">
                      GEEN TERUGBETALING AANVRAGEN
                    </p>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed">
                      Je markeert deze melding als{" "}
                      {pendingAction.action === "close_no_refund"
                        ? "gesloten"
                        : "opgelost"}{" "}
                      zonder refund. Deze melding blokkeert daarna niet meer
                      als open zaak. Andere voorwaarden en blokkades blijven
                      gelden. Deze actie voert geen trainertransfer uit.
                    </p>
                  </>
                )}
              </div>

              <div className="mt-5 bg-black/10 p-4">
                <p className="font-display text-sm">BESLUITTOELICHTING</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {pendingAction.note}
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingAction(null)}
                  className="border-2 border-white px-5 py-3 font-display text-base transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  TERUG
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmDecision()}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {updatingIssueId
                    ? "BESLUIT OPSLAAN..."
                    : pendingIsRefund
                      ? "JA, ZET LESREFUND KLAAR"
                      : "JA, HANDEL AF ZONDER REFUND"}
                </button>
              </div>
            </section>
          )}

          <div className="mt-12 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            {/* Meldingenlijst */}
            <section className="min-w-0">
              <div className="border-b-2 border-white/20 pb-5">
                <p className="font-display text-lg text-[#FF4B3E]">
                  MELDINGEN
                </p>
                <h2 className="mt-2 font-display text-4xl leading-[0.83] sm:text-5xl">
                  OVERZICHT.
                </h2>

                <div className="mt-5 flex flex-wrap gap-2">
                  {issueFilters.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      disabled={busy}
                      aria-pressed={filter === item.value}
                      onClick={() => changeFilter(item.value)}
                      className={`border-2 px-3 py-2 font-display text-xs transition disabled:opacity-60 ${
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
                    const isSelected = issue.id === selectedIssueId;

                    return (
                      <button
                        key={issue.id}
                        type="button"
                        disabled={busy}
                        aria-pressed={isSelected}
                        onClick={() => openIssue(issue)}
                        className={`w-full border-2 p-4 text-left transition disabled:opacity-60 ${
                          isSelected
                            ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                            : "border-white/25 bg-white/5 text-white hover:border-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-sm">
                              {getIssueTypeLabel(issue.issue_type)}
                            </p>
                            <p
                              className={`mt-1 break-words text-xs ${
                                isSelected
                                  ? "font-semibold text-[#14171A]/80"
                                  : "text-[#B9BEC2]"
                              }`}
                            >
                              {issue.booking?.player_name || "Speler"} ·{" "}
                              {issue.booking?.trainers?.name || "Trainer"}
                            </p>
                            <p className="mt-2 font-display text-[10px]">
                              {issue.booking?.package_purchase_id
                                ? "PAKKETLES"
                                : "LESBOEKING"}
                            </p>
                          </div>

                          <span
                            className={`shrink-0 px-2.5 py-1 font-display text-[10px] ${getIssueStatusClass(issue.status)}`}
                          >
                            {getIssueStatusLabel(issue.status)}
                          </span>
                        </div>

                        <p
                          className={`mt-3 text-[10px] ${
                            isSelected
                              ? "text-[#14171A]/70"
                              : "text-[#8A8F94]"
                          }`}
                        >
                          Gemeld door{" "}
                          {issue.reporter_role === "player"
                            ? "speler"
                            : "trainer"}{" "}
                          · {formatDateTime(issue.created_at)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Detail en besluit */}
            <section className="min-w-0">
              <p className="font-display text-lg text-[#FF4B3E]">
                AFHANDELING
              </p>
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
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-display text-xs text-[#FF4B3E]">
                          {getIssueTypeLabel(selectedIssue.issue_type)}
                        </p>
                        <p className="mt-1 break-words font-display text-2xl">
                          {selectedBooking?.player_name || "SPELER"}{" "}
                          <span className="text-[#D6FF3F]">×</span>{" "}
                          {selectedBooking?.trainers?.name || "TRAINER"}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 px-3 py-1.5 font-display text-xs ${getIssueStatusClass(selectedIssue.status)}`}
                      >
                        {getIssueStatusLabel(selectedIssue.status)}
                      </span>
                    </div>

                    <div className="mt-6 border-y border-white/20 py-4">
                      <p className="font-display text-lg text-[#D6FF3F]">
                        {formatDate(selectedSlot?.starts_at)}
                      </p>
                      <p className="mt-1 font-display text-2xl">
                        {formatTime(selectedSlot?.starts_at)} –{" "}
                        {formatTime(selectedSlot?.ends_at)}
                      </p>

                      {selectedBooking && (
                        <>
                          <p className="mt-3 font-display text-xl text-[#D6FF3F]">
                            {formatEuro(
                              selectedBooking.total_price_cents,
                              selectedBooking.currency
                            )}
                          </p>
                          <p className="mt-1 text-xs text-[#B9BEC2]">
                            {selectedBooking.package_purchase_id
                              ? "Vastgelegd bedrag van deze ene pakketles."
                              : "Vastgelegd bedrag van deze les."}
                          </p>
                          <p className="mt-2 text-xs text-[#B9BEC2]">
                            Boekingsstatus:{" "}
                            <strong>{selectedBooking.status}</strong>
                          </p>
                        </>
                      )}

                      <p className="mt-3 break-all text-[11px] text-[#8A8F94]">
                        Boeking: {selectedIssue.booking_id}
                      </p>

                      {selectedBooking?.package_purchase_id && (
                        <p className="mt-1 break-all text-[11px] text-[#8A8F94]">
                          Pakketaankoop: {selectedBooking.package_purchase_id}
                        </p>
                      )}

                      <p className="mt-1 text-[11px] text-[#8A8F94]">
                        Alle tijden zijn Nederlandse lokale tijden.
                      </p>
                    </div>

                    {selectedSlot?.venue && (
                      <div className="mt-4">
                        <p className="font-display text-xs text-[#FF4B3E]">
                          LOCATIE
                        </p>
                        <p className="mt-1 font-display text-base">
                          {getVenueLabel(selectedSlot.venue)}
                        </p>
                        <p className="mt-1 text-xs text-[#B9BEC2]">
                          {selectedSlot.venue.address_line},{" "}
                          {selectedSlot.venue.postal_code}{" "}
                          {selectedSlot.venue.city}
                        </p>
                      </div>
                    )}

                    <div className="mt-5 border-l-2 border-[#FF4B3E] pl-4">
                      <p className="font-display text-xs text-[#FF4B3E]">
                        MELDING VAN{" "}
                        {selectedIssue.reporter_role === "player"
                          ? "SPELER"
                          : "TRAINER"}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#D7D9DA]">
                        {selectedIssue.description ||
                          "Geen extra toelichting gegeven."}
                      </p>
                    </div>

                    {selectedIssue.status === "open" && (
                      <button
                        type="button"
                        disabled={busy || pendingAction !== null}
                        onClick={() => void markInReview(selectedIssue)}
                        className="mt-6 w-full bg-[#D6FF3F] py-3.5 font-display text-sm text-[#14171A] transition hover:bg-white disabled:opacity-60"
                      >
                        {updatingIssueId === selectedIssue.id
                          ? "BEZIG..."
                          : "IN BEHANDELING NEMEN"}
                      </button>
                    )}

                    {/* Een lopende refund niet als "geen refund" sluiten. */}
                    {isActiveIssue(selectedIssue) &&
                      hasRefundContext(selectedIssue) && (
                        <div className="mt-6 border-2 border-[#D6FF3F] p-4">
                          <p className="font-display text-lg text-[#D6FF3F]">
                            REFUNDAFHANDELING
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-[#D7D9DA]">
                            Voor deze les is een refundbesluit of
                            terugbetalingsstatus vastgelegd. Vraag niet
                            afzonderlijk een nieuwe refund aan en sluit de
                            melding niet als zonder refund.
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
                            Bij een gekoppelde nieuwe refundopdracht wordt de
                            melding na succesvolle administratieve afronding
                            automatisch opgelost. Blijft de melding open of
                            in behandeling, controleer dan de bestaande
                            refundregistratie. Deze pagina toont niet de
                            actuele Stripe-refundstatus.
                          </p>

                          {selectedIssue.resolution_note && (
                            <p className="mt-4 whitespace-pre-wrap break-words border-t border-white/20 pt-3 text-sm text-[#B9BEC2]">
                              {selectedIssue.resolution_note}
                            </p>
                          )}
                        </div>
                      )}

                    {isActiveIssue(selectedIssue) &&
                      !hasRefundContext(selectedIssue) &&
                      !decisionFormVisible && (
                        <div className="mt-6 border border-[#FF4B3E] p-4 text-sm leading-relaxed text-[#D7D9DA]">
                          De gekoppelde boeking ontbreekt of heeft geen
                          ondersteunde betaalde status. Automatische
                          afhandeling is hier niet beschikbaar. Controleer
                          eerst de boeking en eventuele financiële historie.
                        </div>
                      )}

                    {decisionFormVisible && (
                      <div className="mt-6 border-t border-white/20 pt-6">
                        <p className="font-display text-xs text-[#FF4B3E]">
                          KIES BESLUIT
                        </p>

                        <div className="mt-3 grid gap-2">
                          {availableResolutionOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              disabled={busy || pendingAction !== null}
                              aria-pressed={resolutionType === option.value}
                              onClick={() => {
                                clearMessages();
                                setResolutionType(option.value);
                              }}
                              className={`border-2 px-4 py-3 text-left font-display text-xs transition disabled:opacity-60 ${
                                resolutionType === option.value
                                  ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                                  : "border-white/30 text-white hover:border-white"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>

                        <p className="mt-3 text-xs leading-relaxed text-[#8A8F94]">
                          Verplaatsen en Gowtrain-tegoed zijn hier niet als
                          nieuwe actie beschikbaar. Alleen een label
                          opslaan zou de training niet verplaatsen en geen
                          tegoed toekennen.
                        </p>

                        <div className="mt-5">
                          <label
                            htmlFor="resolution-note"
                            className="mb-2 block font-display text-xs text-[#FF4B3E]"
                          >
                            BESLUITTOELICHTING — NIET VERTROUWELIJK
                          </label>

                          <textarea
                            id="resolution-note"
                            rows={5}
                            maxLength={2000}
                            disabled={busy || pendingAction !== null}
                            value={resolutionNote}
                            onChange={(event) => {
                              clearMessages();
                              setResolutionNote(event.target.value);
                            }}
                            aria-describedby="resolution-note-help"
                            placeholder="Leg het besluit uit. Geen vertrouwelijke interne informatie."
                            className="w-full resize-y border-2 border-white/25 bg-transparent px-4 py-3 text-sm text-white outline-none focus:border-[#D6FF3F] disabled:opacity-60"
                          />

                          <p
                            id="resolution-note-help"
                            className="mt-2 text-xs leading-relaxed text-[#B9BEC2]"
                          >
                            Verplicht bij een besluit. Betrokken gebruikers
                            kunnen deze toelichting via hun datatoegang
                            inzien. Gebruik dit veld niet voor interne
                            vertrouwelijke notities.
                          </p>

                          <p className="mt-2 text-right text-xs text-[#8A8F94]">
                            {resolutionNote.length} / 2000 tekens
                          </p>
                        </div>

                        {resolutionType === "full_refund" ? (
                          <button
                            type="button"
                            disabled={busy || pendingAction !== null}
                            onClick={() =>
                              openDecisionConfirmation(selectedIssue, "refund")
                            }
                            className="mt-5 w-full bg-[#FF4B3E] px-4 py-4 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                          >
                            VOLLEDIG LESBEDRAG TERUGBETALEN →
                          </button>
                        ) : (
                          <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            <button
                              type="button"
                              disabled={busy || pendingAction !== null}
                              onClick={() =>
                                openDecisionConfirmation(
                                  selectedIssue,
                                  "resolve_no_refund"
                                )
                              }
                              className="bg-[#D6FF3F] px-4 py-3.5 font-display text-sm text-[#14171A] transition hover:bg-white disabled:opacity-60"
                            >
                              OPLOSSEN ZONDER REFUND
                            </button>
                            <button
                              type="button"
                              disabled={busy || pendingAction !== null}
                              onClick={() =>
                                openDecisionConfirmation(
                                  selectedIssue,
                                  "close_no_refund"
                                )
                              }
                              className="border-2 border-white px-4 py-3.5 font-display text-sm text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
                            >
                              SLUITEN ZONDER REFUND
                            </button>
                          </div>
                        )}

                        <p className="mt-4 text-xs leading-relaxed text-[#8A8F94]">
                          De database controleert bij bevestigen opnieuw de
                          meldingversie, boekingsstatus, bestaande refunds
                          en toepasselijke financiële blokkades.
                        </p>
                      </div>
                    )}

                    {!isActiveIssue(selectedIssue) && (
                      <div className="mt-6 border-t border-white/20 pt-5">
                        <p className="font-display text-xs text-[#8A8F94]">
                          VASTGELEGD BESLUIT
                        </p>

                        <p className="mt-2 font-display text-base text-[#D6FF3F]">
                          {getResolutionLabel(selectedIssue.resolution_type)}
                        </p>

                        {selectedIssue.resolution_type === "full_refund" && (
                          <p className="mt-2 text-xs leading-relaxed text-[#B9BEC2]">
                            Dit is het opgeslagen besluitlabel. De actuele
                            financiële verwerking staat in de
                            refundadministratie.
                          </p>
                        )}

                        {selectedIssue.resolution_note && (
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#B9BEC2]">
                            {selectedIssue.resolution_note}
                          </p>
                        )}

                        <p className="mt-3 text-xs text-[#8A8F94]">
                          Afgehandeld:{" "}
                          {formatDateTime(selectedIssue.resolved_at)}
                        </p>
                      </div>
                    )}

                    <p className="mt-6 break-all border-t border-white/10 pt-3 text-[10px] text-[#8A8F94]">
                      Melding: {selectedIssue.id}
                      <br />
                      Laatst bijgewerkt:{" "}
                      {formatDateTime(selectedIssue.updated_at)}
                    </p>
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