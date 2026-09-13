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

type RefundBooking = {
  id: string;
  slot_id: string | null;
  status: string;
  cancellation_policy: string | null;
};

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
  const packageId =
    session.metadata?.package_id?.trim() || null;

  const playerId =
    session.metadata?.player_id?.trim() || null;

  const attemptId =
    session.metadata?.gowtrain_checkout_attempt_id?.trim() ||
    null;

  /*
   * Nieuwe pakketaankopen moeten via checkout_attempts lopen.
   *
   * Geen terugval naar de oude confirm_package_purchase:
   * die functie past niet bij de nieuwe aankoopstructuur.
   */
  if (
    !packageId ||
    !playerId ||
    !attemptId ||
    session.metadata?.gowtrain_funds_flow !==
      "separate_transfers_v1"
  ) {
    throw new Error(
      `Pakketbetaling ${session.id} mist de nieuwe betaalpoginggegevens. Handmatige controle nodig.`
    );
  }

  if (
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid"
  ) {
    throw new Error(
      `Pakketbetaling ${session.id} is niet definitief afgerond.`
    );
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const amountTotal = session.amount_total;
  const currency = session.currency;

  if (
    !paymentIntentId ||
    typeof amountTotal !== "number" ||
    !Number.isSafeInteger(amountTotal) ||
    amountTotal <= 0 ||
    currency !== "eur"
  ) {
    throw new Error(
      `Pakketbetaling ${session.id} bevat ongeldige betaalgegevens.`
    );
  }

  /*
   * Controleer de koppeling met de opgeslagen betaalpoging.
   *
   * De databasefunctie controleert de belangrijkste gegevens
   * opnieuw binnen de transactie die de aankoop vastlegt.
   */
  const {
    data: attempt,
    error: attemptError,
  } = await supabaseAdmin
    .from("checkout_attempts")
    .select(
      `
        id,
        package_id,
        booking_id,
        player_id,
        trainer_id,
        amount_cents,
        currency,
        stripe_livemode,
        funds_flow,
        stripe_checkout_session_id
      `
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    throw new Error(
      `Pakketbetaalpoging ophalen mislukt: ${attemptError.message}`
    );
  }

  if (!attempt) {
    throw new Error(
      `Betaalpoging ${attemptId} voor Checkout ${session.id} bestaat niet.`
    );
  }

  if (
    attempt.package_id !== packageId ||
    attempt.booking_id !== null ||
    attempt.player_id !== playerId ||
    session.client_reference_id !== attempt.id ||
    session.metadata?.trainer_id !== attempt.trainer_id ||
    attempt.amount_cents !== amountTotal ||
    attempt.currency !== currency ||
    attempt.stripe_livemode !== session.livemode ||
    attempt.funds_flow !== "separate_transfers_v1" ||
    attempt.stripe_checkout_session_id !== session.id
  ) {
    throw new Error(
      `Checkout ${session.id} komt niet overeen met de geregistreerde pakketbetaalpoging.`
    );
  }

  /*
   * Haal de werkelijke Payment Intent op bij Stripe.
   * Metadata alleen is niet voldoende om de geldstroom
   * en het ontvangen bedrag vast te stellen.
   */
  const paymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntentId
  );

  if (
    paymentIntent.status !== "succeeded" ||
    paymentIntent.livemode !== session.livemode ||
    paymentIntent.currency !== currency ||
    paymentIntent.amount !== amountTotal ||
    paymentIntent.amount_received !== amountTotal
  ) {
    throw new Error(
      `Payment Intent ${paymentIntent.id} komt niet overeen met de betaalde pakket-Checkout.`
    );
  }

  if (
    paymentIntent.metadata.gowtrain_checkout_attempt_id !==
      attempt.id ||
    paymentIntent.metadata.package_id !== packageId ||
    paymentIntent.metadata.player_id !== playerId ||
    paymentIntent.metadata.trainer_id !== attempt.trainer_id ||
    paymentIntent.metadata.gowtrain_funds_flow !==
      "separate_transfers_v1"
  ) {
    throw new Error(
      `Payment Intent ${paymentIntent.id} hoort niet bij deze pakketbetaalpoging.`
    );
  }

  /*
   * De nieuwe pakketflow gebruikt platformbetalingen
   * met afzonderlijke trainertransfers na iedere les.
   *
   * Een destination charge of andere onverwachte
   * Connect-configuratie wordt niet automatisch verwerkt.
   */
  if (
    paymentIntent.transfer_data != null ||
    paymentIntent.application_fee_amount != null ||
    paymentIntent.on_behalf_of != null
  ) {
    throw new Error(
      `Payment Intent ${paymentIntent.id} gebruikt een onverwachte Connect-geldstroom. Geen automatische pakketbevestiging uitgevoerd.`
    );
  }

  /*
   * Eén databasetransactie:
   * - één pakketaankoop opslaan;
   * - alle lesboekingen aanmaken;
   * - tijdsloten op booked zetten;
   * - betaalpoging op paid zetten.
   *
   * Herhaalde webhookafleveringen retourneren dezelfde aankoop.
   */
  const {
    data: purchaseId,
    error: confirmationError,
  } = await supabaseAdmin.rpc(
    "confirm_paid_package_checkout",
    {
      p_attempt_id: attempt.id,
      p_checkout_session_id: session.id,
      p_payment_intent_id: paymentIntent.id,
      p_amount_total: amountTotal,
      p_currency: currency,
      p_stripe_livemode: session.livemode,
    }
  );

  if (confirmationError) {
    throw new Error(
      `Pakketaankoop bevestigen mislukt voor ${session.id}: ${confirmationError.message}`
    );
  }

  if (
    typeof purchaseId !== "string" ||
    !purchaseId
  ) {
    throw new Error(
      `Geen geldig aankoop-ID ontvangen na bevestiging van ${session.id}.`
    );
  }

  console.log("Pakketaankoop bevestigd:", {
    purchaseId,
    attemptId: attempt.id,
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
/* Refunds: bestaande afhandeling behouden                                     */
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
  const issueId =
    refund.metadata?.gowtrain_issue_id?.trim() || null;

  if (!issueId) return;

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

  console.log(
    `Admin issue ${issueId} is opgelost na Stripe-refund.`
  );
}

async function finalizeRefund(
  refund: Stripe.Refund
): Promise<void> {
  if (refund.status !== "succeeded") return;

  const booking = await findBookingForRefund(refund);
  if (!booking) return;

  if (booking.status === "refunded") return;

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
    if (
      booking.cancellation_policy === "player_timely_refund"
    ) {
      await supabaseAdmin
        .from("availability_slots")
        .update({
          status: "available",
          hold_expires_at: null,
        })
        .eq("id", booking.slot_id)
        .eq("status", "booked");
    }

    if (
      booking.cancellation_policy ===
        "trainer_cancelled_refund" ||
      booking.cancellation_policy === "admin_refund"
    ) {
      await supabaseAdmin
        .from("availability_slots")
        .update({
          status: "cancelled",
          hold_expires_at: null,
        })
        .eq("id", booking.slot_id)
        .eq("status", "booked");
    }
  }

  if (booking.cancellation_policy === "admin_refund") {
    await resolveAdminIssueAfterRefund(refund);
  }

  console.log(
    `Stripe refund ${refund.id} verwerkt voor booking ${booking.id}.`
  );
}

async function handleRefundFailure(
  refund: Stripe.Refund
): Promise<void> {
  const booking = await findBookingForRefund(refund);
  if (!booking) return;

  const failureReason =
    refund.failure_reason ||
    refund.status ||
    "Stripe-refund kon niet worden verwerkt.";

  await supabaseAdmin
    .from("bookings")
    .update({
      refund_last_error: failureReason,
    })
    .eq("id", booking.id)
    .eq("status", "refund_pending");
}

/* -------------------------------------------------------------------------- */
/* Webhook entry point                                                        */
/* -------------------------------------------------------------------------- */

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

      case "refund.updated": {
        const refund =
          event.data.object as Stripe.Refund;

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

      case "charge.refunded": {
        const charge =
          event.data.object as Stripe.Charge;

        if (charge.refunds?.data) {
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