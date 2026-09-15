import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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

type RefundRequest = {
  id: string;
  source_booking_id: string | null;
  source_package_purchase_id: string | null;
  amount_cents: number;
  currency: string;
  stripe_payment_intent_id: string;
  stripe_livemode: boolean;
  stripe_refund_id: string | null;
  stripe_idempotency_key: string;
  stripe_request_payload: unknown;
  first_stripe_request_at: string | null;
  lock_token: string;
  locked_until: string;
};

type PreparedRequest = {
  request_id: string;
  idempotency_key: string;
  stripe_payload: {
    payment_intent: string;
    amount: number;
    reason: "requested_by_customer";
    metadata: Record<string, string>;
  };
};

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

function getPaymentIntentId(
  refund: Stripe.Refund
): string | null {
  return typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
}

/*
 * Een fout niet blind opnieuw aanbieden als nieuwe refund.
 *
 * Vooral na een Stripe-timeout kan de refund al bestaan.
 * We behouden de opdracht voor gecontroleerd herstel.
 */
async function markForReview(
  request: RefundRequest,
  message: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("refund_requests")
    .update({
      status: "review_required",
      last_error: message.slice(0, 2000),
      locked_until: null,
      lock_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .eq("status", "processing")
    .eq("lock_token", request.lock_token)
    .gt("locked_until", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Refundcontrole markeren mislukt:", {
      requestId: request.id,
      message: error.message,
    });

    return false;
  }

  return Boolean(data);
}

/*
 * Alle refunds van de oorspronkelijke betaling ophalen.
 *
 * Een onvolledige lijst mag niet worden gebruikt om te
 * concluderen dat er geen eerdere refund bestaat.
 */
async function listPaymentRefunds(
  paymentIntentId: string
): Promise<Stripe.Refund[]> {
  const refunds: Stripe.Refund[] = [];
  let startingAfter: string | undefined;

  for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
    const page = await stripe.refunds.list({
      payment_intent: paymentIntentId,
      limit: 100,
      ...(startingAfter
        ? { starting_after: startingAfter }
        : {}),
    });

    refunds.push(...page.data);

    if (!page.has_more) {
      return refunds;
    }

    const lastRefund = page.data[page.data.length - 1];

    if (!lastRefund) {
      throw new Error(
        "De Stripe-refundlijst is onvolledig."
      );
    }

    startingAfter = lastRefund.id;
  }

  throw new Error(
    "Te veel refundresultaten om automatisch volledig te controleren."
  );
}

/*
 * Controleer de koppeling met de oorspronkelijke aankoop
 * en de bronmetadata op de Payment Intent.
 */
