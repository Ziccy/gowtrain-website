import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { findStripeRefund } from "@/lib/find-stripe-refund";
import { syncStripeRefund } from "@/lib/sync-stripe-refund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripeKey = requiredEnv("STRIPE_SECRET_KEY");
const cronSecret = requiredEnv("CRON_SECRET");

const stripe = new Stripe(stripeKey, {
  timeout: 10_000,
  maxNetworkRetries: 0,
});

const supabaseAdmin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

type Candidate = {
  id: string;
  status: string;
  stripe_payment_intent_id: string;
  stripe_refund_id: string | null;
  locked_until: string | null;
  next_reconciliation_at: string;
};

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isSandboxKey(): boolean {
  return (
    stripeKey.startsWith("sk_test_") ||
    stripeKey.startsWith("rk_test_")
  );
}

/*
 * Leg alleen het resultaat van deze controle vast.
 *
 * De voorwaarde op next_reconciliation_at voorkomt dat een
 * oude uitvoering de controlemelding van een nieuwere
 * uitvoering overschrijft.
 *
 * Refundstatus, workerclaim en aanvraagfout blijven ongemoeid.
 */
async function recordReconciliationOutcome(
  requestId: string,
  scheduledAt: string,
  message: string | null,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("refund_requests")
    .update({
      reconciliation_last_error: message
        ? message.slice(0, 2000)
        : null,
    })
    .eq("id", requestId)
    .eq("next_reconciliation_at", scheduledAt)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Resultaat refundcontrole opslaan mislukt:", {
      requestId,
      code: error.code,
      message: error.message,
    });

    return false;
  }

  return Boolean(data);
}

