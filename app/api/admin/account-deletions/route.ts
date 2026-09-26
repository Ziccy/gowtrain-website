import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 20;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
  "https://gowtrain.com",
]);

if (process.env.NODE_ENV === "development") {
  ALLOWED_ORIGINS.add("http://localhost:3000");
}

type RequestRow = {
  id: string;
  requester_role: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
  auxiliary_cleaned_at: string | null;
};

type QueueRow = {
  request_id: string;
  status: string;
  queued_at: string;
  claimed_at: string | null;
  finished_at: string | null;
};

type ExecutionRow = {
  request_id: string;
  created_at: string;
  trainer_cleaned_at: string | null;
  database_cleaned_at: string | null;
  auth_delete_started_at: string | null;
  auth_deleted_at: string | null;
  local_completed_at: string | null;
  target_reference_erased_at: string | null;
};

type FollowupRow = {
  request_id: string;
  assigned_admin_id: string | null;
  next_action: string;
  review_after: string;
  version: number;
  updated_at: string;
};

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Authorization, Origin",
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

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  /*
   * Deze API is voor de website-adminomgeving.
   * Geen CORS-toegang voor Expo of andere browser-origins.
   * Bearer-authenticatie en admincontrole blijven beslissend.
   */
  const origin = request.headers.get("origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Deze oorsprong is niet toegestaan." }, 403);
  }

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!token) {
    return json({ error: "Je moet ingelogd zijn als beheerder." }, 401);
  }

  try {
    const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");

    const authOptions = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    };

    const authClient = createClient(
      supabaseUrl,
      requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      authOptions
    );

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return json(
        { error: "Je sessie kon niet worden bevestigd. Log opnieuw in." },
        401
      );
    }

    const admin = createClient(
      supabaseUrl,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      authOptions
    );

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error("ADMIN_CHECK_FAILED");
    }

    if (profile?.role !== "admin") {
      return json({ error: "Je hebt geen beheerrechten." }, 403);
    }

    const requestId = request.nextUrl.searchParams.get("requestId");

    /*
     * Details: alleen op expliciet openen opnieuw beoordelen.
     * De beoordelingsfunctie leest uitsluitend gegevens.
     */
    if (requestId !== null) {
      if (!UUID_PATTERN.test(requestId)) {
        return json({ error: "Ongeldig verzoek-ID." }, 400);
      }

      const { data: deletionRequest, error: requestError } = await admin
        .from("account_deletion_requests")
        .select("id, status")
        .eq("id", requestId)
        .maybeSingle();

      if (requestError) {
        throw new Error("REQUEST_LOOKUP_FAILED");
      }

      if (!deletionRequest) {
        return json({ error: "Verwijderverzoek niet gevonden." }, 404);
      }

      const { data: execution, error: executionError } = await admin
        .from("account_deletion_executions")
        .select("request_id")
        .eq("request_id", requestId)
        .maybeSingle();

      if (executionError) {
        throw new Error("EXECUTION_LOOKUP_FAILED");
      }

      const externalResults = await Promise.all(
        ["pending", "needs_review"].map(async (status) => {
          const { count, error } = await admin
            .from("account_deletion_external_tasks")
            .select("id", { count: "exact", head: true })
            .eq("request_id", requestId)
            .eq("status", status);

          if (error || count === null) {
            throw new Error("EXTERNAL_TASK_LOOKUP_FAILED");
          }

          return { status, count };
        })
      );

      let assessment: {
        outcome: string;
        reasons: string[];
        counts: Record<string, number>;
      } | null = null;

      let assessmentNote =
        "Geen nieuwe beoordeling uitgevoerd.";

      /*
       * Na begin van opruiming is een beoordeling via de
       * oorspronkelijke profielrelaties niet meer volledig.
       * Gebruik die dan niet als nieuwe verwijdervrijgave.
       */
      if (deletionRequest.status === "requested" && !execution) {
        const { data, error } = await admin.rpc(
          "assess_account_deletion_request",
          { p_request_id: requestId }
        );

        if (
          !error &&
          isObject(data) &&
          data.request_id === requestId &&
          (
            data.assessment === "simple_path_candidate" ||
            data.assessment === "requires_review"
          ) &&
          Array.isArray(data.reasons) &&
          data.reasons.every((value) => typeof value === "string") &&
          isObject(data.counts)
        ) {
          const counts: Record<string, number> = {};
          let valid = true;

          for (const [key, value] of Object.entries(data.counts)) {
            if (
              typeof value !== "number" ||
              !Number.isSafeInteger(value) ||
              value < 0
            ) {
              valid = false;
              break;
            }

            counts[key] = value;
          }

          if (valid) {
            assessment = {
              outcome: data.assessment,
              reasons: data.reasons as string[],
              counts,
            };
          }
        }

        assessmentNote = assessment
          ? "Actuele beoordeling, niet de oorspronkelijk door de worker gemelde reden. Dit resultaat verleent geen uitvoertoestemming."
          : "De actuele beoordeling kon niet worden bevestigd. Behandel dit niet als afwezigheid van afhankelijkheden.";
      } else if (deletionRequest.status === "completed") {
        assessmentNote =
          "Verzoek afgerond. De technische accountreferentie kan al gewist zijn; er wordt geen nieuwe inventarisatie op dat account uitgevoerd.";
      } else {
        assessmentNote =
          "Er is al uitvoering of aanvullende afhandeling geregistreerd. Gebruik de vastgelegde fasen; de oorspronkelijke beoordeling wordt niet als actuele herstelvrijgave herhaald.";
      }

      return json({
        requestId,
        assessment,
        assessmentNote,
        externalTasks: externalResults,
        checkedAt: new Date().toISOString(),
      });
    }

    /* GE PAGINEERD OVERZICHT */

    const pageText = request.nextUrl.searchParams.get("page") ?? "1";

    if (!/^[1-9]\d*$/.test(pageText)) {
      return json({ error: "Ongeldig paginanummer." }, 400);
    }

    const page = Number(pageText);

    if (!Number.isSafeInteger(page) || page > 100_000) {
      return json({ error: "Ongeldig paginanummer." }, 400);
    }

    const from = (page - 1) * PAGE_SIZE;

    // Eén extra rij om te bepalen of een volgende pagina bestaat.
    const { data: requestData, error: requestsError } = await admin
      .from("account_deletion_requests")
      .select(`
        id,
        requester_role,
        status,
        requested_at,
        completed_at,
        auxiliary_cleaned_at
      `)
      .order("requested_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE);

    if (requestsError) {
      throw new Error("REQUESTS_LOOKUP_FAILED");
    }

    const fetched = (requestData ?? []) as RequestRow[];
    const hasMore = fetched.length > PAGE_SIZE;
    const requests = fetched.slice(0, PAGE_SIZE);
    const ids = requests.map((item) => item.id);

    if (ids.length === 0) {
      return json({
        items: [],
        page,
        pageSize: PAGE_SIZE,
        hasMore: false,
        checkedAt: new Date().toISOString(),
      });
    }

const [queueResult, executionResult, followupResult] =
  await Promise.all([
    admin
      .from("account_deletion_queue")
      .select(
        "request_id, status, queued_at, claimed_at, finished_at"
      )
      .in("request_id", ids),

    admin
      .from("account_deletion_executions")
      .select(`
        request_id,
        created_at,
        trainer_cleaned_at,
        database_cleaned_at,
        auth_delete_started_at,
        auth_deleted_at,
        local_completed_at,
        target_reference_erased_at
      `)
      .in("request_id", ids),

    admin
      .from("account_deletion_followups")
      .select(`
        request_id,
        assigned_admin_id,
        next_action,
        review_after,
        version,
        updated_at
      `)
      .in("request_id", ids),
  ]);

if (
  queueResult.error ||
  executionResult.error ||
  followupResult.error
) {
  throw new Error("PROGRESS_LOOKUP_FAILED");
}

const followups = new Map(
  ((followupResult.data ?? []) as FollowupRow[]).map(
    (item) => [item.request_id, item]
  )
);

    const queues = new Map(
      ((queueResult.data ?? []) as QueueRow[]).map(
        (item) => [item.request_id, item]
      )
    );

    const executions = new Map(
      ((executionResult.data ?? []) as ExecutionRow[]).map(
        (item) => [item.request_id, item]
      )
    );

    /*
     * Exacte aantallen zonder alle externe referenties
     * naar de API of browser te laden.
     * Maximaal twintig count-aanvragen per pagina.
     */
    const externalCounts = await Promise.all(
      ids.map(async (id) => {
        const { count, error } = await admin
          .from("account_deletion_external_tasks")
          .select("id", { count: "exact", head: true })
          .eq("request_id", id);

        if (error || count === null) {
          throw new Error("EXTERNAL_COUNTS_FAILED");
        }

        return [id, count] as const;
      })
    );

    const countMap = new Map(externalCounts);

    return json({
  items: requests.map((item) => {
    const followup = followups.get(item.id);

    return {
      ...item,
      queue: queues.get(item.id) ?? null,
      execution: executions.get(item.id) ?? null,
      externalTaskCount: countMap.get(item.id) ?? 0,

      followup: followup
        ? {
            assigned: followup.assigned_admin_id !== null,
            assignedToCurrentAdmin:
              followup.assigned_admin_id === user.id,
            nextAction: followup.next_action,
            reviewAfter: followup.review_after,
            version: followup.version,
            updatedAt: followup.updated_at,
          }
        : null,
    };
  }),
  page,
  pageSize: PAGE_SIZE,
  hasMore,
  checkedAt: new Date().toISOString(),
});
  } catch {
    // Geen tokens, accountgegevens of ruwe databasefouten loggen.
    return json(
      {
        error:
          "Het verwijderoverzicht kon niet volledig worden geladen. Er zijn geen wijzigingen uitgevoerd.",
      },
      503
    );
  }
}