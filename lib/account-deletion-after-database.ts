import type { SupabaseClient } from "@supabase/supabase-js";

type Options = {
  admin: SupabaseClient;
  requestId: string;
  claimToken: string;
  expectedUserId: string;
  expectedTrainerId: string | null;
  role: "player" | "trainer";

  /*
   * De aanroeper houdt de exclusieve verzoeklock vast.
   * Deze callback controleert de bijbehorende verbinding.
   */
  assertConnection: () => Promise<void>;
  onStage: (stage: string) => void;
};

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

/**
 * Vervolg na bevestigde database-opruiming.
 *
 * Alleen gebruiken terwijl de aanroeper de exclusieve
 * verzoeklock vasthoudt.
 *
 * Deze functie:
 * - neemt geen claim over;
 * - herhaalt geen al vrijgegeven Auth-fase;
 * - doet maximaal één expliciete deleteUser-aanroep;
 * - laat onzekere voortgang staan voor afzonderlijk herstel.
 */
export async function executeDeletionAfterDatabase({
  admin,
  requestId,
  claimToken,
  expectedUserId,
  expectedTrainerId,
  role,
  assertConnection,
  onStage,
}: Options): Promise<Record<string, unknown>> {
  async function checkpoint(): Promise<void> {
    await assertConnection();

    const { data, error } = await admin
      .from("account_deletion_queue")
      .select("request_id")
      .eq("request_id", requestId)
      .eq("status", "claimed")
      .eq("claim_token", claimToken)
      .is("finished_at", null)
      .maybeSingle();

    if (error || !data) {
      throw new Error("CLAIM_NOT_CONFIRMED");
    }

    await assertConnection();
  }

  async function enterStage(stage: string): Promise<void> {
    onStage(stage);
    await checkpoint();
  }

  async function finishQueue(
    outcome: "completed" | "needs_review"
  ): Promise<void> {
    await checkpoint();

    const { data, error } = await admin.rpc(
      "finish_account_deletion_job",
      {
        p_request_id: requestId,
        p_claim_token: claimToken,
        p_outcome: outcome,
      }
    );

    if (error || data !== true) {
      throw new Error("QUEUE_COMPLETION_NOT_CONFIRMED");
    }

    // De claim is nu niet meer claimed.
    await assertConnection();
  }

  await enterStage("verify_database_phase");

  const { data: execution, error: executionError } = await admin
    .from("account_deletion_executions")
    .select(`
      target_user_id,
      target_trainer_id,
      trainer_cleaned_at,
      database_cleaned_at,
      auth_delete_started_at,
      auth_deleted_at,
      local_completed_at,
      target_reference_erased_at
    `)
    .eq("request_id", requestId)
    .maybeSingle();

  if (
    executionError ||
    !execution ||
    execution.target_user_id !== expectedUserId ||
    execution.target_trainer_id !== expectedTrainerId ||
    !isTimestamp(execution.trainer_cleaned_at) ||
    !isTimestamp(execution.database_cleaned_at) ||
    execution.auth_delete_started_at !== null ||
    execution.auth_deleted_at !== null ||
    execution.local_completed_at !== null ||
    execution.target_reference_erased_at !== null
  ) {
    throw new Error("DATABASE_PHASE_NOT_CONFIRMED");
  }

  if (
    (role === "player" && expectedTrainerId !== null) ||
    (role === "trainer" && expectedTrainerId === null)
  ) {
    throw new Error("UNSUPPORTED_EXECUTION_IDENTITY");
  }

  await enterStage("check_remaining_external_tasks");

  const { count: externalCount, error: externalError } = await admin
    .from("account_deletion_external_tasks")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId);

  if (externalError || externalCount === null) {
    throw new Error("EXTERNAL_TASKS_NOT_CONFIRMED");
  }

  if (role === "player" && externalCount !== 0) {
    throw new Error("PLAYER_EXTERNAL_TASKS_REQUIRE_REVIEW");
  }

  /*
   * Een lookupfout niet als accountafwezigheid behandelen.
   * Dit pad vereist dat Auth nog bestaat vóór vrijgave.
   */
  await enterStage("check_auth_before_release");

  const { data: authData, error: authError } =
    await admin.auth.admin.getUserById(expectedUserId);

  if (
    authError ||
    !authData.user ||
    authData.user.id !== expectedUserId
  ) {
    throw new Error("AUTH_ACCOUNT_NOT_CONFIRMED");
  }

  await enterStage("start_auth_phase");

  const { data: authPhase, error: authPhaseError } = await admin.rpc(
    "start_claimed_account_deletion_auth_phase",
    {
      p_request_id: requestId,
      p_claim_token: claimToken,
    }
  );

  if (
    authPhaseError ||
    !isObject(authPhase) ||
    authPhase.request_id !== requestId ||
    authPhase.target_user_id !== expectedUserId ||
    authPhase.auth_phase_started !== true ||
    authPhase.already_started !== false
  ) {
    /*
     * Een al vrijgegeven fase niet opnieuw uitvoeren.
     * Ook bij een verloren vrijgaveantwoord stoppen.
     */
    throw new Error("NEW_AUTH_RELEASE_NOT_CONFIRMED");
  }

  await enterStage("delete_auth_account");

  /*
   * Maximaal één expliciete verwijderaanroep.
   * Een fout of verloren antwoord is geen bewijs van mislukking.
   */
  try {
    await admin.auth.admin.deleteUser(expectedUserId, false);
  } catch {
    // Resultaat hieronder controleren; niet opnieuw versturen.
  }

  await enterStage("confirm_auth_absence");

  const { data: absence, error: absenceError } = await admin.rpc(
    "confirm_account_deletion_auth_absence",
    { p_request_id: requestId }
  );

  if (
    absenceError ||
    !isObject(absence) ||
    absence.request_id !== requestId ||
    absence.auth_absence_confirmed !== true ||
    !isTimestamp(absence.auth_deleted_at)
  ) {
    throw new Error("AUTH_ABSENCE_NOT_CONFIRMED");
  }

  if (role === "trainer") {
    await enterStage("finalize_trainer_local");

    const { data: local, error: localError } = await admin.rpc(
      "finalize_simple_trainer_deletion_local",
      { p_request_id: requestId }
    );

    if (
      localError ||
      !isObject(local) ||
      local.request_id !== requestId ||
      local.local_completion_confirmed !== true ||
      local.account_deleted !== true ||
      local.request_completed !== false ||
      typeof local.external_followup_pending !== "boolean" ||
      !isTimestamp(local.local_completed_at)
    ) {
      throw new Error("TRAINER_LOCAL_COMPLETION_NOT_CONFIRMED");
    }

    onStage("finish_trainer_queue");
    await finishQueue("needs_review");

    return {
      requestId,
      processed: 1,
      processingStatus: "needs_review",
      accountDeleted: true,
      localCompletionConfirmed: true,
      localCompletedAt: local.local_completed_at,
      externalFollowupPending: local.external_followup_pending,
      requestCompleted: false,
      message: local.external_followup_pending
        ? "Het traineraccount is lokaal verwijderd. Externe gegevensafhandeling staat nog open."
        : "Het traineraccount is lokaal verwijderd. De administratieve afsluiting staat nog open.",
    };
  }

  await enterStage("finalize_player_local");

  const { data: local, error: localError } = await admin.rpc(
    "finalize_simple_player_deletion_local",
    { p_request_id: requestId }
  );

  if (
    localError ||
    !isObject(local) ||
    local.request_id !== requestId ||
    local.local_completion_confirmed !== true ||
    !isTimestamp(local.local_completed_at)
  ) {
    throw new Error("PLAYER_LOCAL_COMPLETION_NOT_CONFIRMED");
  }

  await enterStage("complete_player_request");

  const { data: completed, error: completionError } = await admin.rpc(
    "complete_simple_player_deletion",
    { p_request_id: requestId }
  );

  if (
    completionError ||
    !isObject(completed) ||
    completed.request_id !== requestId ||
    completed.request_completed !== true ||
    completed.technical_reference_erased !== true ||
    !isTimestamp(completed.completed_at)
  ) {
    throw new Error("PLAYER_COMPLETION_NOT_CONFIRMED");
  }

  onStage("finish_queue");
  await finishQueue("completed");

  return {
    requestId,
    processed: 1,
    processingStatus: "completed",
    accountDeleted: true,
    requestCompleted: true,
    completedAt: completed.completed_at,
    technicalReferenceErased: true,
  };
}