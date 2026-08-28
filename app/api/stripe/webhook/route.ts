import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
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

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type RefundBooking = {
  id: string;
  slot_id: string | null;
  status: string;
  cancellation_policy: string | null;
};

/* -------------------------------------------------------------------------- */
/* Stripe Connect                                                              */
/* -------------------------------------------------------------------------- */

async function syncTrainerStripeStatus(account: Stripe.Account): Promise<void> {
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

  /*
    Kan een los Stripe-testaccount zijn dat niet bij Gowtrain hoort.
    Dan antwoorden we gewoon succesvol, zodat Stripe niet blijft retrien.
  */
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
/* Betalingen                                                                  */
/* -------------------------------------------------------------------------- */

async function confirmPaidCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<void> {
  /*
    Alleen daadwerkelijk betaalde Checkout Sessions mogen een booking
    bevestigen.
  */
  if (session.payment_status !== "paid") {
    console.log(
      `Checkout Session ${session.id} is nog niet betaald: ${session.payment_status}`
    );

    return;
  }

  const bookingId = session.metadata?.gowtrain_booking_id?.trim() || null;

  if (!bookingId) {
    console.warn(
      `Geen gowtrain_booking_id gevonden in Checkout Session ${session.id}.`
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
    throw new Error(`Betaling bevestigen mislukt: ${error.message}`);
  }

  console.log(
    `Stripe Checkout ${session.id} verwerkt voor booking ${bookingId}. Bevestigd: ${confirmed}`
  );
}

/* -------------------------------------------------------------------------- */
/* Refunds                                                                     */
/* -------------------------------------------------------------------------- */

async function findBookingForRefund(
  refund: Stripe.Refund
): Promise<RefundBooking | null> {
  const bookingIdFromMetadata =
    refund.metadata?.gowtrain_booking_id?.trim() || null;

  let query = supabaseAdmin
    .from("bookings")
    .select("id, slot_id, status, cancellation_policy")
    .limit(1);

  if (bookingIdFromMetadata) {
    query = query.eq("id", bookingIdFromMetadata);
  } else {
    query = query.eq("stripe_refund_id", refund.id);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(
      `Booking zoeken voor Stripe-refund mislukt: ${error.message}`
    );
  }

  return (data as RefundBooking | null) ?? null;
}

async function resolveAdminIssueAfterRefund(
  refund: Stripe.Refund
): Promise<void> {
  const issueId = refund.metadata?.gowtrain_issue_id?.trim() || null;

  if (!issueId) {
    return;
  }

  const { error } = await supabaseAdmin
    .from("booking_issues")
    .update({
      status: "resolved",
      resolution_type: "full_refund",
      resolution_note:
        "Volledige Stripe-refund is succesvol verwerkt door Gowtrain.",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", issueId)
    .in("status", ["open", "in_review"]);

  if (error) {
    throw new Error(
      `Admin issue ${issueId} als opgelost markeren mislukt: ${error.message}`
    );
  }

  console.log(`Admin issue ${issueId} is opgelost na Stripe-refund.`);
}

async function finalizeRefund(refund: Stripe.Refund): Promise<void> {
  /*
    Alleen bij een volledig geslaagde Stripe-refund werken we Gowtrain bij.
  */
  if (refund.status !== "succeeded") {
    console.log(
      `Stripe refund ${refund.id} is nog niet geslaagd: ${refund.status}`
    );

    return;
  }

  const booking = await findBookingForRefund(refund);

  /*
    Kan een handmatige Stripe-testrefund zijn zonder Gowtrain-booking.
  */
  if (!booking) {
    console.warn(
      `Geen Gowtrain-booking gevonden voor Stripe-refund ${refund.id}.`
    );

    return;
  }

  /*
    Stripe-events kunnen meerdere keren worden ontvangen.
  */
  if (booking.status === "refunded") {
    return;
  }

  if (booking.status !== "refund_pending") {
    console.warn(
      `Booking ${booking.id} heeft status ${booking.status}; refund ${refund.id} wordt niet opnieuw verwerkt.`
    );

    return;
  }

  const { error: bookingUpdateError } = await supabaseAdmin
    .from("bookings")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      stripe_refund_id: refund.id,
      refund_last_error: null,
      trainer_payout_status: "not_applicable",
      trainer_payout_last_error: null,
    })
    .eq("id", booking.id)
    .eq("status", "refund_pending");

  if (bookingUpdateError) {
    throw new Error(
      `Booking ${booking.id} als refunded opslaan mislukt: ${bookingUpdateError.message}`
    );
  }

  if (booking.slot_id) {
    /*
      Speler annuleert meer dan 24 uur vooraf:
      slot komt opnieuw beschikbaar voor andere spelers.
    */
    if (booking.cancellation_policy === "player_timely_refund") {
      const { error: slotUpdateError } = await supabaseAdmin
        .from("availability_slots")
        .update({
          status: "available",
          hold_expires_at: null,
        })
        .eq("id", booking.slot_id)
        .eq("status", "booked");

      if (slotUpdateError) {
        throw new Error(
          `Slot van booking ${booking.id} weer beschikbaar maken mislukt: ${slotUpdateError.message}`
        );
      }
    }

    /*
      Trainer annuleert of admin beslist tot volledige refund:
      slot wordt niet opnieuw boekbaar, omdat de training niet doorgaat.
    */
    if (
      booking.cancellation_policy === "trainer_cancelled_refund" ||
      booking.cancellation_policy === "admin_refund"
    ) {
      const { error: slotUpdateError } = await supabaseAdmin
        .from("availability_slots")
        .update({
          status: "cancelled",
          hold_expires_at: null,
        })
        .eq("id", booking.slot_id)
        .eq("status", "booked");

      if (slotUpdateError) {
        throw new Error(
          `Slot van booking ${booking.id} annuleren mislukt: ${slotUpdateError.message}`
        );
      }
    }
  }

  /*
    Bij een admin-refund markeren we de bijbehorende issue automatisch
    als opgelost.
  */
  if (booking.cancellation_policy === "admin_refund") {
    await resolveAdminIssueAfterRefund(refund);
  }

  console.log(
    `Stripe refund ${refund.id} verwerkt voor booking ${booking.id}.`
  );
}

async function handleRefundFailure(refund: Stripe.Refund): Promise<void> {
  const booking = await findBookingForRefund(refund);

  if (!booking) {
    return;
  }

  const failureReason =
    refund.failure_reason ||
    refund.status ||
    "Stripe-refund kon niet worden verwerkt.";

  const { error } = await supabaseAdmin
    .from("bookings")
    .update({
      refund_last_error: failureReason,
    })
    .eq("id", booking.id)
    .eq("status", "refund_pending");

  if (error) {
    console.error(
      `Refundfout opslaan voor booking ${booking.id}:`,
      error.message
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Webhook                                                                     */
/* -------------------------------------------------------------------------- */

export async function POST(request: NextRequest) {
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
      Stripe gebruikt de originele body om de handtekening te controleren.
      Gebruik hier dus nooit request.json().
    */
    const rawBody = await request.text();

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      stripeWebhookSecret
    );
  } catch (error) {
    console.error("Stripe webhook signature fout:", error);

    return NextResponse.json(
      { error: "Webhook-signature is ongeldig." },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      /*
        Stripe Connect onboarding / accountstatus.
      */
      case "account.updated": {
        const account = event.data.object as Stripe.Account;

        await syncTrainerStripeStatus(account);
        break;
      }

      /*
        Direct geslaagde Checkout-betaling, bijvoorbeeld kaart.
      */
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        await confirmPaidCheckoutSession(session);
        break;
      }

      /*
        Asynchrone betaalmethoden kunnen later definitief slagen.
      */
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;

        await confirmPaidCheckoutSession(session);
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;

        console.warn(
          `Asynchrone Stripe-betaling mislukt voor Checkout Session ${session.id}.`
        );

        break;
      }

      /*
        Refund-status gewijzigd.
      */
      case "refund.updated": {
        const refund = event.data.object as Stripe.Refund;

        if (refund.status === "succeeded") {
          await finalizeRefund(refund);
        } else if (
          refund.status === "failed" ||
          refund.status === "canceled"
        ) {
          await handleRefundFailure(refund);
        }

        break;
      }

      /*
        Extra fallback voor refunds op de gekoppelde Stripe Charge.
      */
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;

        if (!charge.refunds?.data) {
          break;
        }

        for (const refund of charge.refunds.data) {
          if (refund.status === "succeeded") {
            await finalizeRefund(refund);
          } else if (
            refund.status === "failed" ||
            refund.status === "canceled"
          ) {
            await handleRefundFailure(refund);
          }
        }

        break;
      }

      default:
        console.log(`Onverwerkt Stripe-event ontvangen: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook verwerking fout:", error);

    return NextResponse.json(
      { error: "Webhook kon niet worden verwerkt." },
      { status: 500 }
    );
  }
}