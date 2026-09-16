import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { findStripeRefund } from "@/lib/find-stripe-refund";
import { syncStripeRefund } from "@/lib/sync-stripe-refund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Herstel van één bestaande refundopdracht.
 *
 * Deze route:
 * - maakt GEEN Stripe-refund aan;
 * - zet GEEN opdracht terug op queued;
 * - wijzigt GEEN idempotency key of pogingenteller;
 * - synchroniseert uitsluitend een bestaande Stripe-refund.
 *
 * Bij succeeded kan de bestaande sync-helper de administratieve
 * afronding uitvoeren en daardoor een refundmail klaarzetten.
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
        error: "Deze herstelroute is voorlopig uitsluitend voor sandbox.",
      },
      403,
    );
  }

  let requestId = "";

  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Ongeldige JSON." }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return json({ error: "Ongeldige aanvraag." }, 400);
    }

    const suppliedId = (body as Record<string, unknown>)
      .refundRequestId;

    if (
      typeof suppliedId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        suppliedId.trim(),
      )
    ) {
      return json(
        { error: "Een geldig refundRequestId is verplicht." },
        400,
      );
    }

    requestId = suppliedId.trim().toLowerCase();

    const { data: refundRequest, error } = await supabaseAdmin
      .from("refund_requests")
      .select(`
        id,
        status,
        stripe_livemode,
        stripe_payment_intent_id,
        stripe_refund_id,
        first_stripe_request_at,
        stripe_request_payload,
        locked_until,
        applied_at
      `)
      .eq("id", requestId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Refundopdracht ophalen mislukt: ${error.message}`,
      );
    }

    if (!refundRequest) {
      return json({ error: "Refundopdracht niet gevonden." }, 404);
    }

    if (refundRequest.stripe_livemode !== false) {
      return json(
        { error: "Deze opdracht is geen sandbox-refund." },
        409,
      );
    }

    /*
     * Laat een nog geldige workerclaim eerst afronden.
     * Een onbekende lease behandelen we conservatief.
     */
    if (refundRequest.status === "processing") {
      const leaseEnd = Date.parse(
        refundRequest.locked_until ?? "",
      );

      if (
        !Number.isFinite(leaseEnd) ||
        leaseEnd > Date.now()
      ) {
        return json({
          success: true,
          reconciled: false,
          requestId,
          finding: "WORKER_CLAIM_ACTIVE_OR_UNKNOWN",
          message:
            "De workerclaim is nog actief of kan niet worden beoordeeld. Niets gewijzigd.",
        });
      }
    }

    /*
     * Zonder voorbereide aanvraag mag onze sync-helper geen
     * Stripe-resultaat toepassen.
     *
     * Dit geldt voor de bekende oude testrefund:
     * de bronbetalingscontrole stopte vóór de Stripe-aanvraag.
     */
    if (
      !refundRequest.first_stripe_request_at ||
      !refundRequest.stripe_request_payload
    ) {
      return json({
        success: true,
        reconciled: false,
        requestId,
        finding: "NO_PREPARED_REQUEST",
        message:
          "Er is geen voorbereide Stripe-refundaanvraag vastgelegd. Deze route vraagt niets aan en laat de opdracht ongewijzigd.",
      });
    }

    if (refundRequest.status === "queued") {
      return json(
        {
          success: false,
          reconciled: false,
          requestId,
          finding: "INCONSISTENT_QUEUED_REQUEST",
          message:
            "Een queued-opdracht bevat al aanvraaggegevens. Eerst onderzoeken; niets gewijzigd.",
        },
        409,
      );
    }

    let refundId = refundRequest.stripe_refund_id;

    if (!refundId) {
      const lookup = await findStripeRefund(stripe, {
        requestId: refundRequest.id,
        paymentIntentId:
          refundRequest.stripe_payment_intent_id,
      });

      if (lookup.outcome === "not_found") {
        return json({
          success: true,
          reconciled: false,
          requestId,
          finding: "NOT_FOUND",
          message:
            "Geen passende refund gevonden in deze zoekactie. De opdracht blijft ongewijzigd. Dit geeft geen toestemming om opnieuw terug te betalen.",
        });
      }

      if (lookup.outcome === "inconclusive") {
        return json(
          {
            success: false,
            reconciled: false,
            requestId,
            finding: "INCONCLUSIVE",
            message: lookup.reason,
          },
          503,
        );
      }

      refundId = lookup.refundId;
    }

    /*
     * De gedeelde helper haalt de refund opnieuw op.
     * Hij controleert metadata, betaling, bedrag en omgeving.
     * De databasefuncties controleren de actuele registratie.
     */
    const result = await syncStripeRefund(
      refundId,
      refundRequest.id,
    );

    if (!result.handled) {
      throw new Error(
        "De refund kon niet aan deze opdracht worden gekoppeld.",
      );
    }

    return json({
      success: true,
      reconciled: true,
      requestId: result.requestId,
      refundId: result.refundId,
      refundStatus: result.status,
      applied: result.applied,
    });
  } catch (error: unknown) {
    console.error("Refundherstel niet afgerond:", {
      requestId: requestId || null,
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    /*
     * Sync kan de Stripe-status al hebben opgeslagen voordat
     * de administratieve afronding mislukt.
     * Daarom niet beweren dat er zeker niets gewijzigd is.
     */
    return json(
      {
        success: false,
        requestId: requestId || null,
        error:
          "Het herstel kon niet volledig worden bevestigd. Controleer de refundregistratie. Er is door deze route geen nieuwe Stripe-refund aangevraagd.",
      },
      503,
    );
  }
}