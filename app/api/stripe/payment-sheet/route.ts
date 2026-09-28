import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { syncSingleLessonPayment } from "@/lib/sync-single-lesson-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INTENT_PATTERN = /^pi_[A-Za-z0-9]+$/;

const MAX_BODY_BYTES = 1024;
const SAFE_CREATE_WINDOW_MS = 23 * 60 * 60 * 1000;

type Attempt = {
  id: string;
  booking_id: string;
  player_id: string;
  trainer_id: string;
  slot_id: string;
  channel: string;
  status: string;
  amount_cents: number;
  currency: string;
  stripe_livemode: boolean;
  funds_flow: string;
  player_email: string;
  participant_count: number;
  starts_at: string;
  reservation_expires_at: string;
  stripe_idempotency_key: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
};

class InvalidBodyError extends Error {}

class PaymentFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 409
  ) {
    super(message);
    this.name = "PaymentFlowError";
  }
}

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
    throw new Error("PAYMENT_CONFIGURATION_MISSING");
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

function validTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

async function readBookingId(
  request: NextRequest
): Promise<string> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json" || !request.body) {
    throw new InvalidBodyError();
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bytes += value.byteLength;

      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InvalidBodyError();
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
  } catch {
    throw new InvalidBodyError();
  } finally {
    reader.releaseLock();
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    throw new InvalidBodyError();
  }

  if (
    !isObject(body) ||
    Object.keys(body).length !== 1 ||
    typeof body.bookingId !== "string" ||
    !UUID_PATTERN.test(body.bookingId)
  ) {
    throw new InvalidBodyError();
  }

  return body.bookingId.toLowerCase();
}

