import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

type CheckoutMode = "hosted" | "embedded";

type PackageCheckoutAttempt = {
  id: string;
  package_id: string | null;
  player_id: string;
  trainer_id: string;
  checkout_mode: CheckoutMode;
  status: string;
  amount_cents: number;
  currency: string;
  stripe_livemode: boolean;
  funds_flow: string;
  stripe_idempotency_key: string;
  stripe_checkout_session_id: string | null;
  checkout_parameters: Record<string, unknown> | null;
  purchase_snapshot: Record<string, unknown>;
  reservation_expires_at: string;
  first_stripe_request_at: string | null;
};

type PackageCheckoutInput = {
  packageId: string;

  // De API-route moet deze gebruiker eerst verifiëren
  // met supabase.auth.getUser(accessToken).
  playerId: string;
  playerEmail: string;

  mode: CheckoutMode;
};

export type PackageCheckoutResult = {
  attemptId: string;
  checkoutSessionId: string;
  checkoutUrl: string | null;
  clientSecret: string | null;
};

export class PackageCheckoutError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "PackageCheckoutError";
    this.status = status;
  }
}

const SAFE_CREATE_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const CHECKOUT_DURATION_SECONDS = 35 * 60;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

function getAppUrl(): string {
  const url = new URL(getRequiredEnv("NEXT_PUBLIC_APP_URL"));

  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  if (
    url.username ||
    url.password ||
    (!isLocal && url.protocol !== "https:") ||
    (isLocal &&
      url.protocol !== "http:" &&
      url.protocol !== "https:")
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL is ongeldig.");
  }

  return url.origin;
}

function getStripeLivemode(secretKey: string): boolean {
  if (
    secretKey.startsWith("sk_test_") ||
    secretKey.startsWith("rk_test_")
  ) {
    return false;
  }

  if (
    secretKey.startsWith("sk_live_") ||
    secretKey.startsWith("rk_live_")
  ) {
    return true;
  }

  throw new Error("De Stripe API-key heeft een onbekend formaat.");
}

function getFirstLessonStart(
  snapshot: Record<string, unknown>
): number {
  if (!Array.isArray(snapshot.slots) || snapshot.slots.length === 0) {
    throw new PackageCheckoutError(
      "De opgeslagen pakketlessen ontbreken."
    );
  }

  const starts = snapshot.slots.map((value: unknown) => {
    if (!value || typeof value !== "object") {
      return NaN;
    }

    const startsAt = (value as Record<string, unknown>).starts_at;

    return typeof startsAt === "string"
      ? Date.parse(startsAt)
      : NaN;
  });

  if (starts.some((value) => !Number.isFinite(value))) {
    throw new PackageCheckoutError(
      "De opgeslagen pakketplanning is ongeldig."
    );
  }

  return Math.min(...starts);
}

function validateAttempt(
  attempt: PackageCheckoutAttempt,
  input: PackageCheckoutInput,
  livemode: boolean
): void {
  if (
    attempt.package_id !== input.packageId ||
    attempt.player_id !== input.playerId ||
    attempt.checkout_mode !== input.mode ||
    attempt.stripe_livemode !== livemode ||
    attempt.funds_flow !== "separate_transfers_v1"
  ) {
    throw new PackageCheckoutError(
      "De betaalpoging komt niet overeen met deze aanvraag."
    );
  }

  if (!["reserved", "creating", "open"].includes(attempt.status)) {
    throw new PackageCheckoutError(
      "Deze betaalpoging kan niet opnieuw worden geopend. Controleer je boekingen."
    );
  }

  if (
    !Number.isSafeInteger(attempt.amount_cents) ||
    attempt.amount_cents <= 0 ||
    attempt.currency !== "eur"
  ) {
    throw new PackageCheckoutError(
      "De betaalpoging bevat ongeldige prijsgegevens."
    );
  }
}