async function validateOriginalPayment(
  request: RefundRequest,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  let expectedAmount: number;
  let expectedCurrency: string;

  if (request.source_package_purchase_id) {
    const { data: purchase, error } = await supabaseAdmin
      .from("package_purchases")
      .select(
        `
          id,
          package_id,
          player_id,
          trainer_id,
          total_price_cents,
          currency,
          stripe_payment_intent_id,
          stripe_livemode,
          funds_flow
        `
      )
      .eq("id", request.source_package_purchase_id)
      .single();

    if (error || !purchase) {
      throw new Error(
        "De oorspronkelijke pakketaankoop kon niet worden gecontroleerd."
      );
    }

    if (
      request.source_booking_id !== null ||
      purchase.stripe_payment_intent_id !== paymentIntent.id ||
      purchase.stripe_livemode !== request.stripe_livemode ||
      purchase.funds_flow !== "separate_transfers_v1" ||
      paymentIntent.metadata.package_id !== purchase.package_id ||
      paymentIntent.metadata.player_id !== purchase.player_id ||
      paymentIntent.metadata.trainer_id !== purchase.trainer_id
    ) {
      throw new Error(
        "De pakketbetaling komt niet overeen met de refundopdracht."
      );
    }

    expectedAmount = purchase.total_price_cents;
    expectedCurrency = purchase.currency;
  } else if (request.source_booking_id) {
    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select(
        `
          id,
          package_purchase_id,
          total_price_cents,
          currency,
          stripe_payment_intent_id,
          paid_at
        `
      )
      .eq("id", request.source_booking_id)
      .single();

    if (error || !booking) {
      throw new Error(
        "De oorspronkelijke losse boeking kon niet worden gecontroleerd."
      );
    }

    if (
      booking.package_purchase_id !== null ||
      !booking.paid_at ||
      booking.stripe_payment_intent_id !== paymentIntent.id ||
      paymentIntent.metadata.gowtrain_booking_id !== booking.id
    ) {
      throw new Error(
        "De losse betaling komt niet overeen met de refundopdracht."
      );
    }

    expectedAmount = booking.total_price_cents;
    expectedCurrency = booking.currency;
  } else {
    throw new Error("De bronbetaling ontbreekt.");
  }

  if (
    paymentIntent.id !== request.stripe_payment_intent_id ||
    paymentIntent.livemode !== request.stripe_livemode ||
    paymentIntent.status !== "succeeded" ||
    paymentIntent.currency !== expectedCurrency ||
    request.currency !== expectedCurrency ||
    paymentIntent.amount !== expectedAmount ||
    paymentIntent.amount_received !== expectedAmount
  ) {
    throw new Error(
      "Het bedrag, de valuta of de status van de oorspronkelijke betaling klopt niet."
    );
  }

  /*
   * Oude destination charges niet via deze nieuwe
   * separate-transfers-refundflow behandelen.
   */
  if (
    paymentIntent.transfer_data != null ||
    paymentIntent.application_fee_amount != null ||
    paymentIntent.on_behalf_of != null
  ) {
    throw new Error(
      "De oorspronkelijke betaling gebruikt een andere Connect-geldstroom."
    );
  }

  const charge =
    paymentIntent.latest_charge &&
    typeof paymentIntent.latest_charge !== "string"
      ? paymentIntent.latest_charge
      : null;

  if (
    !charge ||
    !charge.paid ||
    !charge.captured ||
    charge.disputed
  ) {
    throw new Error(
      "De charge ontbreekt, is niet geïncasseerd of is betwist."
    );
  }
}

/*
 * Eerdere refunds voor andere opdrachten moeten herkenbaar zijn.
 * Een refund die rechtstreeks in Stripe is gemaakt, vereist
 * eerst administratieve afstemming.
 */
async function validateExistingRefunds(
  request: RefundRequest,
  refunds: Stripe.Refund[]
): Promise<number> {
  const currentRequestRefunds = refunds.filter(
    (refund) =>
      refund.metadata?.gowtrain_refund_request_id === request.id
  );

  if (currentRequestRefunds.length > 0) {
    throw new Error(
      "Stripe bevat al een refund voor deze opdracht. Eerst herstellen; geen nieuwe refund aangevraagd."
    );
  }

  if (refunds.length === 0) {
    return 0;
  }

  const { data: knownRequests, error } = await supabaseAdmin
    .from("refund_requests")
    .select(
      `
        id,
        stripe_refund_id,
        stripe_payment_intent_id,
        amount_cents,
        currency,
        source_booking_id,
        source_package_purchase_id
      `
    )
    .eq(
      "stripe_payment_intent_id",
      request.stripe_payment_intent_id
    );

  if (error) {
    throw new Error(
      "Eerdere refundopdrachten konden niet worden gecontroleerd."
    );
  }

  const requestsByRefundId = new Map(
    (knownRequests ?? [])
      .filter((item) => item.stripe_refund_id)
      .map((item) => [item.stripe_refund_id, item])
  );

  let committedAmount = 0;

  for (const refund of refunds) {
    const knownRequest = requestsByRefundId.get(refund.id);

    if (
      !knownRequest ||
      refund.metadata?.gowtrain_refund_request_id !==
        knownRequest.id ||
      getPaymentIntentId(refund) !== request.stripe_payment_intent_id ||
      refund.amount !== knownRequest.amount_cents ||
      refund.currency !== knownRequest.currency ||
      knownRequest.source_booking_id !== request.source_booking_id ||
      knownRequest.source_package_purchase_id !==
        request.source_package_purchase_id
    ) {
      throw new Error(
        "Er bestaat een onbekende of afwijkende eerdere Stripe-refund. Eerst controleren."
      );
    }

    if (
      refund.status === "succeeded" ||
      refund.status === "pending" ||
      refund.status === "requires_action"
    ) {
      committedAmount += refund.amount;
    } else if (
      refund.status !== "failed" &&
      refund.status !== "canceled"
    ) {
      throw new Error(
        "Een eerdere refund heeft een onbekende status."
      );
    }
  }

  return committedAmount;
}