async function readAttempt(
  admin: SupabaseClient,
  bookingId: string,
  playerId: string
): Promise<Attempt> {
  const { data, error } = await admin
    .from("single_lesson_payment_attempts")
    .select(`
      id,
      booking_id,
      player_id,
      trainer_id,
      slot_id,
      channel,
      status,
      amount_cents,
      currency,
      stripe_livemode,
      funds_flow,
      player_email,
      participant_count,
      starts_at,
      reservation_expires_at,
      stripe_idempotency_key,
      stripe_payment_intent_id,
      stripe_checkout_session_id
    `)
    .eq("booking_id", bookingId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (error) {
    throw new Error("PAYMENT_ATTEMPT_LOOKUP_FAILED");
  }

  if (!data) {
    throw new PaymentFlowError(
      "PAYMENT_ATTEMPT_NOT_AVAILABLE",
      "Voor deze boeking is geen eigen native betaalpoging beschikbaar. Controleer je boekingen.",
      404
    );
  }

  if (
    typeof data.id !== "string" ||
    !UUID_PATTERN.test(data.id) ||
    data.booking_id !== bookingId ||
    data.player_id !== playerId ||
    data.channel !== "paymentsheet" ||
    data.stripe_livemode !== false ||
    data.funds_flow !== "separate_transfers_v1" ||
    data.currency !== "eur" ||
    !Number.isSafeInteger(data.amount_cents) ||
    data.amount_cents <= 0 ||
    data.stripe_checkout_session_id !== null ||
    !validTime(data.starts_at) ||
    !validTime(data.reservation_expires_at) ||
    data.stripe_idempotency_key !==
      `gowtrain-single-payment/${data.id}`
  ) {
    throw new PaymentFlowError(
      "PAYMENT_FLOW_MISMATCH",
      "Deze betaalpoging kan niet via het native betaalscherm worden geopend."
    );
  }

  return data as Attempt;
}

/*
 * Actuele controle vóór aanmaak en vóór afgifte van de client secret.
 *
 * Dit houdt geen database-lock vast tijdens de Stripe-aanroep.
 * Veilige afsluiting en webhookafronding moeten daarom zelfstandig
 * de daadwerkelijke betaaluitkomst blijven controleren.
 */
async function assertPayable(
  admin: SupabaseClient,
  attempt: Attempt,
  currentEmail: string
): Promise<void> {
  if (
    !["reserved", "creating", "open"].includes(attempt.status) ||
    attempt.player_email !== currentEmail
  ) {
    throw new PaymentFlowError(
      "PAYMENT_REQUIRES_STATUS_CHECK",
      "Deze betaalpoging moet eerst worden gecontroleerd. Start geen nieuwe betaling."
    );
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select(`
      id,
      player_id,
      trainer_id,
      slot_id,
      package_purchase_id,
      status,
      paid_at,
      cancelled_at,
      hold_expires_at,
      total_price_cents,
      currency,
      participant_count,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_charge_id,
      stripe_refund_id,
      refunded_at,
      stripe_transfer_id,
      trainer_paid_at
    `)
    .eq("id", attempt.booking_id)
    .eq("player_id", attempt.player_id)
    .maybeSingle();

  if (bookingError) {
    throw new Error("PAYMENT_BOOKING_LOOKUP_FAILED");
  }

  if (
    !booking ||
    booking.trainer_id !== attempt.trainer_id ||
    booking.slot_id !== attempt.slot_id ||
    booking.package_purchase_id !== null ||
    booking.status !== "payment_pending" ||
    booking.paid_at !== null ||
    booking.cancelled_at !== null ||
    booking.total_price_cents !== attempt.amount_cents ||
    booking.currency !== attempt.currency ||
    booking.participant_count !== attempt.participant_count ||
    booking.stripe_checkout_session_id !== null ||
    booking.stripe_payment_intent_id !== null ||
    booking.stripe_charge_id !== null ||
    booking.stripe_refund_id !== null ||
    booking.refunded_at !== null ||
    booking.stripe_transfer_id !== null ||
    booking.trainer_paid_at !== null ||
    !validTime(booking.hold_expires_at) ||
    Date.parse(booking.hold_expires_at) !==
      Date.parse(attempt.reservation_expires_at)
  ) {
    throw new PaymentFlowError(
      "BOOKING_NOT_PAYABLE",
      "Deze reservering kan niet als nieuwe betaling worden geopend. Controleer de boekingsstatus."
    );
  }

  const { data: slot, error: slotError } = await admin
    .from("availability_slots")
    .select(
      "id, trainer_id, package_id, status, starts_at, hold_expires_at"
    )
    .eq("id", attempt.slot_id)
    .maybeSingle();

  if (slotError) {
    throw new Error("PAYMENT_SLOT_LOOKUP_FAILED");
  }

  if (
    !slot ||
    slot.trainer_id !== attempt.trainer_id ||
    slot.package_id !== null ||
    slot.status !== "held" ||
    !validTime(slot.starts_at) ||
    !validTime(slot.hold_expires_at) ||
    Date.parse(slot.starts_at) !== Date.parse(attempt.starts_at) ||
    Date.parse(slot.hold_expires_at) !==
      Date.parse(attempt.reservation_expires_at)
  ) {
    throw new PaymentFlowError(
      "RESERVATION_CHANGED",
      "De reserveringsgegevens zijn gewijzigd. Controleer je boekingen voordat je verdergaat."
    );
  }

  if (
    Date.parse(attempt.starts_at) <= Date.now() ||
    Date.parse(attempt.reservation_expires_at) <= Date.now()
  ) {
    throw new PaymentFlowError(
      "RESERVATION_EXPIRED",
      "De reserveringstermijn is verstreken. Een bestaande betaling moet eerst veilig worden gecontroleerd; er wordt niet automatisch een nieuwe aangemaakt."
    );
  }
}

function validateIntent(
  intent: Stripe.PaymentIntent,
  attempt: Attempt
): void {
  const expectedMetadata: Record<string, string> = {
    gowtrain_single_payment_attempt_id: attempt.id,
    gowtrain_booking_id: attempt.booking_id,
    gowtrain_trainer_id: attempt.trainer_id,
    gowtrain_funds_flow: attempt.funds_flow,
    gowtrain_payment_channel: "paymentsheet",
  };

  const metadata = intent.metadata ?? {};

  if (
    !INTENT_PATTERN.test(intent.id) ||
    (
      attempt.stripe_payment_intent_id !== null &&
      attempt.stripe_payment_intent_id !== intent.id
    ) ||
    intent.livemode !== false ||
    intent.amount !== attempt.amount_cents ||
    intent.currency !== attempt.currency ||
    intent.capture_method !== "automatic" ||
    intent.confirmation_method !== "automatic" ||
    intent.receipt_email !== attempt.player_email ||
    intent.transfer_data != null ||
    intent.on_behalf_of != null ||
    intent.application_fee_amount != null ||
    intent.customer != null ||
    intent.setup_future_usage != null ||
    intent.payment_method_types.length !== 2 ||
    !intent.payment_method_types.includes("card") ||
    !intent.payment_method_types.includes("ideal") ||
    Object.keys(metadata).length !==
      Object.keys(expectedMetadata).length ||
    Object.entries(expectedMetadata).some(
      ([key, value]) => metadata[key] !== value
    )
  ) {
    throw new Error("PAYMENT_INTENT_CONTEXT_MISMATCH");
  }
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  /*
   * Standaard uit.
   * Nog niet inschakelen tijdens het bouwen van deze keten.
   */
  if (
    process.env.SINGLE_LESSON_PAYMENTSHEET_ENABLED !== "true"
  ) {
    return json(
      {
        code: "PAYMENTSHEET_DISABLED",
        error: "Native betalen is nog niet beschikbaar.",
      },
      503
    );
  }

  /*
   * Deze ingang is uitsluitend voor native gebruik.
   * Expo-web blijft de bestaande hosted Checkout gebruiken.
   *
   * Een ontbrekende Origin is geen authenticatie:
   * de Bearer- en eigenaarscontrole hieronder zijn beslissend.
   */
  if (request.headers.has("origin")) {
    return json(
      {
        code: "NATIVE_PAYMENT_ROUTE_ONLY",
        error: "Gebruik voor webbetalingen de websitecheckout.",
      },
      403
    );
  }

  const accessToken = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!accessToken) {
    return json(
      {
        code: "AUTH_REQUIRED",
        error: "Log in met je speleraccount.",
      },
      401
    );
  }

  try {
    const bookingId = await readBookingId(request);

    const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

    if (
      !stripeKey.startsWith("sk_test_") &&
      !stripeKey.startsWith("rk_test_")
    ) {
      throw new Error("PAYMENTSHEET_TEST_MODE_REQUIRED");
    }

    const stripe = new Stripe(stripeKey, {
      timeout: 20_000,
      maxNetworkRetries: 0,
    });

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

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(accessToken);

    if (userError || !user) {
      return json(
        {
          code: "AUTH_REQUIRED",
          error: "Je sessie kon niet worden bevestigd. Log opnieuw in.",
        },
        401
      );
    }

    const currentEmail = user.email?.trim();

    if (!currentEmail || !user.email_confirmed_at) {
      return json(
        {
          code: "EMAIL_CONFIRMATION_REQUIRED",
          error: "Bevestig eerst je e-mailadres.",
        },
        403
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error("PAYMENT_PROFILE_LOOKUP_FAILED");
    }

    if (profile?.role !== "player") {
      return json(
        {
          code: "PLAYER_ACCOUNT_REQUIRED",
          error: "Een speleraccount is vereist.",
        },
        403
      );
    }

    let attempt = await readAttempt(admin, bookingId, user.id);
    let intent: Stripe.PaymentIntent;

    if (attempt.stripe_payment_intent_id) {
      /*
       * Bij een lookupfout nooit een nieuwe PaymentIntent aanmaken.
       *
       * Eerst ophalen, ook bij een inmiddels verlopen hold:
       * de betaling kan al geslaagd of in verwerking zijn.
       */
      if (!INTENT_PATTERN.test(attempt.stripe_payment_intent_id)) {
        throw new Error("STORED_PAYMENT_INTENT_INVALID");
      }

      intent = await stripe.paymentIntents.retrieve(
        attempt.stripe_payment_intent_id
      );
    } else {
      await assertPayable(admin, attempt, currentEmail);

      const { data: prepared, error: preparationError } =
        await admin.rpc(
          "prepare_single_lesson_payment_intent",
          {
            p_attempt_id: attempt.id,
            p_player_id: user.id,
          }
        );

      if (
        preparationError ||
        !isObject(prepared) ||
        prepared.attempt_id !== attempt.id ||
        prepared.booking_id !== bookingId ||
        prepared.channel !== "paymentsheet" ||
        prepared.status !== "creating" ||
        prepared.stripe_livemode !== false ||
        prepared.stripe_idempotency_key !==
          attempt.stripe_idempotency_key ||
        !isObject(prepared.stripe_create_parameters) ||
        !validTime(prepared.first_stripe_request_at)
      ) {
        throw new PaymentFlowError(
          "PAYMENT_PREPARATION_NOT_CONFIRMED",
          "De betaalvoorbereiding kon niet worden bevestigd. Controleer je boeking voordat je opnieuw probeert."
        );
      }

      const age =
        Date.now() - Date.parse(prepared.first_stripe_request_at);

      if (age < 0 || age >= SAFE_CREATE_WINDOW_MS) {
        throw new PaymentFlowError(
          "PAYMENT_REQUIRES_REVIEW",
          "Deze betaalpoging kan niet veilig automatisch worden hervat. Neem contact op met Gowtrain."
        );
      }

      /*
       * Gebruik uitsluitend de opgeslagen parameters.
       * De app levert geen bedrag, metadata of Stripe-parameters.
       */
      intent = await stripe.paymentIntents.create(
        prepared.stripe_create_parameters as unknown as
          Stripe.PaymentIntentCreateParams,
        {
          idempotencyKey: attempt.stripe_idempotency_key,
        }
      );

      validateIntent(intent, attempt);

      /*
       * Koppelen vóórdat een client secret wordt teruggegeven.
       * Een verloren antwoord laat de bestaande voorbereiding staan.
       */
      const { data: attached, error: attachError } = await admin.rpc(
        "attach_single_lesson_payment_intent",
        {
          p_attempt_id: attempt.id,
          p_payment_intent_id: intent.id,
          p_amount_cents: intent.amount,
          p_currency: intent.currency,
          p_livemode: intent.livemode,
          p_metadata: intent.metadata,
        }
      );

      if (attachError || attached !== true) {
        throw new Error("PAYMENT_INTENT_ATTACHMENT_NOT_CONFIRMED");
      }

      /*
       * Niet vertrouwen op een mogelijk ouder idempotent
       * aanmaakantwoord. Lees de actuele Stripe-status.
       */
      intent = await stripe.paymentIntents.retrieve(intent.id);
    }

    validateIntent(intent, attempt);

    if (intent.status === "succeeded") {
      const result = await syncSingleLessonPayment(intent.id);

      if (!result.handled || result.outcome === "not_succeeded") {
        throw new Error("PAYMENT_SUCCESS_NOT_CONFIRMED");
      }

      if (result.outcome === "needs_review") {
        return json(
          {
            state: "needs_review",
            bookingId,
            message:
              "Je betaling is geregistreerd, maar de boeking vereist aanvullende afhandeling. Betaal niet opnieuw.",
          },
          202
        );
      }

      return json({
        state: "payment_recorded",
        bookingId,
        bookingStatus: result.bookingStatus,
        message:
          "De betaling is verwerkt. Controleer de actuele boekingsstatus.",
      });
    }

    if (
      intent.status === "processing" ||
      intent.status === "requires_action" ||
      intent.status === "requires_capture"
    ) {
      /*
       * Een eerder gestarte betaling niet als nieuwe betaalpoging
       * aanbieden. Terugkeer vanuit bankverificatie wordt in
       * de app via de Stripe-SDK afgehandeld.
       */
      return json(
        {
          state: "pending",
          bookingId,
          message:
            "Er is al een betaling in behandeling of een verificatiestap gestart. Rond die af en controleer de status; start geen nieuwe betaling.",
        },
        202
      );
    }

    if (intent.status === "canceled") {
      throw new PaymentFlowError(
        "PAYMENT_CANCELED",
        "Deze betaalpoging is beëindigd. De reservering moet eerst veilig worden afgehandeld."
      );
    }

    if (
      intent.status !== "requires_payment_method" &&
      intent.status !== "requires_confirmation"
    ) {
      throw new Error("PAYMENT_INTENT_STATUS_UNSUPPORTED");
    }

    /*
     * Lees opnieuw na Stripe-aanmaak/ophalen.
     * Een parallelle webhook of andere statuswijziging mag niet
     * worden overschreven door dit oudere routeantwoord.
     */
    attempt = await readAttempt(admin, bookingId, user.id);

    if (attempt.stripe_payment_intent_id !== intent.id) {
      throw new Error("PAYMENT_INTENT_LINK_NOT_CONFIRMED");
    }

    await assertPayable(admin, attempt, currentEmail);
    validateIntent(intent, attempt);

    if (
      typeof intent.client_secret !== "string" ||
      !intent.client_secret.startsWith(`${intent.id}_secret_`)
    ) {
      throw new Error("PAYMENTSHEET_CLIENT_SECRET_MISSING");
    }

    /*
     * Alleen de eigenaar ontvangt de client secret.
     * Nooit loggen of opslaan in algemene appopslag.
     */
    return json({
      state: "ready",
      bookingId,
      paymentIntentClientSecret: intent.client_secret,
      amountCents: attempt.amount_cents,
      currency: attempt.currency,
      reservationExpiresAt: attempt.reservation_expires_at,
    });
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return json(
        {
          code: "INVALID_PAYMENT_REQUEST",
          error: "Geef alleen een geldig boekingsnummer op.",
        },
        400
      );
    }

    if (error instanceof PaymentFlowError) {
      return json(
        {
          code: error.code,
          error: error.message,
        },
        error.httpStatus
      );
    }

    /*
     * Geen Stripe-objecten, client secrets, Bearer-tokens
     * of ruwe providerfouten loggen/teruggeven.
     */
    return json(
      {
        code: "PAYMENT_OPEN_NOT_CONFIRMED",
        error:
          "Het openen van de betaling kon niet worden bevestigd. Een betaalpoging kan al bestaan. Controleer je boeking en start niet automatisch een nieuwe betaling.",
      },
      503
    );
  }
}