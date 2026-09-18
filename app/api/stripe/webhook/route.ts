import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { confirmPaidPackageSessionById } from "@/lib/confirm-paid-package-session";
import { syncStripeRefund } from "@/lib/sync-stripe-refund";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
const stripeWebhookSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");

const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseServiceRoleKey = getRequiredEnv(
  "SUPABASE_SERVICE_ROLE_KEY"
);

const stripe = new Stripe(stripeSecretKey);

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);


/* -------------------------------------------------------------------------- */
/* Stripe Connect                                                             */
/* -------------------------------------------------------------------------- */

async function syncTrainerStripeStatus(
  account: Stripe.Account
): Promise<void> {
  const trainerIdFromMetadata =
    account.metadata?.gowtrain_trainer_id?.trim() || null;

  let trainerId: string | null = null;

  if (trainerIdFromMetadata) {
    const { data, error } = await supabaseAdmin
      .from("trainers")
      .select("id")
      .eq("id", trainerIdFromMetadata)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Trainer zoeken via Stripe metadata mislukt: ${error.message}`
      );
    }

    trainerId = data?.id ?? null;
  }

  if (!trainerId) {
    const { data, error } = await supabaseAdmin
      .from("trainers")
      .select("id")
      .eq("stripe_account_id", account.id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Trainer zoeken via Stripe account-ID mislukt: ${error.message}`
      );
    }

    trainerId = data?.id ?? null;
  }

  if (!trainerId) {
    console.warn(
      `Geen Gowtrain-trainer gevonden voor Stripe-account ${account.id}.`
    );
    return;
  }

  const onboardingComplete =
    account.details_submitted === true &&
    account.payouts_enabled === true;

  const { error: updateError } = await supabaseAdmin
    .from("trainers")
    .update({
      stripe_account_id: account.id,
      stripe_details_submitted: account.details_submitted,
      stripe_charges_enabled: account.charges_enabled,
      stripe_payouts_enabled: account.payouts_enabled,
      stripe_onboarding_completed_at: onboardingComplete
        ? new Date().toISOString()
        : null,
    })
    .eq("id", trainerId);

  if (updateError) {
    throw new Error(
      `Stripe-status opslaan bij trainer mislukt: ${updateError.message}`
    );
  }

  console.log(
    `Stripe Connect-account bijgewerkt voor trainer ${trainerId}: ${account.id}`
  );
}

/* -------------------------------------------------------------------------- */
/* Betaalde lespakketten: nieuwe aankoopstructuur                              */
/* -------------------------------------------------------------------------- */

async function confirmPaidPackageSession(
  session: Stripe.Checkout.Session
): Promise<void> {
  const purchaseId = await confirmPaidPackageSessionById(
    session.id
  );

  console.log("Pakketaankoop bevestigd:", {
    purchaseId,
    checkoutSessionId: session.id,
  });
}

/* -------------------------------------------------------------------------- */
/* Betalingen: losse lessen en lespakketten                                    */
/* -------------------------------------------------------------------------- */

async function confirmPaidCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<void> {
  /*
   * Checkout kan afgerond zijn terwijl een vertraagde
   * betaling nog niet geslaagd is.
   *
   * checkout.session.async_payment_succeeded roept deze
   * functie later opnieuw aan wanneer de betaling slaagt.
   */
  if (session.payment_status !== "paid") {
    console.log(
      `Checkout Session ${session.id} is nog niet betaald: ${session.payment_status}`
    );
    return;
  }

  const packageId =
    session.metadata?.package_id?.trim() || null;

  const isPackageCheckout =
    session.metadata?.booking_type === "package" ||
    packageId !== null;

  /*
   * 1. LESPAKKET
   */
  if (isPackageCheckout) {
    await confirmPaidPackageSession(session);
    return;
  }

  /*
   * 2. LOSSE LES
   *
   * Bestaande afhandeling behouden.
   */
  const bookingId =
    session.metadata?.gowtrain_booking_id?.trim() || null;

  if (!bookingId) {
    console.warn(
      `Geen gowtrain_booking_id of package_id gevonden in Checkout Session ${session.id}.`
    );
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { data: confirmed, error } = await supabaseAdmin.rpc(
    "confirm_paid_booking",
    {
      p_booking_id: bookingId,
      p_checkout_session_id: session.id,
      p_payment_intent_id: paymentIntentId,
    }
  );

  if (error) {
    throw new Error(
      `Betaling bevestigen mislukt: ${error.message}`
    );
  }

  console.log(
    `Stripe Checkout ${session.id} verwerkt voor booking ${bookingId}. Bevestigd: ${confirmed}`
  );
}

/* -------------------------------------------------------------------------- */
/* Refunds: uitsluitend gecontroleerde refundadministratie                     */
/* -------------------------------------------------------------------------- */

async function processStripeRefundEvent(
  refund: Stripe.Refund
): Promise<void> {
  /*
   * Haal de bestaande refund opnieuw op en verifieer
   * opdracht, betaling, bedrag, valuta en omgeving.
   *
   * Deze helper maakt geen refund aan.
   */
  const result = await syncStripeRefund(refund.id);

  if (result.handled) {
    return;
  }

  /*
   * Geen metadata voor de nieuwe administratie:
   * geen boeking zoeken via oude metadata en geen directe
   * wijziging van boeking, slot, melding of trainerstatus.
   *
   * Dit kan een oude sandboxrefund of een externe refund zijn.
   * Het event wordt geaccepteerd, maar niet administratief toegepast.
   */
  console.warn("Refund niet automatisch administratief verwerkt:", {
    refundId: refund.id,
    reason: "NO_GOWTRAIN_REFUND_REQUEST_METADATA",
  });
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Stripe-signature ontbreekt." },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    /*
     * Gebruik de ongewijzigde requestbody voor
     * de Stripe-handtekeningcontrole.
     */
    const rawBody = await request.text();

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      stripeWebhookSecret
    );
  } catch (error) {
    console.error(
      "Stripe webhook signature fout:",
      error
    );

    return NextResponse.json(
      { error: "Webhook-signature is ongeldig." },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account =
          event.data.object as Stripe.Account;

        await syncTrainerStripeStatus(account);
        break;
      }

      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session =
          event.data.object as Stripe.Checkout.Session;

        await confirmPaidCheckoutSession(session);
        break;
      }

case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        const refund = event.data.object as Stripe.Refund;

        await processStripeRefundEvent(refund);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;

        /*
         * Aanvullende verwerking.
         * Deze embedded lijst hoeft niet alle refunds te bevatten.
         * De individuele refund-events blijven de primaire bron.
         */
        for (const refund of charge.refunds?.data ?? []) {
          await processStripeRefundEvent(refund);
        }

        break;
      }

      default:
        console.log(
          `Onverwerkt Stripe-event: ${event.type}`
        );
    }

    return NextResponse.json({
      received: true,
    });
  } catch (error) {
    console.error("Stripe webhook verwerking fout:", {
      eventId: event.id,
      eventType: event.type,
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return NextResponse.json(
      { error: "Webhook kon niet worden verwerkt." },
      { status: 500 }
    );
  }
}