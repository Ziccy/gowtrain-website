import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { executeDeletionAfterDatabase } from "@/lib/account-deletion-after-database";
import {
  AccountDeletionExecutionBusyError,
  AccountDeletionExecutionConnectionError,
  validateAccountDeletionDatabaseConfiguration,
  withAccountDeletionExecutionLock,
} from "@/lib/account-deletion-execution-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const WORKER_REVISION = "gowtrain-worker-connection-check-v2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* HELPERS */

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Gowtrain-Worker-Revision": WORKER_REVISION,
    },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("Serverconfiguratie ontbreekt.");
  }

  return value;
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function secretMatches(
  supplied: string | null,
  expected: string
): boolean {
  if (!supplied) return false;

  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/* WORKER */

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  /*
   * Ook de verbindingscontrole vereist expliciete inschakeling.
   * De versieheader wordt tevens bij dit 404-antwoord teruggegeven.
   */
  if (process.env.ACCOUNT_DELETION_WORKER_ENABLED !== "true") {
    return json({ error: "Niet beschikbaar." }, 404);
  }

  const localDevelopment =
    process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      request.nextUrl.hostname
    );

  const deployedWebsite =
    process.env.NODE_ENV === "production" &&
    request.nextUrl.protocol === "https:" &&
    ["www.gowtrain.com", "gowtrain.com"].includes(
      request.nextUrl.hostname
    );

  if (!localDevelopment && !deployedWebsite) {
    return json({ error: "Niet beschikbaar." }, 404);
  }

  /*
   * Server-to-server-route.
   * Host- en Origin-controles vervangen de workersleutel niet.
   */
  if (request.headers.has("origin")) {
    return json(
      { error: "Geen browsertoegang tot deze worker." },
      403
    );
  }

  let stage = "configuration";
  let claimedRequestId: string | null = null;

  try {
    const expectedSecret = requiredEnv(
      "ACCOUNT_DELETION_WORKER_SECRET"
    );

    if (
      !/^[0-9a-f]{64}$/i.test(expectedSecret) ||
      !secretMatches(
        request.headers.get("x-account-deletion-worker-secret"),
        expectedSecret
      )
    ) {
      return json({ error: "Geen workertoegang." }, 401);
    }

    /*
     * Bepaal expliciet of dit een infrastructuurcontrole is.
     *
     * Ondersteund:
     * - header x-account-deletion-check: connection
     * - queryparameter ?check=connection
     * - beide, mits gelijk
     *
     * Een ongeldige controle mag nooit doorvallen naar uitvoering.
     */
    const headerCheck = request.headers.get(
      "x-account-deletion-check"
    );

    const queryChecks = request.nextUrl.searchParams.getAll("check");

    if (queryChecks.length > 1) {
      return json(
        {
          error:
            "Meerdere controlewaarden ontvangen. Er is niets geclaimd.",
        },
        400
      );
    }

    const queryCheck = queryChecks[0] ?? null;

    if (
      (headerCheck !== null && headerCheck !== "connection") ||
      (queryCheck !== null && queryCheck !== "connection")
    ) {
      return json(
        {
          error:
            "Onbekende workercontrole. Er is niets geclaimd.",
        },
        400
      );
    }

    const connectionCheck =
      headerCheck === "connection" ||
      queryCheck === "connection";

    /*
     * De oude lokale testuitvoerder gebruikt deze
     * uitvoercoördinatie niet.
     */
    if (
      process.env.ACCOUNT_DELETION_LOCAL_EXECUTOR_ENABLED === "true"
    ) {
      return json(
        {
          error:
            "Schakel de oude lokale testuitvoerder uit voordat je de worker gebruikt.",
        },
        503
      );
    }

    /*
     * Controleer configuratie vóór een claim.
     * Het openen van de PostgreSQL-verbinding gebeurt via de helper.
     */
    validateAccountDeletionDatabaseConfiguration();

    /* NIET-DESTRUCTIEVE VERBINDINGSCONTROLE */

    if (connectionCheck) {
      stage = "check_execution_connection";

      /*
       * Willekeurige testsleutel.
       * Niet gekoppeld aan een bestaand verwijderverzoek.
       *
       * Geen wachtrijclaim en geen verwijderfunctie aanroepen.
       */
      return await withAccountDeletionExecutionLock(
        randomUUID(),
        async ({ assertConnection }) => {
          await assertConnection();

          return json({
            processed: 0,
            mode: "connection",
            workerRevision: WORKER_REVISION,
            connectionCheckPassed: true,
            executionLockChecked: true,
            message:
              "TLS-databaseverbinding en sessielock gecontroleerd. Geen opdracht geclaimd en geen accountgegevens gewijzigd.",
          });
        }
      );
    }

    /* NORMALE WORKERUITVOERING */

    const admin = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );

    stage = "claim";

    const { data: claim, error: claimError } = await admin.rpc(
      "claim_account_deletion_job"
    );

    /*
     * Alleen queued-opdrachten worden geclaimd.
     * Een verloren claimantwoord niet automatisch herhalen.
     */
    if (claimError) {
      throw new Error("Claim niet bevestigd.");
    }

    if (claim === null) {
      return json({
        processed: 0,
        message: "Geen nieuwe verwijderopdracht beschikbaar.",
      });
    }

    if (
      !isObject(claim) ||
      typeof claim.request_id !== "string" ||
      !UUID_PATTERN.test(claim.request_id) ||
      typeof claim.claim_token !== "string" ||
      !UUID_PATTERN.test(claim.claim_token) ||
      !isTimestamp(claim.claimed_at)
    ) {
      throw new Error("Ongeldig claimantwoord.");
    }

    const requestId = claim.request_id;
    const claimToken = claim.claim_token;

    claimedRequestId = requestId;
    stage = "acquire_execution_lock";

    return await withAccountDeletionExecutionLock(
      requestId,
      async ({ signal, assertConnection }) => {
        /*
         * Controleer de vastgehouden databaseverbinding
         * en het eigenaarschap van de wachtrijclaim.
         *
         * De claimgebonden schrijf-RPC's controleren het token
         * daarnaast binnen hun eigen database-transactie.
         */
        async function checkpoint(): Promise<void> {
          await assertConnection();

          if (signal.aborted) {
            throw new AccountDeletionExecutionConnectionError();
          }

          const { data, error } = await admin
            .from("account_deletion_queue")
            .select("request_id")
            .eq("request_id", requestId)
            .eq("status", "claimed")
            .eq("claim_token", claimToken)
            .is("finished_at", null)
            .maybeSingle();

          if (error || !data) {
            throw new Error("Eigen claim niet bevestigd.");
          }

          await assertConnection();
        }

        async function enterStage(
          nextStage: string
        ): Promise<void> {
          stage = nextStage;
          await checkpoint();
        }

        async function finishJob(
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
            throw new Error("Wachtrijafronding niet bevestigd.");
          }

          // De opdracht staat nu niet meer op claimed.
          await assertConnection();
        }

        async function needsReview(
          reason: string
        ): Promise<NextResponse> {
          stage = "record_review";
          await finishJob("needs_review");

          /*
           * De oorspronkelijke workerreden wordt momenteel
           * alleen teruggegeven, niet afzonderlijk opgeslagen.
           */
          return json({
            requestId,
            processed: 1,
            processingStatus: "needs_review",
            requestCompleted: false,
            reason,
            message:
              "Automatische verwerking is gestopt. Aanvullende afhandeling is nodig.",
          });
        }

        /* VERZOEK LEZEN */

        await enterStage("read_request");

        const {
          data: deletionRequest,
          error: requestError,
        } = await admin
          .from("account_deletion_requests")
          .select("id, user_id, requester_role, status")
          .eq("id", requestId)
          .maybeSingle();

        if (requestError || !deletionRequest) {
          throw new Error("Verwijderverzoek niet leesbaar.");
        }

        /*
         * Al afgerond: alleen de wachtrij administratief afronden.
         * De finish-RPC controleert het opgeslagen eindbewijs.
         */
        if (deletionRequest.status === "completed") {
          stage = "finish_completed_job";
          await finishJob("completed");

          return json({
            requestId,
            processed: 1,
            processingStatus: "completed",
            requestCompleted: true,
            alreadyCompleted: true,
          });
        }

        /* GEEN AUTOMATISCHE OVERNAME */

        await enterStage("read_execution");

        const {
          data: existingExecution,
          error: executionError,
        } = await admin
          .from("account_deletion_executions")
          .select("request_id")
          .eq("request_id", requestId)
          .maybeSingle();

        if (executionError) {
          throw new Error("Uitvoervoortgang niet leesbaar.");
        }

        if (
          existingExecution ||
          deletionRequest.status !== "requested"
        ) {
          return await needsReview(
            "existing_execution_requires_recovery"
          );
        }

        const isTrainerRequest =
          deletionRequest.requester_role === "trainer";

        if (
          deletionRequest.requester_role !== "player" &&
          !isTrainerRequest
        ) {
          return await needsReview("unsupported_account_role");
        }

        if (
          isTrainerRequest &&
          process.env.ACCOUNT_DELETION_TRAINER_LOCAL_ENABLED !== "true"
        ) {
          return await needsReview("trainer_path_not_enabled");
        }

        if (
          typeof deletionRequest.user_id !== "string" ||
          !UUID_PATTERN.test(deletionRequest.user_id)
        ) {
          return await needsReview("account_reference_missing");
        }

        const expectedUserId = deletionRequest.user_id;

        /* AFHANKELIJKHEDEN BEOORDELEN */

        await enterStage("assess");

        const {
          data: assessment,
          error: assessmentError,
        } = await admin.rpc(
          "assess_account_deletion_request",
          { p_request_id: requestId }
        );

        if (
          assessmentError ||
          !isObject(assessment) ||
          assessment.request_id !== requestId ||
          assessment.request_status !== "requested" ||
          (
            assessment.assessment !== "simple_path_candidate" &&
            assessment.assessment !== "requires_review"
          ) ||
          !isObject(assessment.counts) ||
          !Array.isArray(assessment.reasons) ||
          !assessment.reasons.every(
            (reason: unknown) => typeof reason === "string"
          )
        ) {
          throw new Error("Beoordeling niet bevestigd.");
        }

        if (
          assessment.assessment !== "simple_path_candidate" ||
          assessment.reasons.length !== 0
        ) {
          return await needsReview("dependencies_require_review");
        }

        const trainerProfileCount =
          assessment.counts.trainer_profiles;

        const relatedMailCount =
          assessment.counts.related_email_jobs;

        if (
          !isNonNegativeInteger(trainerProfileCount) ||
          !isNonNegativeInteger(relatedMailCount)
        ) {
          throw new Error(
            "De beoordelingsaantallen zijn niet bevestigd."
          );
        }

        let expectedTrainerId: string | null = null;

        if (isTrainerRequest) {
          if (trainerProfileCount !== 1) {
            return await needsReview("outside_simple_trainer_scope");
          }

          await enterStage("identify_trainer");

          const {
            data: targetTrainer,
            error: trainerLookupError,
          } = await admin
            .from("trainers")
            .select("id")
            .eq("user_id", expectedUserId)
            .maybeSingle();

          if (
            trainerLookupError ||
            !targetTrainer ||
            typeof targetTrainer.id !== "string" ||
            !UUID_PATTERN.test(targetTrainer.id)
          ) {
            throw new Error(
              "De oorspronkelijke traineridentiteit is niet bevestigd."
            );
          }

          expectedTrainerId = targetTrainer.id;
        } else if (
          trainerProfileCount !== 0 ||
          relatedMailCount !== 0
        ) {
          return await needsReview("outside_simple_player_scope");
        }

        /* BESTAANDE EXTERNE TAKEN UITSLUITEN */

        await enterStage("check_external_tasks");

        const {
          count: externalCount,
          error: externalError,
        } = await admin
          .from("account_deletion_external_tasks")
          .select("id", { count: "exact", head: true })
          .eq("request_id", requestId);

        if (externalError || externalCount === null) {
          throw new Error(
            "Externe afhandeling niet controleerbaar."
          );
        }

        if (externalCount !== 0) {
          return await needsReview("external_tasks_present");
        }

        /* CLAIMGEBONDEN DATABASE-OPRUIMING */

        await enterStage("database_cleanup");

        const {
          data: cleanup,
          error: cleanupError,
        } = await admin.rpc(
          "clean_claimed_account_deletion_database",
          {
            p_request_id: requestId,
            p_claim_token: claimToken,
          }
        );

        if (
          cleanupError ||
          !isObject(cleanup) ||
          cleanup.request_id !== requestId ||
          cleanup.database_cleanup_confirmed !== true
        ) {
          throw new Error("Database-opruiming niet bevestigd.");
        }

        /* UITVOERIDENTITEIT CONTROLEREN */

        await enterStage("verify_execution_identity");

        const {
          data: execution,
          error: readExecutionError,
        } = await admin
          .from("account_deletion_executions")
          .select(
            "target_user_id, target_trainer_id, database_cleaned_at"
          )
          .eq("request_id", requestId)
          .single();

        if (
          readExecutionError ||
          !execution ||
          execution.target_user_id !== expectedUserId ||
          !isTimestamp(execution.database_cleaned_at)
        ) {
          throw new Error("Uitvoeridentiteit niet bevestigd.");
        }

        if (execution.target_trainer_id !== expectedTrainerId) {
          throw new Error(
            "De trainerreferentie na opruiming wijkt af."
          );
        }

        /* EXTERNE TAKEN NA OPRUIMING */

        await enterStage("recheck_external_tasks");

        const {
          count: remainingTasks,
          error: tasksError,
        } = await admin
          .from("account_deletion_external_tasks")
          .select("id", { count: "exact", head: true })
          .eq("request_id", requestId);

        if (tasksError || remainingTasks === null) {
          throw new Error(
            "Externe taken niet opnieuw controleerbaar."
          );
        }

        if (!isTrainerRequest && remainingTasks !== 0) {
          return await needsReview(
            "external_tasks_detected_after_cleanup"
          );
        }

        /*
         * Bij trainers blijven eventueel veiliggestelde externe
         * mailreferenties open voor afzonderlijke afhandeling.
         */

        /* GEDEELDE AUTH- EN AFRONDINGSFASE */

        const result = await executeDeletionAfterDatabase({
          admin,
          requestId,
          claimToken,
          expectedUserId,
          expectedTrainerId,
          role: isTrainerRequest ? "trainer" : "player",
          assertConnection,
          onStage: (nextStage) => {
            stage = nextStage;
          },
        });

        return json(result);
      }
    );
  } catch (error: unknown) {
    const code =
      error instanceof AccountDeletionExecutionBusyError
        ? "EXECUTION_LOCK_BUSY"
        : error instanceof AccountDeletionExecutionConnectionError
          ? "EXECUTION_CONNECTION_NOT_CONFIRMED"
          : "WORKER_EXECUTION_NOT_CONFIRMED";

    /*
     * Geen automatische claimreset, reconnect of retry.
     * Ook bij een fout kan een eerdere fase al zijn vastgelegd.
     */
    return json(
      {
        ...(claimedRequestId
          ? { requestId: claimedRequestId }
          : {}),
        code,
        stage,
        workerRevision: WORKER_REVISION,
        requestCompleted: false,
        error:
          "De workeruitvoering kon niet worden bevestigd. Een claim of eerdere uitvoerfase kan al zijn vastgelegd. Controleer de opgeslagen voortgang; er wordt niet automatisch opnieuw uitgevoerd.",
      },
      503
    );
  }
}