function validateStripeSession(
  session: Stripe.Checkout.Session,
  attempt: PackageCheckoutAttempt
): void {
  if (
    session.mode !== "payment" ||
    String(session.ui_mode) !== (
  attempt.checkout_mode === "embedded"
    ? "embedded_page"
    : "hosted"
) ||
    session.livemode !== attempt.stripe_livemode ||
    session.metadata?.gowtrain_checkout_attempt_id !== attempt.id ||
    session.metadata?.package_id !== attempt.package_id ||
    session.metadata?.player_id !== attempt.player_id ||
    session.amount_total !== attempt.amount_cents ||
    session.currency !== attempt.currency
  ) {
    throw new PackageCheckoutError(
      "De Stripe-betaalpagina komt niet overeen met de reservering."
    );
  }
}

function makeCheckoutResult(
  session: Stripe.Checkout.Session,
  attempt: PackageCheckoutAttempt
): PackageCheckoutResult {
  if (
    session.payment_status === "paid" ||
    session.status === "complete"
  ) {
    throw new PackageCheckoutError(
      "Deze betaalpagina is al afgerond. Controleer je boekingen; de betaling kan nog worden verwerkt."
    );
  }

  if (
    session.status !== "open" ||
    session.expires_at * 1000 <= Date.now()
  ) {
    throw new PackageCheckoutError(
      "Deze betaalpagina is verlopen. De reservering moet eerst veilig worden afgesloten."
    );
  }

  if (attempt.checkout_mode === "hosted" && !session.url) {
    throw new PackageCheckoutError(
      "Stripe heeft geen betaalpagina teruggegeven.",
      502
    );
  }

  if (
    attempt.checkout_mode === "embedded" &&
    !session.client_secret
  ) {
    throw new PackageCheckoutError(
      "Stripe heeft geen embedded betaalsessie teruggegeven.",
      502
    );
  }

  return {
    attemptId: attempt.id,
    checkoutSessionId: session.id,
    checkoutUrl:
      attempt.checkout_mode === "hosted" ? session.url : null,
    clientSecret:
      attempt.checkout_mode === "embedded"
        ? session.client_secret
        : null,
  };
}

