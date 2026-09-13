"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type ApprovalStatus = "pending" | "approved" | "rejected";
type TrainerFilter = ApprovalStatus;
type ActionType = "approve" | "reject" | "activate" | "deactivate";

type Trainer = {
  id: string;
  user_id: string | null;
  initials: string;
  name: string;
  sport: string;
  focus: string;
  bio: string | null;
  city: string | null;
  province: string | null;
  radius_km: number | null;
  price_per_hour: number;
  image_url: string | null;
  is_active: boolean;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
};

type PendingAction = {
  type: ActionType;
  trainer: Trainer;
} | null;

type TrainerUpdates = Partial<
  Pick<
    Trainer,
    "approval_status" | "is_active" | "rejection_reason"
  >
>;

const MAX_REJECTION_REASON_LENGTH = 2000;

const filters: { label: string; value: TrainerFilter }[] = [
  { label: "WACHTEND", value: "pending" },
  { label: "GOEDGEKEURD", value: "approved" },
  { label: "AFGEKEURD", value: "rejected" },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(new Date(value))
    .toUpperCase();
}

function getTrainerInitials(trainer: Trainer): string {
  if (trainer.initials?.trim()) {
    return trainer.initials.trim().toUpperCase();
  }

  const parts = trainer.name.trim().split(" ").filter(Boolean);

  if (parts.length === 0) return "GT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getStatusLabel(trainer: Trainer): string {
  if (trainer.approval_status === "pending") return "WACHTEND";
  if (trainer.approval_status === "rejected") return "AFGEKEURD";
  if (!trainer.is_active) return "INACTIEF";
  return "GOEDGEKEURD";
}

function getStatusClass(trainer: Trainer): string {
  if (trainer.approval_status === "pending") {
    return "bg-white text-[#14171A]";
  }

  if (trainer.approval_status === "rejected") {
    return "bg-[#FF4B3E] text-white";
  }

  if (!trainer.is_active) {
    return "bg-[#303438] text-white";
  }

  return "bg-[#D6FF3F] text-[#14171A]";
}

