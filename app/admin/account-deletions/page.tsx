"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AccountDeletionFollowup from "@/components/AccountDeletionFollowup";
import AccountDeletionQueueRecovery from "@/components/AccountDeletionQueueRecovery";
import AccountDeletionPostAuthRecovery from "@/components/AccountDeletionPostAuthRecovery";
import AccountDeletionResume from "@/components/AccountDeletionResume";
import { supabase } from "@/lib/supabase-browser";

type Queue = {
  request_id: string;
  status: string;
  queued_at: string;
  claimed_at: string | null;
  finished_at: string | null;
};

type Execution = {
  request_id: string;
  created_at: string;
  trainer_cleaned_at: string | null;
  database_cleaned_at: string | null;
  auth_delete_started_at: string | null;
  auth_deleted_at: string | null;
  local_completed_at: string | null;
  target_reference_erased_at: string | null;
};

type DeletionItem = {
  id: string;
  requester_role: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
  auxiliary_cleaned_at: string | null;
  queue: Queue | null;
  execution: Execution | null;
  externalTaskCount: number;
  followup: {
  assigned: boolean;
  assignedToCurrentAdmin: boolean;
  nextAction: string;
  reviewAfter: string;
  version: number;
  updatedAt: string;
} | null;
};

type Detail = {
  requestId: string;
  assessment: {
    outcome: string;
    reasons: string[];
    counts: Record<string, number>;
  } | null;
  assessmentNote: string;
  externalTasks: Array<{ status: string; count: number }>;
  checkedAt: string;
};

const LABELS: Record<string, string> = {
  requested: "Aangevraagd",
  in_progress: "Uitvoering gestart",
  queued: "Wacht op verwerking",
  claimed: "Geclaimd door worker",
  needs_review: "Aanvullende afhandeling",
  completed: "Afgerond",
  pending: "Openstaand",
};

const FOLLOWUP_ACTION_LABELS: Record<string, string> = {
  assess_dependencies: "Afhankelijkheden beoordelen",
  review_external_data: "Externe gegevensafhandeling beoordelen",
  review_worker_progress: "Worker en uitvoervoortgang onderzoeken",
  await_resolution: "Wachten op noodzakelijke afhandeling",
};

function label(value: string): string {
  return LABELS[value] ?? value;
}

function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "Niet vastgelegd";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

function latestPhase(item: DeletionItem): string {
  const execution = item.execution;

  if (item.status === "completed") return "Verzoek afgerond";
  if (execution?.target_reference_erased_at) {
    return "Technische referentie gewist";
  }
  if (execution?.local_completed_at) return "Lokale eindcontrole afgerond";
  if (execution?.auth_deleted_at) return "Auth-afwezigheid bevestigd";
  if (execution?.auth_delete_started_at) {
    return "Auth-verwijderfase gestart; uitkomst nog niet bevestigd";
  }
  if (execution?.database_cleaned_at) return "Database-opruiming bevestigd";
  if (execution?.trainer_cleaned_at) return "Trainerfase bevestigd";
  if (item.auxiliary_cleaned_at) return "Aanvullende opruiming bevestigd";
  if (execution) return "Uitvoerregistratie aangemaakt";
  if (item.queue?.claimed_at) return "Worker heeft opdracht geclaimd";
  if (item.queue) return "Opdracht in wachtrij";
  return "Alleen verzoek geregistreerd";
}

async function getAdminData(url: string): Promise<unknown> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Log in met je beheeraccount.");
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "De aanvraag kon niet worden bevestigd."
    );
  }

  return body;
}