/*
 * Eén bestaande of mogelijk aangevraagde refund controleren.
 *
 * Geen refunds.create.
 * Geen automatische nieuwe aanvraag.
 * Geen reset naar queued.
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  if (
    request.headers.get("authorization") !==
    `Bearer ${cronSecret}`
  ) {
    return json({ error: "Niet geautoriseerd." }, 401);
  }

  if (!isSandboxKey()) {
    return json(
      {
        error:
          "Periodiek refundherstel is voorlopig uitsluitend beschikbaar in de sandbox.",
      },
      403,
    );
  }

  let selectedRequestId: string | null = null;
  let scheduledAt: string | null = null;

  try {
    const checkedAt = new Date().toISOString();

    /*
     * Alleen opdrachten met een voorbereide Stripe-aanvraag.
     *
     * Een processing-opdracht komt alleen in aanmerking als
     * de bekende workerlease verstreken is.
     *
     * Processing zonder leasedatum blijft buiten deze selectie:
     * die wordt door de bestaande claimfunctie bij een volgende
     * workeruitvoering als vastgelopen behandeld.
     */
    const eligibleStates = [
      "status.in.(pending,requires_action,review_required)",
      "and(status.eq.succeeded,applied_at.is.null)",
      `and(status.eq.processing,locked_until.lte.${checkedAt})`,
    ].join(",");

    const { data, error } = await supabaseAdmin
      .from("refund_requests")
      .select(`
        id,
        status,
        stripe_payment_intent_id,
        stripe_refund_id,
        locked_until,
        next_reconciliation_at
      `)
      .eq("stripe_livemode", false)
      .not("first_stripe_request_at", "is", null)
      .not("stripe_request_payload", "is", null)
      .lte("next_reconciliation_at", checkedAt)
      .or(eligibleStates)
      .order("next_reconciliation_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1);

    if (error) {
      throw new Error(
        `Refundkandidaat ophalen mislukt: ${error.message}`,
      );
    }

    const candidate = (data?.[0] ?? null) as Candidate | null;

    if (!candidate) {
      return json({
        success: true,
        checked: 0,
        message: "Geen geschikte refundcontrole beschikbaar.",
      });
    }

    /*
     * Reserveer het controlemoment met een voorwaardelijke update.
     * Herhaal de status- en leasevoorwaarden na de selectie.
     *
     * Bij twee gelijktijdige uitvoeringen kan maar één deze
     * specifieke oude planning vervangen.
     */
    const nextCheck = new Date(
      Date.now() + 10 * 60 * 1000,
    ).toISOString();

    const claimTime = new Date().toISOString();

    const currentEligibleStates = [
      "status.in.(pending,requires_action,review_required)",
      "and(status.eq.succeeded,applied_at.is.null)",
      `and(status.eq.processing,locked_until.lte.${claimTime})`,
    ].join(",");

    const { data: scheduled, error: scheduleError } =
      await supabaseAdmin
        .from("refund_requests")
        .update({
          next_reconciliation_at: nextCheck,
        })
        .eq("id", candidate.id)
        .eq("stripe_livemode", false)
        .eq(
          "next_reconciliation_at",
          candidate.next_reconciliation_at,
        )
        .not("first_stripe_request_at", "is", null)
        .not("stripe_request_payload", "is", null)
        .lte("next_reconciliation_at", claimTime)
        .or(currentEligibleStates)
        .select(`
          id,
          stripe_payment_intent_id,
          stripe_refund_id
        `)
        .maybeSingle();

    if (scheduleError) {
      throw new Error(
        `Refundcontrole plannen mislukt: ${scheduleError.message}`,
      );
    }

    if (!scheduled) {
      return json({
        success: true,
        checked: 0,
        finding: "CHANGED_OR_ALREADY_SCHEDULED",
        message:
          "De opdracht is gewijzigd of wordt door een andere uitvoering gecontroleerd.",
      });
    }

    selectedRequestId = scheduled.id;
    scheduledAt = nextCheck;

    let refundId: string | null = scheduled.stripe_refund_id;

    if (!refundId) {
      const lookup = await findStripeRefund(stripe, {
        requestId: scheduled.id,
        paymentIntentId: scheduled.stripe_payment_intent_id,
      });

      if (lookup.outcome !== "found") {
        const message =
          lookup.outcome === "not_found"
            ? "Geen passende Stripe-refund gevonden. Niet opnieuw aanvragen zonder aanvullende beoordeling."
            : lookup.reason;

        const outcomeSaved = await recordReconciliationOutcome(
          scheduled.id,
          nextCheck,
          message,
        );

        return json(
          {
            success:
              outcomeSaved && lookup.outcome === "not_found",
            checked: 1,
            reconciled: false,
            requestId: scheduled.id,
            finding:
              lookup.outcome === "not_found"
                ? "NOT_FOUND"
                : "INCONCLUSIVE",
            outcomeSaved,
            message,
          },
          outcomeSaved && lookup.outcome === "not_found"
            ? 200
            : 503,
        );
      }

      refundId = lookup.refundId;
    }

    const result = await syncStripeRefund(
      refundId,
      scheduled.id,
    );

    if (!result.handled) {
      throw new Error(
        "De bestaande Stripe-refund kon niet aan de opdracht worden gekoppeld.",
      );
    }

    const requiresManualAction = [
      "requires_action",
      "failed",
      "canceled",
    ].includes(result.status);

    const outcomeSaved = await recordReconciliationOutcome(
      scheduled.id,
      nextCheck,
      requiresManualAction
        ? `Stripe-refundstatus ${result.status}: handmatige beoordeling nodig. Geen nieuwe refund automatisch aanvragen.`
        : null,
    );

    return json(
      {
        success: outcomeSaved,
        checked: 1,
        reconciled: true,
        requestId: result.requestId,
        refundId: result.refundId,
        refundStatus: result.status,
        applied: result.applied,
        requiresManualAction,
        outcomeSaved,
      },
      outcomeSaved ? 200 : 503,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Onbekende fout tijdens periodieke refundcontrole.";

    console.error("Periodieke refundcontrole mislukt:", {
      requestId: selectedRequestId,
      message,
    });

    if (selectedRequestId && scheduledAt) {
      await recordReconciliationOutcome(
        selectedRequestId,
        scheduledAt,
        message,
      );
    }

    /*
     * De sync-helper kan de refundstatus al hebben opgeslagen
     * voordat administratieve afronding of resultaatopslag faalt.
     * Daarom niet beweren dat er zeker niets gewijzigd is.
     */
    return json(
      {
        success: false,
        requestId: selectedRequestId,
        error:
          "De refundcontrole kon niet volledig worden bevestigd. Controleer de registratie. Deze route heeft geen nieuwe Stripe-refund aangevraagd.",
      },
      503,
    );
  }
}