export default function AdminTrainersPage() {
  const router = useRouter();

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [selectedFilter, setSelectedFilter] =
    useState<TrainerFilter>("pending");

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [updatingTrainerId, setUpdatingTrainerId] =
  useState<string | null>(null);

  const [pendingAction, setPendingAction] =
  useState<PendingAction>(null);

  const [rejectionReason, setRejectionReason] = useState<string>("");
  const [rejectionReasonError, setRejectionReasonError] =
    useState<string>("");

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const isUpdating = updatingTrainerId !== null;
  const controlsDisabled = isUpdating || refreshing;

  useEffect(() => {
    void loadTrainers();
  }, [selectedFilter]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
    setRejectionReasonError("");
  }

  async function checkAdmin(): Promise<boolean> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace("/speler-login");
      return false;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      router.replace("/speler-login");
      return false;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || profile?.role !== "admin") {
      await supabase.auth.signOut();

      setErrorMessage(
        "Geen toegang. Je hebt geen beheerrechten voor deze pagina."
      );

      router.replace("/speler-login");
      return false;
    }

    return true;
  }

  async function loadTrainers(showLoading = true): Promise<void> {
    if (showLoading) {
      setLoading(true);
    }

    setErrorMessage("");

    try {
      const isAdmin = await checkAdmin();

      if (!isAdmin) {
        setTrainers([]);
        return;
      }

      const { data, error } = await supabase
        .from("trainers")
        .select(
          `
            id,
            user_id,
            initials,
            name,
            sport,
            focus,
            bio,
            city,
            province,
            radius_km,
            price_per_hour,
            image_url,
            is_active,
            approval_status,
            rejection_reason,
            created_at
          `
        )
        .eq("approval_status", selectedFilter)
        .order("created_at", { ascending: false });

      if (error) {
        setErrorMessage("De trainers konden niet worden geladen.");
        setTrainers([]);
        return;
      }

      setTrainers((data ?? []) as Trainer[]);
    } catch {
      setErrorMessage("De trainers konden niet worden geladen.");
      setTrainers([]);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  async function handleRefresh(): Promise<void> {
    if (controlsDisabled) return;

    setRefreshing(true);
    clearMessages();

    try {
      await loadTrainers(false);
    } finally {
      setRefreshing(false);
    }
  }

  function openConfirmation(
    type: ActionType,
    trainer: Trainer
  ): void {
    if (controlsDisabled) return;

    clearMessages();

    setRejectionReason(
      type === "reject" ? trainer.rejection_reason ?? "" : ""
    );

    setPendingAction({ type, trainer });
  }

  function closeConfirmation(): void {
    if (isUpdating) return;

    setPendingAction(null);
    setRejectionReason("");
    setRejectionReasonError("");
  }

  function changeFilter(nextFilter: TrainerFilter): void {
    if (controlsDisabled) return;

    clearMessages();
    setPendingAction(null);
    setRejectionReason("");
    setSelectedFilter(nextFilter);
  }

  async function updateTrainer(
    trainer: Trainer,
    updates: TrainerUpdates
  ): Promise<void> {
    setUpdatingTrainerId(trainer.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const { data, error } = await supabase
        .from("trainers")
        .update(updates)
        .eq("id", trainer.id)
        .select("id, approval_status, is_active, rejection_reason")
        .single();

      if (error || !data) {
        setErrorMessage(
          "De trainer kon niet worden bijgewerkt. Probeer het opnieuw."
        );
        return;
      }

      setPendingAction(null);
      setRejectionReason("");
      setRejectionReasonError("");

      if (updates.approval_status === "rejected") {
        setSuccessMessage(
          `${trainer.name} is afgekeurd. De toelichting is opgeslagen.`
        );
      } else if (
        updates.approval_status === "approved" &&
        updates.is_active === true
      ) {
        if (trainer.approval_status === "approved") {
          setSuccessMessage(
            `${trainer.name} is opnieuw geactiveerd op Gowtrain.`
          );
        } else {
          setSuccessMessage(
            `${trainer.name} is goedgekeurd en staat live op Gowtrain.`
          );
        }
      } else if (updates.is_active === false) {
        setSuccessMessage(
          `${trainer.name} is gedeactiveerd.`
        );
      }

      await loadTrainers(false);
    } catch {
      setErrorMessage(
        "De trainer kon niet worden bijgewerkt. Probeer het opnieuw."
      );
    } finally {
      setUpdatingTrainerId(null);
    }
  }

  async function confirmAction(): Promise<void> {
    if (!pendingAction || controlsDisabled) return;

    clearMessages();

    const { type, trainer } = pendingAction;

    if (type === "approve" || type === "activate") {
      await updateTrainer(trainer, {
        approval_status: "approved",
        is_active: true,
        rejection_reason: null,
      });
      return;
    }

    if (type === "reject") {
      const reason = rejectionReason.trim();

      if (!reason) {
        setRejectionReasonError(
          "Vul een toelichting in voordat je de trainer afwijst."
        );
        return;
      }

      if (reason.length > MAX_REJECTION_REASON_LENGTH) {
        setRejectionReasonError(
          `De toelichting mag maximaal ${MAX_REJECTION_REASON_LENGTH} tekens bevatten.`
        );
        return;
      }

      await updateTrainer(trainer, {
        approval_status: "rejected",
        is_active: false,
        rejection_reason: reason,
      });
      return;
    }

    await updateTrainer(trainer, {
      is_active: false,
    });
  }

  function getConfirmationTitle(): string {
    if (!pendingAction) return "";

    switch (pendingAction.type) {
      case "approve":
        return "TRAINER GOEDKEUREN?";
      case "reject":
        return "TRAINER AFKEUREN?";
      case "activate":
        return "TRAINER ACTIVEREN?";
      case "deactivate":
        return "TRAINER DEACTIVEREN?";
    }
  }

  function getConfirmationText(): string {
    if (!pendingAction) return "";

    const trainerName = pendingAction.trainer.name;

    switch (pendingAction.type) {
      case "approve":
        return `${trainerName} wordt zichtbaar voor spelers en kan slots toevoegen en boekingen ontvangen. Een eventueel opgeslagen afwijzingstoelichting wordt verwijderd.`;

      case "reject":
        return `${trainerName} wordt afgekeurd en blijft verborgen voor spelers. Vul hieronder de toelichting voor de trainer in.`;

      case "activate":
        return `${trainerName} wordt opnieuw zichtbaar voor spelers.`;

      case "deactivate":
        return `${trainerName} wordt tijdelijk verborgen voor spelers. Bestaande boekingen blijven behouden.`;
    }
  }

  function getConfirmationButtonLabel(): string {
    if (!pendingAction) return "";

    switch (pendingAction.type) {
      case "approve":
        return "GOEDKEUREN";
      case "reject":
        return "AFKEUREN EN OPSLAAN";
      case "activate":
        return "ACTIVEREN";
      case "deactivate":
        return "DEACTIVEREN";
    }
  }

  const isDestructiveAction =
    pendingAction?.type === "reject" ||
    pendingAction?.type === "deactivate";

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
            TRAINERS LADEN...
          </p>
        </div>
      </main>
    );
  }

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
          {/* PAGINAKOP */}
          <div className="flex flex-col justify-between gap-6 border-b-2 border-white/20 pb-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                ADMIN · TRAINERS
              </p>

              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                BEHEER
                <br />
                TRAINERS.
              </h1>

              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Beoordeel nieuwe traineraanmeldingen en beheer actieve
                trainerprofielen.
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
                disabled={controlsDisabled}
                className="border-2 border-white px-4 py-2.5 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          {/* FILTERS */}
          <div className="mt-8 flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                disabled={controlsDisabled}
                onClick={() => changeFilter(filter.value)}
                aria-pressed={selectedFilter === filter.value}
                className={`border-2 px-4 py-3 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  selectedFilter === filter.value
                    ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                    : "border-white/30 text-white hover:border-white"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* MELDINGEN */}
          {errorMessage && (
            <div
              role="alert"
              className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white"
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
            >
              {successMessage}
            </div>
          )}

          {/* ACTIE BEVESTIGEN */}
          {pendingAction && (
            <section
              aria-labelledby="trainer-action-title"
              className={`mt-6 border-2 p-5 shadow-[6px_6px_0_0_#14171A] sm:p-6 ${
                isDestructiveAction
                  ? "border-[#FF4B3E] bg-[#FF4B3E] text-white"
                  : "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
              }`}
            >
              <h2
                id="trainer-action-title"
                className="font-display text-3xl"
              >
                {getConfirmationTitle()}
              </h2>

              <p className="mt-3 max-w-2xl text-sm leading-relaxed">
                {getConfirmationText()}
              </p>

              {/* TOELICHTING BIJ AFWIJZING */}
              {pendingAction.type === "reject" && (
                <div className="mt-6">
                  <label
                    htmlFor="rejection-reason"
                    className="block font-display text-lg text-white"
                  >
                    TOELICHTING VOOR DE TRAINER
                  </label>

                  <p
                    id="rejection-reason-help"
                    className="mt-2 max-w-2xl text-sm leading-relaxed text-white"
                  >
                    Deze toelichting is bestemd voor de afwijzingsmail
                    aan de trainer. Schrijf duidelijk en respectvol.
                    Gebruik dit veld niet voor interne notities.
                  </p>

                  <textarea
                    id="rejection-reason"
                    value={rejectionReason}
                    onChange={(event) => {
                      setRejectionReason(event.target.value);
                      setRejectionReasonError("");
                    }}
                    rows={5}
                    maxLength={MAX_REJECTION_REASON_LENGTH}
                    required
                    disabled={isUpdating}
                    aria-invalid={Boolean(rejectionReasonError)}
                    aria-describedby={[
                      "rejection-reason-help",
                      "rejection-reason-count",
                      rejectionReasonError
                        ? "rejection-reason-error"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    placeholder="Leg uit waarom je deze aanmelding afwijst. Geef waar mogelijk aan wat de trainer kan verbeteren."
                    className="mt-3 w-full resize-y border-2 border-white bg-[#14171A] px-4 py-4 text-base leading-relaxed text-white outline-none placeholder:text-[#B9BEC2] focus:border-[#D6FF3F] disabled:opacity-60"
                  />

                  <p
                    id="rejection-reason-count"
                    className="mt-2 text-right text-xs text-white"
                  >
                    {rejectionReason.length} /{" "}
                    {MAX_REJECTION_REASON_LENGTH} tekens
                  </p>

                  {rejectionReasonError && (
                    <p
                      id="rejection-reason-error"
                      role="alert"
                      className="mt-3 border-2 border-white bg-[#14171A] px-4 py-3 text-sm font-semibold text-white"
                    >
                      {rejectionReasonError}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeConfirmation}
                  disabled={isUpdating}
                  className={`px-5 py-3 font-display text-base transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isDestructiveAction
                      ? "border-2 border-white text-white hover:bg-white hover:text-[#14171A]"
                      : "border-2 border-[#14171A] text-[#14171A] hover:bg-[#14171A] hover:text-white"
                  }`}
                >
                  TERUG
                </button>

                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => void confirmAction()}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUpdating
                    ? "BEZIG..."
                    : getConfirmationButtonLabel()}
                </button>
              </div>
            </section>
          )}

          {/* OVERZICHTSKOP */}
          <div className="mt-10 flex items-end justify-between border-b-2 border-white/20 pb-5">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                OVERZICHT
              </p>

              <h2 className="mt-1 font-display text-4xl sm:text-5xl">
                {filters.find(
                  (filter) => filter.value === selectedFilter
                )?.label ?? "TRAINERS"}
                .
              </h2>
            </div>

            <p className="font-display text-lg text-[#D6FF3F]">
              {trainers.length}{" "}
              {trainers.length === 1 ? "TRAINER" : "TRAINERS"}
            </p>
          </div>

          {/* LEEG OVERZICHT */}
          {trainers.length === 0 ? (
            <section className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-6 text-white sm:p-8">
                <p className="font-display text-4xl text-[#D6FF3F]">
                  GEEN TRAINERS.
                </p>

                <p className="mt-3 max-w-xl text-base leading-relaxed text-[#B9BEC2]">
                  {selectedFilter === "pending"
                    ? "Nieuwe traineraanmeldingen verschijnen hier zodra ze binnenkomen."
                    : "Er zijn geen trainers binnen dit overzicht."}
                </p>
              </div>
            </section>
          ) : (
            /* TRAINERKAARTEN */
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {trainers.map((trainer) => {
                const trainerIsUpdating =
                  updatingTrainerId === trainer.id;

                return (
                  <article
                    key={trainer.id}
                    className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                  >
                    <div className="flex h-full flex-col justify-between bg-[#14171A] p-5 text-white">
                      <div>
                        {/* NAAM, FOTO EN STATUS */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-4">
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#D6FF3F] bg-[#14171A]">
                              {trainer.image_url ? (
                                <img
                                  src={trainer.image_url}
                                  alt={`Profielfoto van ${trainer.name}`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="font-display text-xl text-[#D6FF3F]">
                                  {getTrainerInitials(trainer)}
                                </span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="break-words font-display text-3xl leading-[0.9]">
                                {trainer.name}
                              </p>

                              <p className="mt-2 text-xs text-[#B9BEC2]">
                                {trainer.sport} · {trainer.focus}
                              </p>
                            </div>
                          </div>

                          <span
                            className={`shrink-0 px-3 py-1.5 font-display text-xs ${getStatusClass(
                              trainer
                            )}`}
                          >
                            {getStatusLabel(trainer)}
                          </span>
                        </div>

                        {/* TRAINERGEGEVENS */}
                        <div className="mt-6 grid grid-cols-2 gap-4 border-y border-white/20 py-4 text-xs">
                          <div>
                            <p className="font-display text-[10px] text-[#8A8F94]">
                              LOCATIE
                            </p>

                            <p className="mt-1 font-semibold text-white">
                              {trainer.city ?? "Geen stad"}
                              {trainer.province
                                ? ` · ${trainer.province}`
                                : ""}
                            </p>
                          </div>

                          <div className="border-l border-white/20 pl-4">
                            <p className="font-display text-[10px] text-[#8A8F94]">
                              TARIEF
                            </p>

                            <p className="mt-1 font-display text-xl text-[#D6FF3F]">
                              €
                              {Number(
                                trainer.price_per_hour
                              ).toFixed(0)}{" "}
                              / u
                            </p>
                          </div>

                          <div>
                            <p className="font-display text-[10px] text-[#8A8F94]">
                              WERKGEBIED
                            </p>

                            <p className="mt-1 font-semibold text-white">
                              {trainer.radius_km
                                ? `${trainer.radius_km} KM`
                                : "Niet ingevuld"}
                            </p>
                          </div>

                          <div className="border-l border-white/20 pl-4">
                            <p className="font-display text-[10px] text-[#8A8F94]">
                              AANGEMELD
                            </p>

                            <p className="mt-1 font-semibold text-white">
                              {formatDate(trainer.created_at)}
                            </p>
                          </div>
                        </div>

                        {/* BIO */}
                        {trainer.bio && (
                          <div className="mt-4 border-l-2 border-[#D6FF3F] pl-3">
                            <p className="line-clamp-3 text-xs italic text-[#D7D9DA]">
                              &ldquo;{trainer.bio}&rdquo;
                            </p>
                          </div>
                        )}

                        {/* OPGESLAGEN AFWIJZINGSTOELICHTING */}
                        {trainer.approval_status === "rejected" && (
                          <div className="mt-5 border-l-2 border-[#FF4B3E] bg-white/5 p-4">
                            <p className="font-display text-sm text-[#FF4B3E]">
                              TOELICHTING BIJ AFWIJZING
                            </p>

                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#D7D9DA]">
                              {trainer.rejection_reason?.trim() ||
                                "Bij deze eerdere afwijzing is geen toelichting opgeslagen."}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* ACTIES */}
                      <div className="mt-6 pt-2">
                        {trainer.approval_status === "pending" && (
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              disabled={controlsDisabled}
                              onClick={() =>
                                openConfirmation("approve", trainer)
                              }
                              className="bg-[#D6FF3F] px-4 py-3 font-display text-sm text-[#14171A] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {trainerIsUpdating
                                ? "..."
                                : "GOEDKEUREN. GOW!"}
                            </button>

                            <button
                              type="button"
                              disabled={controlsDisabled}
                              onClick={() =>
                                openConfirmation("reject", trainer)
                              }
                              className="border-2 border-[#FF4B3E] px-4 py-3 font-display text-sm text-[#FF4B3E] transition hover:bg-[#FF4B3E] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              AFKEUREN
                            </button>
                          </div>
                        )}

                        {trainer.approval_status === "rejected" && (
                          <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={() =>
                              openConfirmation("approve", trainer)
                            }
                            className="w-full bg-[#D6FF3F] px-4 py-3.5 font-display text-sm text-[#14171A] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {trainerIsUpdating
                              ? "..."
                              : "ALSNOG GOEDKEUREN"}
                          </button>
                        )}

                        {trainer.approval_status === "approved" && (
                          <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={() =>
                              openConfirmation(
                                trainer.is_active
                                  ? "deactivate"
                                  : "activate",
                                trainer
                              )
                            }
                            className={`w-full px-4 py-3.5 font-display text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              trainer.is_active
                                ? "border-2 border-[#FF4B3E] text-[#FF4B3E] hover:bg-[#FF4B3E] hover:text-white"
                                : "bg-[#D6FF3F] text-[#14171A] hover:bg-white"
                            }`}
                          >
                            {trainerIsUpdating
                              ? "..."
                              : trainer.is_active
                                ? "DEACTIVEER TRAINER"
                                : "ACTIVEER TRAINER"}
                          </button>
                        )}
                      </div>
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