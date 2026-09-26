import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Execution = {
  request_id: string;
  target_user_id: string | null;
  target_trainer_id: string | null;
  database_cleaned_at: string | null;
  auth_delete_started_at: string | null;
  auth_deleted_at: string | null;
  local_completed_at: string | null;
  target_reference_erased_at: string | null;
};

class InvalidBodyError extends Error {}

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
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

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function secretMatches(
  supplied: string | null,
  expected: string
): boolean {
  if (!supplied) return false;

  const first = Buffer.from(supplied, "utf8");
  const second = Buffer.from(expected, "utf8");

  return (
    first.length === second.length &&
    timingSafeEqual(first, second)
  );
}

async function readBody(request: NextRequest): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json" || !request.body) {
    throw new InvalidBodyError();
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();

  let size = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > 2048) {
        await reader.cancel();
        throw new InvalidBodyError();
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidBodyError();
  }
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  /*
   * Uitsluitend de lokale ontwikkelomgeving.
   * Deze route is geen publieke accountverwijder-API.
   */
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ACCOUNT_DELETION_LOCAL_EXECUTOR_ENABLED !== "true"
  ) {
    return json({ error: "Niet beschikbaar." }, 404);
  }

  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(
      request.nextUrl.hostname
    )
  ) {
    return json({ error: "Niet beschikbaar." }, 404);
  }

  /*
   * De hostcontrole is geen authenticatie.
   * De geheime uitvoersleutel blijft verplicht.
   */
  if (request.headers.has("origin")) {
    return json(
      {
        error:
          "Deze uitvoerder accepteert geen browseraanvragen.",
      },
      403
    );
  }

  let stage = "configuration";

  try {
    const expectedSecret = requiredEnv(
      "ACCOUNT_DELETION_LOCAL_EXECUTOR_SECRET"
    );

    if (
      !/^[0-9a-f]{64}$/i.test(expectedSecret) ||
      !secretMatches(
        request.headers.get("x-account-deletion-secret"),
        expectedSecret
      )
    ) {
      return json({ error: "Geen uitvoertoegang." }, 401);
    }

    const allowedRequestIds = new Set(
      requiredEnv("ACCOUNT_DELETION_LOCAL_ALLOWED_REQUEST_IDS")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );

    if (
      allowedRequestIds.size === 0 ||
      [...allowedRequestIds].some(
        (value) => !UUID_PATTERN.test(value)
      )
    ) {
      throw new Error("Ongeldige uitvoerconfiguratie.");
    }

    stage = "validate_request";

    const body = await readBody(request);

    if (
      !isObject(body) ||
      typeof body.requestId !== "string" ||
      !UUID_PATTERN.test(body.requestId) ||
      body.confirmation !== "DELETE_TEST_ACCOUNT_PERMANENTLY" ||
      Object.keys(body).some(
        (key) => key !== "requestId" && key !== "confirmation"
      )
    ) {
      return json(
        { error: "Ongeldige aanvraag of bevestiging." },
        400
      );
    }

    const requestId = body.requestId.toLowerCase();

    if (!allowedRequestIds.has(requestId)) {
      return json(
        {
          error:
            "Dit testverzoek is niet vrijgegeven voor uitvoering.",
        },
        403
      );
    }

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

    async function readExecution(): Promise<Execution | null> {
      const { data, error } = await admin
        .from("account_deletion_executions")
        .select(`
          request_id,
          target_user_id,
          target_trainer_id,
          database_cleaned_at,
          auth_delete_started_at,
          auth_deleted_at,
          local_completed_at,
          target_reference_erased_at
        `)
        .eq("request_id", requestId)
        .maybeSingle();

      if (error) {
        throw new Error("Uitvoervoortgang niet leesbaar.");
      }

      return data as Execution | null;
    }

    async function confirmAuthAbsence(): Promise<boolean> {
      const { data, error } = await admin.rpc(
        "confirm_account_deletion_auth_absence",
        { p_request_id: requestId }
      );

      return (
        !error &&
        isObject(data) &&
        data.request_id === requestId &&
        data.auth_absence_confirmed === true &&
        isTimestamp(data.auth_deleted_at)
      );
    }

    /*
     * Deze RPC:
     * - sluit een lokaal afgerond verzoek af;
     * - of herkent een al afgesloten verzoek.
     *
     * Bij een al afgesloten verzoek zijn de accountreferenties
     * gewist. Dan wordt de opgeslagen eindstatus gecontroleerd,
     * niet opnieuw op het oorspronkelijke gebruikers-ID gezocht.
     */
    async function completeRequest(): Promise<NextResponse> {
      stage = "complete_request";

      const { data, error } = await admin.rpc(
        "complete_simple_player_deletion",
        { p_request_id: requestId }
      );

      if (
        error ||
        !isObject(data) ||
        data.request_id !== requestId ||
        data.request_completed !== true ||
        data.technical_reference_erased !== true ||
        typeof data.already_completed !== "boolean" ||
        !isTimestamp(data.completed_at)
      ) {
        throw new Error("Verzoekafronding niet bevestigd.");
      }

      return json({
        requestId,
        requestCompleted: true,
        alreadyCompleted: data.already_completed,
        completedAt: data.completed_at,
        technicalReferenceErased: true,
        message: data.already_completed
          ? "Dit verwijderverzoek was al afgerond. Er is geen nieuwe Auth-verwijderaanroep gedaan."
          : "Het eenvoudige spelerverwijderpad is afgerond. Het account is verwijderd en de technische accountreferenties zijn gewist.",
      });
    }

    async function finishAfterAuthDeletion(): Promise<NextResponse> {
      stage = "finalize_local_completion";

      const { data, error } = await admin.rpc(
        "finalize_simple_player_deletion_local",
        { p_request_id: requestId }
      );

      if (
        error ||
        !isObject(data) ||
        data.request_id !== requestId ||
        data.local_completion_confirmed !== true ||
        !isTimestamp(data.local_completed_at)
      ) {
        throw new Error("Lokale eindcontrole niet bevestigd.");
      }

      return completeRequest();
    }

    stage = "read_request";

    const { data: deletionRequest, error: requestError } =
      await admin
        .from("account_deletion_requests")
        .select("id, user_id, requester_role, status")
        .eq("id", requestId)
        .maybeSingle();

    if (requestError || !deletionRequest) {
      throw new Error("Verwijderverzoek niet bevestigd.");
    }

    /*
     * Deze uitvoerder ondersteunt uitsluitend spelers.
     * Trainerverzoeken niet gedeeltelijk opruimen en daarna
     * pas ontdekken dat externe afhandeling ontbreekt.
     */
    if (deletionRequest.requester_role !== "player") {
      return json(
        {
          requestId,
          error:
            "Deze tijdelijke uitvoerder ondersteunt uitsluitend het eenvoudige spelerpad. Trainerverzoeken worden niet uitgevoerd.",
        },
        409
      );
    }

    let execution = await readExecution();

    /*
     * Afgerond verzoek eerst afhandelen.
     * Daarvoor is geen oorspronkelijke gebruikers-ID meer nodig.
     */
    if (deletionRequest.status === "completed") {
      return await completeRequest();
    }

    if (
      deletionRequest.status !== "requested" &&
      deletionRequest.status !== "in_progress"
    ) {
      return json(
        {
          requestId,
          error:
            "De verzoekstatus staat deze uitvoering niet toe.",
        },
        409
      );
    }

    if (execution?.target_reference_erased_at) {
      throw new Error(
        "Referentie gewist zonder passende eindstatus."
      );
    }

    if (execution?.target_trainer_id) {
      return json(
        {
          requestId,
          error:
            "Deze uitvoering heeft trainerhistorie en valt buiten dit eenvoudige spelerpad.",
        },
        409
      );
    }

    if (
      execution &&
      deletionRequest.user_id !== null &&
      execution.target_user_id !== deletionRequest.user_id
    ) {
      throw new Error("Afwijkende accountkoppeling.");
    }

    /*
     * Bestaande externe taken uitsluiten voordat nieuwe
     * opruimstappen worden uitgevoerd.
     */
    stage = "check_external_tasks";

    const { count: externalTaskCount, error: externalTaskError } =
      await admin
        .from("account_deletion_external_tasks")
        .select("id", { count: "exact", head: true })
        .eq("request_id", requestId);

    if (externalTaskError || externalTaskCount === null) {
      throw new Error("Externe afhandeling niet controleerbaar.");
    }

    if (externalTaskCount !== 0) {
      return json(
        {
          requestId,
          error:
            "Dit verzoek heeft externe afhandeltaken en kan niet met deze tijdelijke uitvoerder worden afgerond.",
        },
        409
      );
    }

    /*
     * Controleer vóór de eerste opruiming ook of er lokale
     * mailtaken of trainerhistorie zijn die nieuwe externe
     * taken kunnen opleveren.
     *
     * Dit is een extra afbakening, geen vervanging van
     * de databasecontroles tijdens uitvoering.
     */
    if (!execution?.database_cleaned_at) {
      stage = "assess_supported_player_path";

      const { data: assessment, error: assessmentError } =
        await admin.rpc("assess_account_deletion_request", {
          p_request_id: requestId,
        });

      if (
        assessmentError ||
        !isObject(assessment) ||
        assessment.request_id !== requestId ||
        !isObject(assessment.counts)
      ) {
        throw new Error("Spelerpad niet controleerbaar.");
      }

      const trainerCount = assessment.counts.trainer_profiles;
      const mailCount = assessment.counts.related_email_jobs;

      if (
        typeof trainerCount !== "number" ||
        typeof mailCount !== "number"
      ) {
        throw new Error("Onverwachte beoordelingsaantallen.");
      }

      if (trainerCount !== 0 || mailCount !== 0) {
        return json(
          {
            requestId,
            error:
              "Dit spelerverzoek heeft trainergegevens of mailtaken en vereist aanvullende afhandeling. Er is geen nieuwe opruimfase gestart.",
          },
          409
        );
      }
    }

    /*
     * Een lokale eindcontrole was al uitgevoerd, maar de
     * administratieve afsluiting mogelijk nog niet.
     */
    if (execution?.local_completed_at) {
      return await completeRequest();
    }

    /*
     * Hervatten na een mogelijk verloren Auth-antwoord:
     * eerst afwezigheid controleren.
     */
    if (execution?.auth_delete_started_at) {
      stage = "recover_auth_result";

      if (await confirmAuthAbsence()) {
        return await finishAfterAuthDeletion();
      }

      if (
        execution.auth_deleted_at ||
        deletionRequest.user_id === null
      ) {
        throw new Error(
          "Eerdere Auth-verwijdering niet opnieuw bevestigd."
        );
      }
    }

    if (!execution?.database_cleaned_at) {
      stage = "database_cleanup";

      const { data, error } = await admin.rpc(
        "finish_simple_account_deletion_database",
        { p_request_id: requestId }
      );

      if (
        error ||
        !isObject(data) ||
        data.request_id !== requestId ||
        data.database_cleanup_confirmed !== true
      ) {
        throw new Error("Database-opruiming niet bevestigd.");
      }

      execution = await readExecution();
    }

    if (
      !execution?.target_user_id ||
      !execution.database_cleaned_at ||
      execution.target_trainer_id
    ) {
      throw new Error("Uitvoervoortgang onvolledig of afwijkend.");
    }

    /*
     * De staging kan externe referenties hebben vastgelegd.
     * Daarom na de lokale fase opnieuw controleren.
     */
    stage = "recheck_external_tasks";

    const { count: remainingTasks, error: remainingTaskError } =
      await admin
        .from("account_deletion_external_tasks")
        .select("id", { count: "exact", head: true })
        .eq("request_id", requestId);

    if (remainingTaskError || remainingTasks === null) {
      throw new Error("Externe taken niet opnieuw controleerbaar.");
    }

    if (remainingTasks !== 0) {
      return json(
        {
          requestId,
          stage,
          requestCompleted: false,
          error:
            "Er zijn externe afhandeltaken gevonden. De lokale voorbereiding kan al zijn vastgelegd, maar Auth-verwijdering is niet uitgevoerd.",
        },
        409
      );
    }

    if (!execution.auth_delete_started_at) {
      stage = "start_auth_phase";

      const { data, error } = await admin.rpc(
        "start_account_deletion_auth_phase",
        { p_request_id: requestId }
      );

      if (
        error ||
        !isObject(data) ||
        data.request_id !== requestId ||
        data.auth_phase_started !== true ||
        data.target_user_id !== execution.target_user_id
      ) {
        throw new Error("Auth-fase niet bevestigd.");
      }

      execution = await readExecution();
    }

    if (
      !execution?.target_user_id ||
      !execution.auth_delete_started_at
    ) {
      throw new Error("Auth-uitvoergegevens ontbreken.");
    }

    const targetUserId = execution.target_user_id;

    stage = "check_auth_account";

    const { data: authData, error: authLookupError } =
      await admin.auth.admin.getUserById(targetUserId);

    if (authLookupError || !authData.user) {
      /*
       * Een willekeurige Auth-API-fout is geen bewijs
       * dat het account is verdwenen.
       */
      if (await confirmAuthAbsence()) {
        return await finishAfterAuthDeletion();
      }

      throw new Error("Auth-aanwezigheid niet bevestigd.");
    }

    if (authData.user.id !== targetUserId) {
      throw new Error("Auth-identiteit wijkt af.");
    }

    /*
     * Maximaal één expliciete deleteUser-aanroep per
     * HTTP-uitvoering. Geen automatische herhaallus.
     */
    stage = "delete_auth_account";

    let deleteApiReturnedError = false;

    try {
      const { error } = await admin.auth.admin.deleteUser(
        targetUserId,
        false
      );

      deleteApiReturnedError = Boolean(error);
    } catch {
      deleteApiReturnedError = true;
    }

    stage = "confirm_auth_absence";

    if (await confirmAuthAbsence()) {
      return await finishAfterAuthDeletion();
    }

    return json(
      {
        requestId,
        stage,
        authAbsenceConfirmed: false,
        deleteApiReturnedError,
        requestCompleted: false,
        error:
          "Auth-verwijdering kon niet worden bevestigd. Eerdere fasen kunnen al zijn vastgelegd. Controleer de voortgang; er wordt niet automatisch opnieuw verwijderd.",
      },
      503
    );
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return json(
        { error: "Ongeldige aanvraaginhoud." },
        400
      );
    }

    /*
     * Geen ruwe providerfouten, persoonsgegevens,
     * sleutels of tokens loggen of teruggeven.
     */
    return json(
      {
        stage,
        requestCompleted: false,
        error:
          "De uitvoering kon niet worden bevestigd. Eerdere fasen kunnen al zijn vastgelegd. Controleer eerst de opgeslagen voortgang; er wordt niet automatisch opnieuw geprobeerd.",
      },
      503
    );
  }
}