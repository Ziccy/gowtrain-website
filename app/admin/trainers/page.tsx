"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { supabase } from "@/lib/supabase-browser";

type ApprovalStatus = "pending" | "approved" | "rejected";
type TrainerFilter = ApprovalStatus;

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
  created_at: string;
};

type PendingAction =
  | {
      type: "approve";
      trainer: Trainer;
    }
  | {
      type: "reject";
      trainer: Trainer;
    }
  | {
      type: "activate";
      trainer: Trainer;
    }
  | {
      type: "deactivate";
      trainer: Trainer;
    }
  | null;

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
  if (trainer.approval_status === "pending") return "bg-white text-[#14171A]";
  if (trainer.approval_status === "rejected") return "bg-[#FF4B3E] text-white";
  if (!trainer.is_active) return "bg-[#303438] text-white";
  return "bg-[#D6FF3F] text-[#14171A]";
}

export default function AdminTrainersPage() {
  const router = useRouter();

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<TrainerFilter>("pending");

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [updatingTrainerId, setUpdatingTrainerId] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    void loadTrainers();
  }, [selectedFilter]);

  function clearMessages(): void {
    setErrorMessage("");
    setSuccessMessage("");
  }

  async function checkAdmin(): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace("/speler-login");
      return false;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();

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
      setErrorMessage("Geen toegang. Je hebt geen beheerrechten voor deze pagina.");
      router.replace("/speler-login");
      return false;
    }

    return true;
  }

  async function loadTrainers(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
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
      if (showLoading) setLoading(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    clearMessages();
    await loadTrainers(false);
    setRefreshing(false);
  }

  function openConfirmation(
    type: Exclude<PendingAction, null>["type"],
    trainer: Trainer
  ): void {
    clearMessages();
    setPendingAction({ type, trainer });
  }

  function closeConfirmation(): void {
    setPendingAction(null);
  }

  async function updateTrainer(
    trainer: Trainer,
    updates: Partial<Pick<Trainer, "approval_status" | "is_active">>
  ): Promise<void> {
    setUpdatingTrainerId(trainer.id);
    setErrorMessage("");

    try {
      const { data, error } = await supabase
        .from("trainers")
        .update(updates)
        .eq("id", trainer.id)
        .select("id, approval_status, is_active")
        .single();

      if (error || !data) {
        setErrorMessage("De trainer kon niet worden bijgewerkt.");
        return;
      }

      setPendingAction(null);

      if (updates.approval_status === "approved" && updates.is_active) {
        setSuccessMessage(`${trainer.name} is goedgekeurd en staat live op GowTrain.`);
      } else if (updates.approval_status === "rejected") {
        setSuccessMessage(`${trainer.name} is afgekeurd.`);
      } else if (updates.is_active === false) {
        setSuccessMessage(`${trainer.name} is gedeactiveerd.`);
      }

      await loadTrainers(false);
    } catch {
      setErrorMessage("De trainer kon niet worden bijgewerkt.");
    } finally {
      setUpdatingTrainerId(null);
    }
  }

  async function confirmAction(): Promise<void> {
    if (!pendingAction) return;

    const { type, trainer } = pendingAction;

    if (type === "approve" || type === "activate") {
      await updateTrainer(trainer, {
        approval_status: "approved",
        is_active: true,
      });
      return;
    }

    if (type === "reject") {
      await updateTrainer(trainer, {
        approval_status: "rejected",
        is_active: false,
      });
      return;
    }

    await updateTrainer(trainer, {
      is_active: false,
    });
  }

  function getConfirmationTitle(): string {
    if (!pendingAction) return "";
    if (pendingAction.type === "approve") return "TRAINER GOEDKEUREN?";
    if (pendingAction.type === "reject") return "TRAINER AFKEUREN?";
    if (pendingAction.type === "activate") return "TRAINER ACTIVEREN?";
    return "TRAINER DEACTIVEREN?";
  }

  function getConfirmationText(): string {
    if (!pendingAction) return "";
    const trainerName = pendingAction.trainer.name;

    if (pendingAction.type === "approve") {
      return `${trainerName} wordt zichtbaar voor spelers en kan slots toevoegen en boekingen ontvangen.`;
    }
    if (pendingAction.type === "reject") {
      return `${trainerName} wordt afgekeurd en blijft verborgen voor spelers.`;
    }
    if (pendingAction.type === "activate") {
      return `${trainerName} wordt opnieuw zichtbaar voor spelers.`;
    }
    return `${trainerName} wordt tijdelijk verborgen voor spelers. Bestaande boekingen blijven behouden.`;
  }

  function getConfirmationButtonLabel(): string {
    if (!pendingAction) return "";
    if (pendingAction.type === "approve") return "GOEDKEUREN";
    if (pendingAction.type === "reject") return "AFKEUREN";
    if (pendingAction.type === "activate") return "ACTIVEREN";
    return "DEACTIVEREN";
  }

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#14171A] px-5 text-white">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="font-display text-5xl text-[#D6FF3F] sm:text-6xl">GOWTRAIN</span>
            <span className="h-0 w-0 animate-pulse border-b-[14px] border-l-[12px] border-t-[14px] border-b-transparent border-l-[#D6FF3F] border-t-transparent" />
          </div>
          <p className="mt-4 font-display text-sm tracking-widest text-[#FF4B3E]">TRAINERS LADEN...</p>
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
                ADMIN · TRAINERS
              </p>

              <h1 className="mt-2 font-display text-5xl leading-[0.83] sm:text-6xl lg:text-7xl">
                BEHEER<br />TRAINERS.
              </h1>

              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#D7D9DA]">
                Beoordeel nieuwe traineraanmeldingen en beheer actieve trainerprofielen.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/admin"
                className="inline-flex border-2 border-white px-4 py-2.5 font-display text-xs text-white hover:border-[#D6FF3F] hover:text-[#D6FF3F] transition"
              >
                ← ADMIN HUB
              </Link>

              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="border-2 border-white px-4 py-2.5 font-display text-xs text-white transition hover:border-[#D6FF3F] hover:text-[#D6FF3F] disabled:opacity-60"
              >
                {refreshing ? "VERVERSEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-8 flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  clearMessages();
                  setPendingAction(null);
                  setSelectedFilter(filter.value);
                }}
                className={`border-2 px-4 py-3 font-display text-sm transition ${
                  selectedFilter === filter.value
                    ? "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
                    : "border-white/30 text-white hover:border-white"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {errorMessage && (
            <div role="alert" className="mt-6 border-2 border-[#FF4B3E] bg-[#FF4B3E] px-5 py-4 font-semibold text-white">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div role="status" className="mt-6 border-2 border-[#D6FF3F] bg-[#D6FF3F] px-5 py-4 font-semibold text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]">
              {successMessage}
            </div>
          )}

          {/* Confirmation */}
          {pendingAction && (
            <section
              className={`mt-6 border-2 p-5 sm:p-6 shadow-[6px_6px_0_0_#14171A] ${
                pendingAction.type === "reject" || pendingAction.type === "deactivate"
                  ? "border-[#FF4B3E] bg-[#FF4B3E] text-white"
                  : "border-[#D6FF3F] bg-[#D6FF3F] text-[#14171A]"
              }`}
            >
              <p className="font-display text-3xl">
                {getConfirmationTitle()}
              </p>

              <p className="mt-3 max-w-2xl text-sm leading-relaxed">
                {getConfirmationText()}
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closeConfirmation}
                  className={`px-5 py-3 font-display text-base transition ${
                    pendingAction.type === "reject" || pendingAction.type === "deactivate"
                      ? "border-2 border-white text-white hover:bg-white hover:text-[#14171A]"
                      : "border-2 border-[#14171A] text-[#14171A] hover:bg-[#14171A] hover:text-white"
                  }`}
                >
                  TERUG
                </button>

                <button
                  type="button"
                  disabled={updatingTrainerId === pendingAction.trainer.id}
                  onClick={() => void confirmAction()}
                  className="bg-[#14171A] px-5 py-3 font-display text-base text-white transition hover:bg-white hover:text-[#14171A] disabled:opacity-60"
                >
                  {updatingTrainerId === pendingAction.trainer.id
                    ? "BEZIG..."
                    : getConfirmationButtonLabel()}
                </button>
              </div>
            </section>
          )}

          <div className="mt-10 flex items-end justify-between border-b-2 border-white/20 pb-5">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">OVERZICHT</p>
              <h2 className="mt-1 font-display text-4xl sm:text-5xl">
                {filters.find((filter) => filter.value === selectedFilter)?.label ?? "TRAINERS"}.
              </h2>
            </div>

            <p className="font-display text-lg text-[#D6FF3F]">
              {trainers.length} {trainers.length === 1 ? "TRAINER" : "TRAINERS"}
            </p>
          </div>

          {trainers.length === 0 ? (
            <section className="mt-8 border-2 border-white bg-white p-3 text-[#14171A] shadow-[8px_8px_0_0_#D6FF3F]">
              <div className="bg-[#14171A] p-6 text-white sm:p-8">
                <p className="font-display text-4xl text-[#D6FF3F]">GEEN TRAINERS.</p>
                <p className="mt-3 max-w-xl text-base leading-relaxed text-[#B9BEC2]">
                  {selectedFilter === "pending"
                    ? "Nieuwe traineraanmeldingen verschijnen hier zodra ze binnenkomen."
                    : "Er zijn geen trainers binnen dit overzicht."}
                </p>
              </div>
            </section>
          ) : (
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {trainers.map((trainer) => {
                const isUpdating = updatingTrainerId === trainer.id;

                return (
                  <article
                    key={trainer.id}
                    className="border-2 border-white bg-white p-3 text-[#14171A] shadow-[6px_6px_0_0_#FF4B3E]"
                  >
                    <div className="bg-[#14171A] p-5 text-white flex flex-col justify-between h-full">
                      <div>
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
                              <p className="font-display text-3xl leading-[0.9]">
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

                        <div className="mt-6 grid grid-cols-2 gap-4 border-y border-white/20 py-4 text-xs">
                          <div>
                            <p className="font-display text-[10px] text-[#8A8F94]">LOCATIE</p>
                            <p className="mt-1 text-white font-semibold">
                              {trainer.city ?? "Geen stad"}{trainer.province ? ` · ${trainer.province}` : ""}
                            </p>
                          </div>

                          <div className="border-l border-white/20 pl-4">
                            <p className="font-display text-[10px] text-[#8A8F94]">TARIEF</p>
                            <p className="mt-1 font-display text-xl text-[#D6FF3F]">
                              €{Number(trainer.price_per_hour).toFixed(0)} / u
                            </p>
                          </div>

                          <div>
                            <p className="font-display text-[10px] text-[#8A8F94]">WERKGEBIED</p>
                            <p className="mt-1 text-white font-semibold">
                              {trainer.radius_km ? `${trainer.radius_km} KM` : "Niet ingevuld"}
                            </p>
                          </div>

                          <div className="border-l border-white/20 pl-4">
                            <p className="font-display text-[10px] text-[#8A8F94]">AANGEMELD</p>
                            <p className="mt-1 text-white font-semibold">
                              {formatDate(trainer.created_at)}
                            </p>
                          </div>
                        </div>

                        {trainer.bio ? (
                          <div className="mt-4 border-l-2 border-[#D6FF3F] pl-3">
                            <p className="text-xs italic text-[#D7D9DA] line-clamp-3">
                              "{trainer.bio}"
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {/* ACTIES */}
                      <div className="mt-6 pt-2">
                        {trainer.approval_status === "pending" && (
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => openConfirmation("approve", trainer)}
                              className="bg-[#D6FF3F] px-4 py-3 font-display text-sm text-[#14171A] hover:bg-white disabled:opacity-60"
                            >
                              {isUpdating ? "..." : "GOEDKEUREN. GOW!"}
                            </button>

                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => openConfirmation("reject", trainer)}
                              className="border-2 border-[#FF4B3E] px-4 py-3 font-display text-sm text-[#FF4B3E] hover:bg-[#FF4B3E] hover:text-white disabled:opacity-60"
                            >
                              AFKEUREN
                            </button>
                          </div>
                        )}

                        {trainer.approval_status === "rejected" && (
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => openConfirmation("approve", trainer)}
                            className="w-full bg-[#D6FF3F] px-4 py-3.5 font-display text-sm text-[#14171A] hover:bg-white disabled:opacity-60"
                          >
                            {isUpdating ? "..." : "ALSNOG GOEDKEUREN"}
                          </button>
                        )}

                        {trainer.approval_status === "approved" && (
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() =>
                              openConfirmation(
                                trainer.is_active ? "deactivate" : "activate",
                                trainer
                              )
                            }
                            className={`w-full px-4 py-3.5 font-display text-sm transition disabled:opacity-60 ${
                              trainer.is_active
                                ? "border-2 border-[#FF4B3E] text-[#FF4B3E] hover:bg-[#FF4B3E] hover:text-white"
                                : "bg-[#D6FF3F] text-[#14171A] hover:bg-white"
                            }`}
                          >
                            {isUpdating
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