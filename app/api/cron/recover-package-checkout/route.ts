import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { findPackageCheckoutSession } from "@/lib/find-package-checkout-session";

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
  }
);

function getStripeLivemode(): boolean {
  if (
    stripeKey.startsWith("sk_test_") ||
    stripeKey.startsWith("rk_test_")
  ) {
    return false;
  }

  if (
    stripeKey.startsWith("sk_live_") ||
    stripeKey.startsWith("rk_live_")
  ) {
    return true;
  }

  throw new Error("Onbekend Stripe-keyformaat.");
}

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

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  if (
    request.headers.get("authorization") !==
    `Bearer ${cronSecret}`
  ) {
    return json({ error: "Niet geautoriseerd." }, 401);
  }

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

    const attemptId = (body as Record<string, unknown>).attemptId;

    if (
      typeof attemptId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        attemptId
      )
    ) {
      return json(
        { error: "Een geldig attemptId is verplicht." },
        400
      );
    }

    /*
     * Deze herstelroute verwerkt één expliciet opgegeven poging.
     * Geen nieuwe betaalpogingen aanmaken.
     */
    const { data: attempt, error: attemptError } =
      await supabaseAdmin
        .from("checkout_attempts")
        .select(
          `
            id,
            package_id,
            booking_id,
            player_id,
            trainer_id,
            checkout_mode,
            status,
            amount_cents,
            currency,
            funds_flow,
            stripe_livemode,
            stripe_checkout_session_id,
            stripe_payment_intent_id,
            stripe_idempotency_key,
            first_stripe_request_at,
            checkout_parameters,
            paid_at
          `
        )
        .eq("id", attemptId)
        .maybeSingle();

    if (attemptError) {
      console.error("Herstelpoging ophalen mislukt:", {
        code: attemptError.code,
        message: attemptError.message,
      });

      return json(
        { error: "De betaalpoging kon niet worden opgehaald." },
        503
      );
    }

    if (!attempt) {
      return json({ error: "Betaalpoging niet gevonden." }, 404);
    }

    if (
      !attempt.package_id ||
      attempt.booking_id !== null ||
      attempt.stripe_livemode !== getStripeLivemode() ||
      attempt.funds_flow !== "separate_transfers_v1"
    ) {
      return json(
        {
          error:
            "Deze poging hoort niet bij de ondersteunde pakketflow of Stripe-omgeving.",
        },
        409
      );
    }

    if (
      attempt.status !== "creating" ||
      attempt.stripe_checkout_session_id !== null ||
      attempt.paid_at !== null
    ) {
      return json({
        success: true,
        recovered: false,
        reason:
          "Deze poging is niet meer een creating-poging zonder Session-ID. Niets gewijzigd.",
      });
    }

    if (
      !attempt.first_stripe_request_at ||
      !attempt.checkout_parameters
    ) {
      return json(
        {
          error:
            "De oorspronkelijke Stripe-aanvraag is onvoldoende vastgelegd. Handmatige controle nodig.",
        },
        409
      );
    }

    const firstRequestAt = Date.parse(
      attempt.first_stripe_request_at
    );

    /*
     * Geef de oorspronkelijke aanvraag eerst tijd om af te ronden.
     * Dit is geen bewijs dat een aanvraag na twee minuten gestopt is.
     * De verdere verwerking blijft daarom voorwaardelijk.
     */
    if (
      !Number.isFinite(firstRequestAt) ||
      Date.now() - firstRequestAt < 2 * 60 * 1000
    ) {
      return json({
        success: true,
        recovered: false,
        reason:
          "De poging is nog te recent of heeft een ongeldige starttijd. Later opnieuw controleren.",
      });
    }

    /*
     * Alleen zoeken in Stripe; geen Session aanmaken.
     */
    const lookup = await findPackageCheckoutSession(stripe, {
      attemptId: attempt.id,
      firstStripeRequestAt: attempt.first_stripe_request_at,
    });

    if (lookup.outcome === "not_found") {
      return json({
        success: true,
        recovered: false,
        finding: "NOT_FOUND",
        reason:
          "Geen overeenkomstige Session gevonden in deze zoekactie. De reservering blijft behouden; niet automatisch vrijgegeven.",
      });
    }

    if (lookup.outcome === "inconclusive") {
      return json({
        success: true,
        recovered: false,
        finding: "INCONCLUSIVE",
        reason: lookup.reason,
      });
    }

    /*
     * Lees de gevonden Session opnieuw voor de actuele status.
     * Retourneer nooit het volledige Session-object.
     */
    const session = await stripe.checkout.sessions.retrieve(
      lookup.session.id
    );

    const expectedUiMode =
      attempt.checkout_mode === "embedded"
        ? "embedded_page"
        : attempt.checkout_mode === "hosted"
          ? "hosted"
          : null;

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    const matches =
      expectedUiMode !== null &&
      session.mode === "payment" &&
      String(session.ui_mode) === expectedUiMode &&
      session.livemode === attempt.stripe_livemode &&
      session.client_reference_id === attempt.id &&
      session.metadata?.gowtrain_checkout_attempt_id === attempt.id &&
      session.metadata?.package_id === attempt.package_id &&
      session.metadata?.player_id === attempt.player_id &&
      session.metadata?.trainer_id === attempt.trainer_id &&
      session.metadata?.booking_type === "package" &&
      session.metadata?.gowtrain_funds_flow ===
        "separate_transfers_v1" &&
      session.amount_total === attempt.amount_cents &&
      session.currency === attempt.currency &&
      (
        attempt.stripe_payment_intent_id === null ||
        attempt.stripe_payment_intent_id === paymentIntentId
      );

    if (!matches) {
      return json(
        {
          success: false,
          recovered: false,
          reason:
            "De gevonden Stripe Session wijkt af van de betaalpoging. Handmatige controle nodig.",
        },
        409
      );
    }

    if (
      session.status !== "open" &&
      session.status !== "complete" &&
      session.status !== "expired"
    ) {
      return json(
        {
          success: false,
          recovered: false,
          reason:
            "Onbekende Stripe Checkout-status. Niets gewijzigd.",
        },
        409
      );
    }

    /*
     * Koppel alleen de Session.
     *
     * Een afgeronde of betaalde Session wordt niet opnieuw
     * als betaalbaar aangeboden. De betaalwebhook moet de
     * betaling controleren en de aankoop vastleggen.
     *
     * Een verlopen Session krijgt hier status open in onze
     * database zodat de bestaande Stripe-bewuste opruimroute
     * haar kan onderzoeken. De opgeslagen Session-deadline
     * voorkomt dat de UI een hervatknop aanbiedt.
     */
    const needsPaymentReconciliation =
      session.status === "complete" ||
      session.payment_status === "paid";

    const newStatus = needsPaymentReconciliation
      ? "payment_processing"
      : "open";

    const now = new Date().toISOString();

    const { data: saved, error: saveError } =
      await supabaseAdmin
        .from("checkout_attempts")
        .update({
          stripe_checkout_session_id: session.id,
          stripe_session_expires_at: new Date(
            session.expires_at * 1000
          ).toISOString(),
          status: newStatus,
          next_cleanup_check_at: now,
          last_stripe_check_at: now,
          last_error: null,
          updated_at: now,
        })
        .eq("id", attempt.id)
        .eq("status", "creating")
        .eq("stripe_idempotency_key", attempt.stripe_idempotency_key)
        .is("stripe_checkout_session_id", null)
        .is("paid_at", null)
        .select("id")
        .maybeSingle();

    if (saveError) {
      console.error("Stripe Session koppelen mislukt:", {
        attemptId: attempt.id,
        code: saveError.code,
        message: saveError.message,
      });

      return json(
        {
          error:
            "Het opslaan van de gevonden Session kon niet worden bevestigd. Controleer de poging opnieuw.",
        },
        503
      );
    }

    if (!saved) {
      return json({
        success: true,
        recovered: false,
        reason:
          "De poging is ondertussen gewijzigd. Geen gegevens overschreven.",
      });
    }

    console.log("Stripe Session teruggevonden en gekoppeld:", {
      attemptId: attempt.id,
      checkoutSessionId: session.id,
      status: newStatus,
    });

    return json({
      success: true,
      recovered: true,
      attemptId: attempt.id,
      checkoutSessionId: session.id,
      databaseStatus: newStatus,
      stripeCheckoutStatus: session.status,
      stripePaymentStatus: session.payment_status,
      needsPaymentReconciliation,
    });
  } catch (error: unknown) {
    console.error("Pakketbetaalpoging herstellen mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return json(
      {
        error:
          "Het herstel kon niet worden afgerond. De reservering wordt niet op basis van deze fout vrijgegeven.",
      },
      503
    );
  }
}