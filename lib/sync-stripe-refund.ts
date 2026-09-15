import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
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

type SyncRefundResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      requestId: string;
      refundId: string;
      status: string;
      applied: boolean;
    };

function getPaymentIntentId(refund: Stripe.Refund): string | null {
  return typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
}

/*
 * Alleen server-side gebruiken.
 *
 * Deze functie vraagt GEEN refund aan.
 * Hij haalt een bestaande refund op bij Stripe,
 * controleert de koppeling en verwerkt het actuele resultaat.
 */
export async function syncStripeRefund(
  refundId: string,
  expectedRequestId?: string
): Promise<SyncRefundResult> {
  const refund = await stripe.refunds.retrieve(refundId);

  const requestId =
    refund.metadata?.gowtrain_refund_request_id?.trim();

  /*
   * Oude refunds hebben deze metadata niet.
   * Die kunnen voorlopig via de bestaande afhandeling lopen.
   */
  if (!requestId) {
    if (expectedRequestId) {
      throw new Error(
        "De Stripe-refund mist de verwachte refundopdrachtmetadata."
      );
    }

    return { handled: false };
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId
    ) ||
    (expectedRequestId && requestId !== expectedRequestId)
  ) {
    throw new Error(
      "De Stripe-refund verwijst naar een ongeldige of andere opdracht."
    );
  }

  const paymentIntentId = getPaymentIntentId(refund);

  if (!paymentIntentId || !refund.status) {
    throw new Error(
      "De Stripe-refund bevat geen bruikbare betaling of status."
    );
  }

  if (
    ![
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
    ].includes(refund.status)
  ) {
    throw new Error("Onbekende Stripe-refundstatus.");
  }

  const { data: request, error: requestError } =
    await supabaseAdmin
      .from("refund_requests")
      .select(
        `
          id,
          amount_cents,
          currency,
          stripe_payment_intent_id,
          stripe_refund_id,
          stripe_livemode,
          first_stripe_request_at,
          stripe_request_payload
        `
      )
      .eq("id", requestId)
      .maybeSingle();

  if (requestError) {
    throw new Error(
      `Refundopdracht ophalen mislukt: ${requestError.message}`
    );
  }

  if (!request) {
    throw new Error("De gekoppelde refundopdracht bestaat niet.");
  }

  if (
    !request.first_stripe_request_at ||
    !request.stripe_request_payload ||
    request.stripe_payment_intent_id !== paymentIntentId ||
    request.amount_cents !== refund.amount ||
    request.currency !== refund.currency ||
    (
      request.stripe_refund_id !== null &&
      request.stripe_refund_id !== refund.id
    )
  ) {
    throw new Error(
      "Het Stripe-refundresultaat komt niet overeen met de opgeslagen opdracht."
    );
  }

  const payload =
    request.stripe_request_payload as Record<string, unknown>;

  if (
    payload.payment_intent !== paymentIntentId ||
    payload.amount !== refund.amount
  ) {
    throw new Error(
      "De vastgelegde Stripe-aanvraag komt niet overeen met de refund."
    );
  }

  /*
   * Bepaal de Stripe-omgeving via de oorspronkelijke Payment Intent.
   */
  const paymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntentId
  );

  if (
    paymentIntent.livemode !== request.stripe_livemode ||
    paymentIntent.currency !== request.currency
  ) {
    throw new Error(
      "De Stripe-omgeving of valuta komt niet overeen."
    );
  }

  /*
   * Deze functie vergrendelt de refundopdracht en beschermt
   * definitieve statussen tegen verouderde resultaten.
   */
  const { data: storedStatus, error: syncError } =
    await supabaseAdmin.rpc("sync_verified_refund_result", {
      p_refund_request_id: request.id,
      p_stripe_refund_id: refund.id,
      p_payment_intent_id: paymentIntentId,
      p_amount_cents: refund.amount,
      p_currency: refund.currency,
      p_stripe_livemode: paymentIntent.livemode,
      p_stripe_status: refund.status,
    });

  if (syncError) {
    throw new Error(
      `Refundstatus synchroniseren mislukt: ${syncError.message}`
    );
  }

  if (typeof storedStatus !== "string") {
    throw new Error("Geen geldige opgeslagen refundstatus ontvangen.");
  }

  let applied = false;

  if (storedStatus === "succeeded") {
    const { data, error: applyError } = await supabaseAdmin.rpc(
      "apply_successful_refund",
      {
        p_refund_request_id: request.id,
      }
    );

    if (applyError || data !== true) {
      /*
       * De Stripe-refund blijft succeeded.
       * Alleen de administratieve afronding moet opnieuw.
       * Hier wordt nooit opnieuw geld teruggevraagd.
       */
      throw new Error(
        `Refund geslaagd, administratieve afronding niet bevestigd: ${
          applyError?.message || "geen bevestiging ontvangen"
        }`
      );
    }

    applied = true;
  }

  console.log("Bestaande Stripe-refund gesynchroniseerd:", {
    requestId: request.id,
    refundId: refund.id,
    status: storedStatus,
    applied,
  });

  return {
    handled: true,
    requestId: request.id,
    refundId: refund.id,
    status: storedStatus,
    applied,
  };
}