export async function createOrResumePackageCheckout(
  input: PackageCheckoutInput
): Promise<PackageCheckoutResult> {
  const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
  const livemode = getStripeLivemode(stripeSecretKey);
  const appUrl = getAppUrl();

  const stripe = new Stripe(stripeSecretKey, {
    timeout: 20_000,
    maxNetworkRetries: 1,
  });

  const supabaseAdmin = createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  /*
   * 1. Reserveer het pakket of haal de bestaande poging op.
   *
   * Deze RPC vergrendelt het pakket en controleert onder
   * andere beschikbaarheid, koper, lessen en prijs.
   */
  const { data, error } = await supabaseAdmin.rpc(
    "reserve_package_checkout",
    {
      p_package_id: input.packageId,
      p_player_id: input.playerId,
      p_checkout_mode: input.mode,
      p_stripe_livemode: livemode,
    }
  );

  if (error) {
    console.error("Pakket reserveren mislukt:", {
      code: error.code,
      message: error.message,
    });

    if (error.code === "P0001") {
      throw new PackageCheckoutError(error.message);
    }

    throw new PackageCheckoutError(
      "Het pakket kon niet worden gereserveerd. Probeer het later opnieuw.",
      503
    );
  }

  let attempt = (
    Array.isArray(data) ? data[0] : data
  ) as PackageCheckoutAttempt | null;

  if (!attempt) {
    throw new PackageCheckoutError(
      "Er kon geen betaalpoging worden opgehaald.",
      503
    );
  }

  validateAttempt(attempt, input, livemode);

  /*
   * 2. Hergebruik een reeds gekoppelde Stripe Session.
   *
   * Bij een Stripe-fout géén nieuwe Session aanmaken.
   */
  if (attempt.stripe_checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(
      attempt.stripe_checkout_session_id
    );

    validateStripeSession(session, attempt);

    return makeCheckoutResult(session, attempt);
  }

  /*
   * 3. Sla de exacte Stripe-parameters eenmalig op.
   *
   * De voorwaardelijke update zorgt dat bij gelijktijdige
   * aanvragen maar één versie wordt opgeslagen.
   * Alle aanvragen lezen daarna die opgeslagen versie.
   */
  if (attempt.checkout_parameters === null) {
    if (attempt.status !== "reserved") {
      throw new PackageCheckoutError(
        "De betaalpoging moet worden gecontroleerd voordat je verder kunt."
      );
    }

    const reservationExpiresAt = Date.parse(
      attempt.reservation_expires_at
    );

    if (
      !Number.isFinite(reservationExpiresAt) ||
      reservationExpiresAt <= Date.now()
    ) {
      throw new PackageCheckoutError(
        "De reserveringstermijn is verstreken. De poging moet eerst worden afgesloten."
      );
    }

    const title = attempt.purchase_snapshot.package_title;
    const lessonCount = attempt.purchase_snapshot.lesson_count;

    if (
      typeof title !== "string" ||
      !title.trim() ||
      typeof lessonCount !== "number" ||
      !Number.isInteger(lessonCount) ||
      lessonCount <= 0
    ) {
      throw new PackageCheckoutError(
        "De vastgelegde pakketgegevens zijn ongeldig."
      );
    }

    const expiresAt =
      Math.floor(Date.now() / 1000) + CHECKOUT_DURATION_SECONDS;

    if (
      getFirstLessonStart(attempt.purchase_snapshot) <=
      expiresAt * 1000
    ) {
      throw new PackageCheckoutError(
        "De eerste les begint te snel om nog een betaalpagina te openen."
      );
    }

    const metadata = {
      gowtrain_checkout_attempt_id: attempt.id,
      package_id: input.packageId,
      player_id: input.playerId,
      trainer_id: attempt.trainer_id,
      booking_type: "package",
      gowtrain_funds_flow: "separate_transfers_v1",
    };

    const parameters: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      ui_mode:
      input.mode === "embedded"
    ? "embedded_page"
    : "hosted",
      payment_method_types: ["card", "ideal"],
      customer_email: input.playerEmail,
      client_reference_id: attempt.id,

      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: attempt.currency,
            unit_amount: attempt.amount_cents,
            product_data: {
              name: title.trim(),
              description: `${lessonCount} trainingen via Gowtrain`,
            },
          },
        },
      ],

      metadata,

      // Platformbetaling; geen directe transfer naar de trainer.
      payment_intent_data: {
        metadata,
      },

      expires_at: expiresAt,
    };

    if (input.mode === "embedded") {
      parameters.return_url =
        `${appUrl}/boeken/succes` +
        `?session_id={CHECKOUT_SESSION_ID}` +
        `&package_id=${encodeURIComponent(input.packageId)}`;
    } else {
      parameters.success_url =
        `${appUrl}/boeken/succes` +
        `?session_id={CHECKOUT_SESSION_ID}` +
        `&package_id=${encodeURIComponent(input.packageId)}`;

      parameters.cancel_url =
        `${appUrl}/boeken/pakket/${encodeURIComponent(input.packageId)}` +
        "?canceled=true";
    }

    const { error: preparationError } = await supabaseAdmin
      .from("checkout_attempts")
      .update({
        checkout_parameters: parameters,
        status: "creating",
        first_stripe_request_at: new Date().toISOString(),
        stripe_session_expires_at: new Date(
          expiresAt * 1000
        ).toISOString(),
        reservation_expires_at: new Date(
          expiresAt * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id)
      .eq("player_id", input.playerId)
      .eq("status", "reserved")
      .is("checkout_parameters", null)
      .gt("reservation_expires_at", new Date().toISOString());

    if (preparationError) {
      throw new PackageCheckoutError(
        "De betaalpoging kon niet worden voorbereid. Probeer het later opnieuw.",
        503
      );
    }
  }

  /*
   * 4. Lees altijd de opgeslagen parameters opnieuw.
   * Gebruik niet de lokaal berekende versie bij een race.
   */
  const { data: latest, error: latestError } = await supabaseAdmin
    .from("checkout_attempts")
    .select("*")
    .eq("id", attempt.id)
    .eq("player_id", input.playerId)
    .single();

  if (latestError || !latest) {
    throw new PackageCheckoutError(
      "De betaalpoging kon niet worden gecontroleerd. Probeer het later opnieuw.",
      503
    );
  }

  attempt = latest as PackageCheckoutAttempt;
  validateAttempt(attempt, input, livemode);

  // Een andere aanvraag kan de Session inmiddels hebben opgeslagen.
  if (attempt.stripe_checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(
      attempt.stripe_checkout_session_id
    );

    validateStripeSession(session, attempt);

    return makeCheckoutResult(session, attempt);
  }

  if (
    attempt.status !== "creating" ||
    !attempt.checkout_parameters ||
    !attempt.first_stripe_request_at
  ) {
    throw new PackageCheckoutError(
      "De betaalpoging is niet gereed. De reservering moet worden gecontroleerd."
    );
  }

  const firstRequestAt = Date.parse(attempt.first_stripe_request_at);
  const age = Date.now() - firstRequestAt;

  if (
    !Number.isFinite(firstRequestAt) ||
    age < 0 ||
    age >= SAFE_CREATE_RETRY_WINDOW_MS
  ) {
    // Geen nieuwe Session maken buiten het veilige retryvenster.
    // De poging blijft blokkeren totdat deze gecontroleerd is.
    throw new PackageCheckoutError(
      "Deze betaalpoging is te oud om veilig automatisch te hervatten. Neem contact op met Gowtrain."
    );
  }

  /*
   * 5. Stripe aanroepen met exact dezelfde parameters en sleutel.
   *
   * Bij een timeout laten we de poging op creating staan.
   * We maken niet automatisch een tweede poging aan.
   */
  const storedParameters =
    attempt.checkout_parameters as unknown as
      Stripe.Checkout.SessionCreateParams;

  const session = await stripe.checkout.sessions.create(
    storedParameters,
    {
      idempotencyKey: attempt.stripe_idempotency_key,
    }
  );

  validateStripeSession(session, attempt);

  /*
   * 6. Sla het Session-ID op voordat de betaalpagina
   * of client secret aan de speler wordt teruggegeven.
   *
   * Geen payment_intent_id opslaan vanuit dit mogelijk
   * verouderde antwoord; de betaalwebhook registreert dat.
   */
  const { data: saved, error: saveError } = await supabaseAdmin
    .from("checkout_attempts")
    .update({
      stripe_checkout_session_id: session.id,
      stripe_session_expires_at: new Date(
        session.expires_at * 1000
      ).toISOString(),
      status: "open",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    .eq("player_id", input.playerId)
    .eq("status", "creating")
    .is("stripe_checkout_session_id", null)
    .select("id")
    .maybeSingle();

  if (saveError) {
    // De Stripe Session kan al bestaan.
    // De vaste idempotency key maakt later herstel mogelijk.
    throw new PackageCheckoutError(
      "De betaalpagina is aangemaakt, maar kon nog niet worden gekoppeld. Probeer het later opnieuw.",
      503
    );
  }

  if (!saved) {
    const { data: current, error: currentError } =
      await supabaseAdmin
        .from("checkout_attempts")
        .select("*")
        .eq("id", attempt.id)
        .eq("player_id", input.playerId)
        .single();

    if (
      currentError ||
      !current ||
      current.stripe_checkout_session_id !== session.id
    ) {
      throw new PackageCheckoutError(
        "De koppeling van de betaalpagina moet worden gecontroleerd.",
        503
      );
    }

    attempt = current as PackageCheckoutAttempt;
    validateAttempt(attempt, input, livemode);

    const currentSession = await stripe.checkout.sessions.retrieve(
      session.id
    );

    validateStripeSession(currentSession, attempt);

    return makeCheckoutResult(currentSession, attempt);
  }

  return makeCheckoutResult(session, attempt);
}