async function processRefund(
  request: RefundRequest
): Promise<NextResponse> {
  let stripeRefundId: string | null = null;

  try {
    if (
      !request.lock_token ||
      request.stripe_livemode !== false ||
      !Number.isSafeInteger(request.amount_cents) ||
      request.amount_cents <= 0 ||
      request.currency !== "eur"
    ) {
      throw new Error("De geclaimde refundopdracht is ongeldig.");
    }

    /*
     * 1. Controleer de oorspronkelijke betaling bij Stripe.
     */
    const paymentIntent = await stripe.paymentIntents.retrieve(
      request.stripe_payment_intent_id,
      {
        expand: ["latest_charge"],
      }
    );

    await validateOriginalPayment(request, paymentIntent);

    /*
     * 2. Controleer eerdere refunds.
     */
    const existingRefunds = await listPaymentRefunds(
      paymentIntent.id
    );

    const committedRefundAmount = await validateExistingRefunds(
      request,
      existingRefunds
    );

    if (
      committedRefundAmount + request.amount_cents >
      paymentIntent.amount_received
    ) {
      throw new Error(
        "De refund overschrijdt het resterende terugbetaalbare bedrag."
      );
    }

    /*
     * Deze voorcontrole is geen vergrendeling bij Stripe.
     * Stripe controleert bij refunds.create zelf opnieuw
     * of het bedrag daadwerkelijk terugbetaald kan worden.
     */

    /*
     * 3. Controleer database-items en leg de exacte aanvraag vast.
     */
    const { data: preparedData, error: prepareError } =
      await supabaseAdmin.rpc(
        "prepare_refund_stripe_request",
        {
          p_refund_request_id: request.id,
          p_lock_token: request.lock_token,
        }
      );

    if (prepareError) {
      throw new Error(
        `Refund voorbereiden mislukt: ${prepareError.message}`
      );
    }

    if (!preparedData) {
      return json(
        {
          success: false,
          requestId: request.id,
          error:
            "De claim is niet meer geldig of de aanvraag was al gestart. Geen nieuwe Stripe-aanroep uitgevoerd.",
        },
        409
      );
    }

    const prepared = preparedData as PreparedRequest;

    if (
      prepared.request_id !== request.id ||
      prepared.idempotency_key !== request.stripe_idempotency_key ||
      prepared.stripe_payload.payment_intent !==
        request.stripe_payment_intent_id ||
      prepared.stripe_payload.amount !== request.amount_cents ||
      prepared.stripe_payload.metadata
        ?.gowtrain_refund_request_id !== request.id
    ) {
      throw new Error(
        "De voorbereide Stripe-aanvraag wijkt af van de refundopdracht."
      );
    }

    if (
      Date.parse(request.locked_until) - Date.now() < 30_000
    ) {
      throw new Error(
        "Onvoldoende claimtijd over om de Stripe-refund veilig te starten."
      );
    }

    /*
     * 4. Vraag het expliciete bedrag terug.
     *
     * Gebruik uitsluitend de opgeslagen payload en sleutel.
     * Een timeout betekent niet automatisch dat niets is gebeurd.
     */
    const refund = await stripe.refunds.create(
      prepared.stripe_payload,
      {
        idempotencyKey: prepared.idempotency_key,
      }
    );

    stripeRefundId = refund.id;

    const paymentIntentId = getPaymentIntentId(refund);

    const allowedStatuses = [
      "pending",
      "requires_action",
      "succeeded",
      "failed",
      "canceled",
    ];

    if (
      paymentIntentId !== request.stripe_payment_intent_id ||
      refund.amount !== request.amount_cents ||
      refund.currency !== request.currency ||
      refund.metadata?.gowtrain_refund_request_id !== request.id ||
      !refund.status ||
      !allowedStatuses.includes(refund.status)
    ) {
      throw new Error(
        "Het Stripe-refundantwoord wijkt af van de verwachte opdracht."
      );
    }

    /*
     * 5. Bewaar het eerste Stripe-resultaat.
     *
     * De definitieve verwerking van lesstatussen en mails
     * voegen we daarna toe, ook voor latere Stripe-webhooks.
     */
    const { data: saved, error: saveError } =
      await supabaseAdmin.rpc(
        "record_refund_stripe_result",
        {
          p_refund_request_id: request.id,
          p_lock_token: request.lock_token,
          p_stripe_refund_id: refund.id,
          p_payment_intent_id: paymentIntentId,
          p_amount_cents: refund.amount,
          p_currency: refund.currency,
          p_stripe_status: refund.status,
        }
      );

    if (saveError) {
      throw new Error(
        `Stripe-refundresultaat opslaan mislukt: ${saveError.message}`
      );
    }

    if (saved !== true) {
      console.error("Refund bestaat bij Stripe, claim niet meer geldig:", {
        requestId: request.id,
        stripeRefundId: refund.id,
      });

      return json(
        {
          success: false,
          requestId: request.id,
          refundId: refund.id,
          error:
            "Stripe heeft de refund aangemaakt, maar de opslag is niet bevestigd. Niet opnieuw aanvragen; eerst herstellen.",
        },
        409
      );
    }

    console.log("Stripe-refundresultaat opgeslagen:", {
      requestId: request.id,
      stripeRefundId: refund.id,
      status: refund.status,
    });

    return json({
      success: true,
      processed: 1,
      requestId: request.id,
      refundId: refund.id,
      refundStatus: refund.status,
      amountCents: refund.amount,
      currency: refund.currency,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Onbekende fout tijdens refundverwerking.";

    const reviewMessage = stripeRefundId
      ? `Stripe-refund ${stripeRefundId} bestaat mogelijk al. ${message}`
      : message;

    console.error("Refundverwerking vereist controle:", {
      requestId: request.id,
      stripeRefundId,
      message,
    });

    const reviewSaved = await markForReview(
      request,
      reviewMessage
    );

    return json(
      {
        success: false,
        requestId: request.id,
        reviewSaved,
        refundId: stripeRefundId,
        error:
          "De refundverwerking vereist controle. Er wordt niet automatisch een tweede refund aangevraagd.",
      },
      503
    );
  }
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
    /*
     * Tijdelijke veiligheidsgrens tijdens de bouw.
     * Liveverwerking pas inschakelen na alle refundtests.
     */
    if (getStripeLivemode()) {
      return json(
        {
          error:
            "Deze refundworker is voorlopig alleen beschikbaar voor sandboxbetalingen.",
        },
        403
      );
    }

    const { data, error } = await supabaseAdmin.rpc(
      "claim_refund_requests",
      {
        p_stripe_livemode: false,
        p_limit: 1,
        p_lease_seconds: 300,
      }
    );

    if (error) {
      console.error("Refundopdracht claimen mislukt:", {
        code: error.code,
        message: error.message,
      });

      return json(
        { error: "Refundopdrachten konden niet worden opgehaald." },
        503
      );
    }

    const claimed = (
      Array.isArray(data) ? data : []
    ) as RefundRequest[];

    const refundRequest = claimed[0];

    if (!refundRequest) {
      return json({
        success: true,
        processed: 0,
      });
    }

    return await processRefund(refundRequest);
  } catch (error: unknown) {
    console.error("Refundworker mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return json(
      { error: "De refundworker kon niet worden afgerond." },
      503
    );
  }
}