export default function AdminAccountDeletionsPage() {
  const [items, setItems] = useState<DeletionItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [now, setNow] = useState(Date.now());

  const listSequence = useRef(0);
  const detailSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++listSequence.current;

    // Details horen bij hun eigen ophaalmoment.
    detailSequence.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);

    setLoading(true);
    setError("");
    setItems([]);
    setHasMore(false);
    setCheckedAt(null);

    try {
      const body = await getAdminData(
        `/api/admin/account-deletions?page=${page}`
      ) as {
        items?: DeletionItem[];
        hasMore?: boolean;
        checkedAt?: string;
      };

      if (sequence !== listSequence.current) return;

      if (
        !Array.isArray(body.items) ||
        typeof body.hasMore !== "boolean" ||
        typeof body.checkedAt !== "string"
      ) {
        throw new Error("Het overzicht heeft een onverwacht formaat.");
      }

      setItems(body.items);
      setHasMore(body.hasMore);
      setCheckedAt(body.checkedAt);
      setNow(Date.now());
    } catch (error: unknown) {
      if (sequence === listSequence.current) {
        setError(
          error instanceof Error
            ? error.message
            : "Het overzicht kon niet worden geladen."
        );
      }
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();

    return () => {
      listSequence.current += 1;
      detailSequence.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function openDetails(id: string) {
    const sequence = ++detailSequence.current;

    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }

    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);

    try {
      const body = await getAdminData(
        `/api/admin/account-deletions?requestId=${encodeURIComponent(id)}`
      ) as Detail;

      if (sequence !== detailSequence.current) return;

      if (
        body.requestId !== id ||
        typeof body.assessmentNote !== "string" ||
        !Array.isArray(body.externalTasks)
      ) {
        throw new Error("De details hebben een onverwacht formaat.");
      }

      setDetail(body);
    } catch (error: unknown) {
      if (sequence === detailSequence.current) {
        setDetailError(
          error instanceof Error
            ? error.message
            : "De details konden niet worden geladen."
        );
      }
    } finally {
      if (sequence === detailSequence.current) {
        setDetailLoading(false);
      }
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#14171A] text-white">
      <SiteHeader />

      <section className="flex-1 py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-5 border-b-2 border-white/20 pb-7">
            <div>
              <p className="font-display text-lg text-[#FF4B3E]">
                ADMIN · ACCOUNTVERWIJDERINGEN
              </p>

              <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
                VERZOEKEN &amp; VOORTGANG.
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#B9BEC2]">
                Inspecteer verzoeken en uitvoerfasen. Deze pagina start,
                herhaalt of annuleert geen verwijderingen.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="inline-flex min-h-11 items-center border-2 border-white/40 px-4 py-3 font-display text-sm"
              >
                ← ADMIN HUB
              </Link>

              <button
                type="button"
                disabled={loading}
                onClick={() => void load()}
                className="min-h-11 bg-[#D6FF3F] px-5 py-3 font-display text-sm text-[#14171A] disabled:opacity-50"
              >
                {loading ? "LADEN..." : "↻ VERVERS"}
              </button>
            </div>
          </div>

          <div className="mt-6 border border-white/20 p-4 text-sm leading-relaxed text-[#B9BEC2]">
            <p>
  <strong className="text-white">
    Inspectie en opvolging.
  </strong>{" "}
  Je kunt werkafspraken vastleggen en ondersteunde afrondingsfouten
laten herstellen. De herstelacties doen geen nieuwe
Auth-verwijderaanroep en starten geen worker opnieuw. Een oude claim
bewijst niet dat de worker gestopt is. Zet een opdracht niet
handmatig terug op queued.
</p>

<p className="mt-2">
  Opvolglabels gelden per verzoek en zijn geen automatische
  herinneringen. Dit overzicht toont maximaal twintig verzoeken
  per pagina; controleer ook eventuele volgende pagina’s.
</p>
            <p className="mt-2">
              Automatische trainerverwijdering is nog niet aangesloten.
              Een trainer kan daarom aanvullende afhandeling nodig hebben,
              ook als de databasebeoordeling weinig afhankelijkheden vindt.
            </p>
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-6 border-2 border-[#FF4B3E] p-4 text-sm"
            >
              {error}
            </div>
          ) : null}

          {checkedAt ? (
            <p className="mt-5 text-xs text-[#8A8F94]">
              Opgehaald: {formatDate(checkedAt)} (Amsterdam).
              Gegevens worden via afzonderlijke leesaanvragen verzameld
              en vormen geen vergrendelde uitvoersnapshot.
            </p>
          ) : null}

          {loading ? (
            <p role="status" className="py-10 font-display text-[#D6FF3F]">
              VERWIJDERVERZOEKEN LADEN...
            </p>
          ) : !error && items.length === 0 ? (
            <p className="py-10 text-sm text-[#B9BEC2]">
              Geen verzoeken op deze pagina.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              {items.map((item) => {
                const selected = selectedId === item.id;

                const claimedTime = item.queue?.claimed_at
                  ? Date.parse(item.queue.claimed_at)
                  : NaN;

                const oldClaim =
                  item.queue?.status === "claimed" &&
                  Number.isFinite(claimedTime) &&
                  now - claimedTime >= 15 * 60 * 1000;

                const needsReview =
                  item.status === "needs_review" ||
                  item.queue?.status === "needs_review";

                const queueNeedsReconciliation =
                  item.status === "completed" &&
                  item.queue !== null &&
                  item.queue.status !== "completed";

                const followup = item.followup;
const requestCompleted = item.status === "completed";

const reviewTime = followup
  ? Date.parse(followup.reviewAfter)
  : NaN;

const invalidReviewDate =
  Boolean(followup) && !Number.isFinite(reviewTime);

const reviewDue =
  !requestCompleted &&
  Number.isFinite(reviewTime) &&
  reviewTime <= now;

const unassigned =
  !requestCompleted && !followup?.assigned;

const followupLabel = requestCompleted
  ? "AFGEROND"
  : reviewDue
    ? "HERCONTROLE NODIG"
    : unassigned
      ? "NIET TOEGEWEZEN"
      : invalidReviewDate
        ? "OPVOLGING CONTROLEREN"
        : "GEPLAND";

const followupNeedsAttention =
  !requestCompleted &&
  (reviewDue || unassigned || invalidReviewDate);

const attention =
  oldClaim ||
  needsReview ||
  queueNeedsReconciliation ||
  followupNeedsAttention;

                const phases: Array<[string, string | null]> = [
                  ["Aangevraagd", item.requested_at],
                  ["In wachtrij", item.queue?.queued_at ?? null],
                  ["Claim gestart", item.queue?.claimed_at ?? null],
                  ["Aanvullende opruiming", item.auxiliary_cleaned_at],
                  ["Uitvoerregistratie", item.execution?.created_at ?? null],
                  ["Trainerfase", item.execution?.trainer_cleaned_at ?? null],
                  ["Database-opruiming", item.execution?.database_cleaned_at ?? null],
                  ["Auth-fase gestart", item.execution?.auth_delete_started_at ?? null],
                  ["Auth-afwezigheid bevestigd", item.execution?.auth_deleted_at ?? null],
                  ["Lokale eindcontrole", item.execution?.local_completed_at ?? null],
                  ["Technische referentie gewist", item.execution?.target_reference_erased_at ?? null],
                  ["Verzoek afgerond", item.completed_at],
                  ["Wachtrij afgehandeld", item.queue?.finished_at ?? null],
                ];

                return (
                  <article
                    key={item.id}
                    className={`border p-4 sm:p-5 ${
                      attention ? "border-[#FF4B3E]" : "border-white/25"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-display text-xl text-[#D6FF3F]">
                          {item.requester_role === "player"
                            ? "SPELER"
                            : item.requester_role === "trainer"
                              ? "TRAINER"
                              : item.requester_role.toUpperCase()}
                        </p>

                        <p className="mt-1 break-all font-mono text-xs text-[#B9BEC2]">
                          {item.id}
                        </p>

                        <p className="mt-2 text-sm">
                          {latestPhase(item)}
                        </p>
                      </div>

                      <div className="text-xs leading-relaxed text-[#B9BEC2]">
                        <p>
                          Verzoek:{" "}
                          <strong className="text-white">
                            {label(item.status)}
                          </strong>
                        </p>
                        <p>
                          Wachtrij:{" "}
                          <strong className="text-white">
                            {item.queue
                              ? label(item.queue.status)
                              : "Niet ingepland"}
                          </strong>
                        </p>
                        <p>Externe taken: {item.externalTaskCount}</p>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-white/15 pt-4">
  <div className="flex flex-wrap items-center gap-3">
    <span
      className={`border px-2.5 py-1 font-display text-xs ${
        requestCompleted
          ? "border-[#D6FF3F]/40 text-[#D6FF3F]"
          : followupNeedsAttention
            ? "border-[#FF4B3E] text-[#FF8A80]"
            : "border-white/30 text-[#B9BEC2]"
      }`}
    >
      {followupLabel}
    </span>

    {!requestCompleted ? (
      <span className="text-xs text-[#B9BEC2]">
        Verantwoordelijke:{" "}
        <strong className="text-white">
          {followup?.assignedToCurrentAdmin
            ? "Jij"
            : followup?.assigned
              ? "Andere beheerder"
              : "Nog niemand"}
        </strong>
      </span>
    ) : null}
  </div>

  {!requestCompleted && followup ? (
    <div className="mt-2 space-y-1 text-xs text-[#B9BEC2]">
      <p>
        Vervolgstap:{" "}
        {FOLLOWUP_ACTION_LABELS[followup.nextAction] ??
          followup.nextAction}
      </p>

      <p className={reviewDue ? "text-[#FF8A80]" : undefined}>
        Hercontrole: {formatDate(followup.reviewAfter)} (Amsterdam)
      </p>
    </div>
  ) : !requestCompleted ? (
    <p className="mt-2 text-xs text-[#B9BEC2]">
      Open de details om dit verzoek op te pakken en een
      hercontrolemoment vast te leggen.
    </p>
  ) : null}
</div>

                    {oldClaim ? (
                      <p className="mt-4 border-l-2 border-[#FF4B3E] pl-3 text-sm text-[#FF4B3E]">
                        Claim is minstens 15 minuten oud. Controleer de
                        worker en opgeslagen fasen. Dit is een operationeel
                        controlesignaal, geen veilige overname- of retrytermijn.
                      </p>
                    ) : null}

                    {queueNeedsReconciliation ? (
                      <p className="mt-3 text-sm text-[#FF4B3E]">
                        Het verzoek is afgerond, maar de wachtrijstatus
                        nog niet. Controleer alleen de administratieve
                        afronding; start niet opnieuw de verwijdering.
                      </p>
                    ) : null}

                    {needsReview ? (
                      <p className="mt-3 text-sm text-[#FF4B3E]">
                        Aanvullende afhandeling nodig. De oorspronkelijke
                        workerreden is nog niet apart opgeslagen.
                      </p>
                    ) : null}

                    <button
                      type="button"
                      aria-expanded={selected}
                      aria-controls={`deletion-${item.id}`}
                      onClick={() => void openDetails(item.id)}
                      className="mt-4 min-h-11 border border-white/30 px-4 py-2 font-display text-sm hover:border-[#D6FF3F] hover:text-[#D6FF3F]"
                    >
                      {selected ? "DETAILS INKLAPPEN −" : "BEKIJK DETAILS +"}
                    </button>

                    {selected ? (
  <div
    id={`deletion-${item.id}`}
    className="mt-5 space-y-5 border-t border-white/15 pt-5"
  >
    {item.requester_role === "player" &&
item.status === "completed" &&
item.queue?.status === "claimed" &&
item.queue.claimed_at ? (
  <AccountDeletionQueueRecovery
    key={`recovery-${item.id}-${item.queue.claimed_at}`}
    requestId={item.id}
    claimedAt={item.queue.claimed_at}
    onRefresh={() => void load()}
  />
) : null}

{item.status === "in_progress" &&
item.queue?.status === "claimed" &&
item.queue.claimed_at &&
item.execution?.auth_delete_started_at &&
!item.execution.target_reference_erased_at &&
["player", "trainer"].includes(item.requester_role) ? (
  <AccountDeletionPostAuthRecovery
    key={`post-auth-${item.id}-${item.queue.claimed_at}`}
    requestId={item.id}
    claimedAt={item.queue.claimed_at}
    onRefresh={() => void load()}
  />
) : null}

{item.status === "in_progress" &&
item.queue?.status === "claimed" &&
item.queue.claimed_at &&
item.execution?.database_cleaned_at &&
!item.execution.auth_delete_started_at &&
!item.execution.auth_deleted_at &&
!item.execution.local_completed_at &&
!item.execution.target_reference_erased_at ? (
  <AccountDeletionResume
    key={`resume-${item.id}-${item.queue.claimed_at}`}
    requestId={item.id}
    claimedAt={item.queue.claimed_at}
    onRefresh={() => void load()}
  />
) : null}

<AccountDeletionFollowup
  key={item.id}
  requestId={item.id}
/>

    <div>
      <h2 className="font-display text-lg">
        VASTGELEGDE FASEN
      </h2>

                          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                            {phases.map(([title, time]) => (
                              <div key={title}>
                                <dt className="text-[#8A8F94]">{title}</dt>
                                <dd className="mt-1">{formatDate(time)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>

                        {detailLoading ? (
                          <p role="status" className="text-sm text-[#D6FF3F]">
                            Details ophalen...
                          </p>
                        ) : null}

                        {detailError ? (
                          <p role="alert" className="text-sm text-[#FF4B3E]">
                            {detailError}
                          </p>
                        ) : null}

                        {detail?.requestId === item.id ? (
                          <>
                            <div>
                              <h2 className="font-display text-lg">
                                BEOORDELING
                              </h2>

                              <p className="mt-2 text-sm leading-relaxed text-[#B9BEC2]">
                                {detail.assessmentNote}
                              </p>

                              {detail.assessment ? (
                                <>
                                  <p className="mt-3 font-display text-[#D6FF3F]">
                                    {detail.assessment.outcome === "simple_path_candidate"
                                      ? "KANDIDAAT VOOR HET EENVOUDIGE PAD"
                                      : "AFHANKELIJKHEDEN VEREISEN BEOORDELING"}
                                  </p>

                                  {detail.assessment.reasons.length > 0 ? (
                                    <ul className="mt-2 list-inside list-disc text-sm text-[#FF4B3E]">
                                      {detail.assessment.reasons.map((reason) => (
                                        <li key={reason}>{reason}</li>
                                      ))}
                                    </ul>
                                  ) : null}

                                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                                    {Object.entries(detail.assessment.counts)
                                      .filter(([, value]) => value > 0)
                                      .map(([name, value]) => (
                                        <div
                                          key={name}
                                          className="flex justify-between gap-3 border border-white/15 p-2"
                                        >
                                          <dt className="break-all text-[#B9BEC2]">
                                            {name}
                                          </dt>
                                          <dd>{value}</dd>
                                        </div>
                                      ))}
                                  </dl>
                                </>
                              ) : null}
                            </div>

                            <div>
                              <h2 className="font-display text-lg">
                                EXTERNE AFHANDELING
                              </h2>

                              {detail.externalTasks.map((task) => (
                                <p key={task.status} className="mt-2 text-sm text-[#B9BEC2]">
                                  {label(task.status)}: {task.count}
                                </p>
                              ))}

                              <p className="mt-3 text-xs text-[#8A8F94]">
                                Geen mailinhoud, statusbewijzen, claimtokens
                                of providerreferenties worden hier getoond.
                              </p>
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={loading || page === 1}
              onClick={() => setPage((value) => value - 1)}
              className="min-h-11 border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-40"
            >
              ← VORIGE
            </button>

            <p className="text-xs text-[#B9BEC2]">Pagina {page}</p>

            <button
              type="button"
              disabled={loading || !hasMore}
              onClick={() => setPage((value) => value + 1)}
              className="min-h-11 border border-white/30 px-4 py-3 font-display text-sm disabled:opacity-40"
            >
              VOLGENDE →
            </button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}