import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { closeExpiredSingleLessonPayment } from
  "@/lib/close-expired-single-lesson-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const WORKER_REVISION = "single-payment-cleanup-v1";

const TEST_PLAYER_ID =
  "3c274d07-c386-4a93-9db7-a5541b836ca4";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outcome =
  | "not_due"
  | "requires_review"
  | "payment_pending"
  | "payment_applied"
  | "closed"
  | "already_closed"
  | "error";

const ALLOWED_OUTCOMES: readonly Outcome[] = [
  "not_due",
  "requires_review",
  "payment_pending",
  "payment_applied",
  "closed",
  "already_closed",
  "error",
];

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
    throw new Error("CLEANUP_CONFIGURATION_MISSING");
  }

  return value;
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value)
  );
}

function secretMatches(
  supplied: string | null,
  expected: string
): boolean {
  if (!supplied || !/^[0-9a-f]{64}$/i.test(supplied)) {
    return false;
  }

  const actualBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  if (
    process.env.SINGLE_PAYMENT_CLEANUP_WORKER_ENABLED !== "true"
  ) {
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
   * De workersleutel is beslissend, niet Host of Origin.
   */
  if (request.headers.has("origin")) {
    return json({ error: "Geen browsertoegang." }, 403);
  }

  let stage = "configuration";

  let finishClaim:
    | ((outcome: Outcome) => Promise<boolean>)
    | null = null;

  let executionOutcome: Outcome | null = null;

  try {
    const secret = requiredEnv(
      "SINGLE_PAYMENT_CLEANUP_WORKER_SECRET"
    );

    if (!/^[0-9a-f]{64}$/i.test(secret)) {
      throw new Error("CLEANUP_SECRET_FORMAT_INVALID");
    }

    if (
      !secretMatches(
        request.headers.get("x-single-payment-cleanup-secret"),
        secret
      )
    ) {
      return json({ error: "Geen workertoegang." }, 401);
    }

    /*
     * Geen boekings-ID of uitvoeropties uit de aanvraag gebruiken.
     * De database selecteert zelf uitsluitend toegestane kandidaten.
     */
    if (request.nextUrl.search) {
      return json(
        { error: "Deze worker accepteert geen queryparameters." },
        400
      );
    }

    const configuredPlayer = requiredEnv(
      "SINGLE_LESSON_PAYMENTSHEET_TEST_USER_ID"
    ).toLowerCase();

    if (configuredPlayer !== TEST_PLAYER_ID) {
      throw new Error("CLEANUP_TEST_SCOPE_MISMATCH");
    }

    const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

    if (
      !stripeKey.startsWith("sk_test_") &&
      !stripeKey.startsWith("rk_test_")
    ) {
      throw new Error("CLEANUP_TEST_MODE_REQUIRED");
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

    stage = "claim";

    const { data: claim, error: claimError } = await admin.rpc(
      "claim_single_payment_cleanup_job"
    );

    /*
     * Bij een verloren claimantwoord niet opnieuw claimen.
     * Een eventuele claim verloopt zelfstandig.
     */
    if (claimError || !isObject(claim)) {
      throw new Error("CLEANUP_CLAIM_NOT_CONFIRMED");
    }

    if (claim.state === "idle" || claim.state === "busy") {
      return json({
        workerRevision: WORKER_REVISION,
        state: claim.state,
        processed: 0,
      });
    }

    if (
      claim.state !== "claimed" ||
      !isUuid(claim.attempt_id) ||
      !isUuid(claim.booking_id) ||
      !isUuid(claim.claim_token) ||
      typeof claim.lease_expires_at !== "string" ||
      !Number.isFinite(Date.parse(claim.lease_expires_at))
    ) {
      throw new Error("CLEANUP_CLAIM_INVALID");
    }

    const attemptId = claim.attempt_id;
    const bookingId = claim.booking_id;
    const claimToken = claim.claim_token;

    finishClaim = async (outcome: Outcome): Promise<boolean> => {
      const { data, error } = await admin.rpc(
        "finish_single_payment_cleanup_job",
        {
          p_attempt_id: attemptId,
          p_claim_token: claimToken,
          p_outcome: outcome,
        }
      );

      return !error && data === true;
    };

    stage = "verify_claim";

    const { data: job, error: jobError } = await admin
      .from("single_payment_cleanup_jobs")
      .select("attempt_id, lease_expires_at")
      .eq("attempt_id", attemptId)
      .eq("claim_token", claimToken)
      .maybeSingle();

    if (
      jobError ||
      !job ||
      typeof job.lease_expires_at !== "string" ||
      !Number.isFinite(Date.parse(job.lease_expires_at)) ||
      Date.parse(job.lease_expires_at) <= Date.now() + 90_000
    ) {
      throw new Error("CLEANUP_CLAIM_NO_LONGER_CONFIRMED");
    }

    /*
     * Extra scopecontrole vóór de helper Stripe kan benaderen.
     * De helper controleert daarna zelf opnieuw de betaalcontext.
     */
    const { data: attempt, error: attemptError } = await admin
      .from("single_lesson_payment_attempts")
      .select(`
        id,
        booking_id,
        player_id,
        channel,
        stripe_livemode,
        funds_flow
      `)
      .eq("id", attemptId)
      .maybeSingle();

    if (
      attemptError ||
      !attempt ||
      attempt.booking_id !== bookingId ||
      attempt.player_id !== TEST_PLAYER_ID ||
      attempt.channel !== "paymentsheet" ||
      attempt.stripe_livemode !== false ||
      attempt.funds_flow !== "separate_transfers_v1"
    ) {
      throw new Error("CLEANUP_ATTEMPT_SCOPE_NOT_CONFIRMED");
    }

    stage = "close_expired_payment";

    /*
     * Eén poging, geen lus en geen nieuwe PaymentIntent.
     * De bestaande helper bepaalt of Stripe-annulering veilig is.
     */
    const closed = await closeExpiredSingleLessonPayment(
      attemptId
    );

    if (
      closed.attemptId !== attemptId ||
      closed.bookingId !== bookingId ||
      !ALLOWED_OUTCOMES.includes(closed.outcome)
    ) {
      throw new Error("CLEANUP_RESULT_CONTEXT_MISMATCH");
    }

    executionOutcome = closed.outcome;

    stage = "finish_claim";

    const recorded = await finishClaim(executionOutcome);

    if (!recorded) {
      throw new Error("CLEANUP_FINISH_NOT_CONFIRMED");
    }

    return json({
      workerRevision: WORKER_REVISION,
      state: "checked",
      processed: 1,
      outcome: executionOutcome,
      diagnosticRecorded: true,
    });
  } catch {
    /*
     * Geen volledige fouten, Stripe-objecten, sleutels of
     * claimtokens loggen of teruggeven.
     *
     * Als de helper een bevestigde uitkomst gaf maar het
     * opslaan mislukte, die uitkomst niet vervangen door "error".
     */
    let diagnosticRecorded = false;

    if (finishClaim) {
      try {
        diagnosticRecorded = await finishClaim(
          executionOutcome ?? "error"
        );
      } catch {
        // Bij proces-/database-uitval kan diagnostiek ontbreken.
      }
    }

    return json(
      {
        workerRevision: WORKER_REVISION,
        code: "CLEANUP_EXECUTION_NOT_CONFIRMED",
        stage,
        diagnosticRecorded,
        error:
          "De uitvoering kon niet volledig worden bevestigd. Een eerdere afsluitactie kan al zijn verwerkt. Controleer de opgeslagen status.",
      },
      503
    );
  }
}