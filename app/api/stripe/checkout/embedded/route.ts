import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  createOrResumePackageCheckout,
  PackageCheckoutError,
} from "@/lib/stripe-package-checkout";

export const runtime = "nodejs";

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
    (
      isLocal &&
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    )
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL is ongeldig.");
  }

  return url.origin;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

const stripe = new Stripe(
  getRequiredEnv("STRIPE_SECRET_KEY")
);

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

type BookingForEmbeddedCheckout = {
  id: string;
  trainer_id: string;
  player_id: string | null;
  slot_id: string | null;
  status: string;
  paid_at: string | null;
  hold_expires_at: string | null;
  total_price_cents: number;
  currency: string;

  availability_slots: {
    id: string;
    trainer_id: string;
    status: string;
    starts_at: string;
    sport: string;
    package_id: string | null;
  } | null;
};

function jsonResponse(
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
  request: Request
): Promise<NextResponse> {
  try {
    /*
     * 1. Controleer de ingelogde gebruiker.
     */
    const authorization =
      request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse(
        { error: "Je bent niet ingelogd." },
        401
      );
    }

    const accessToken = authorization.slice(7).trim();

    if (!accessToken) {
      return jsonResponse(
        { error: "Je bent niet ingelogd." },
        401
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return jsonResponse(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        401
      );
    }

    if (!user.email || !user.email_confirmed_at) {
      return jsonResponse(
        { error: "Bevestig eerst je e-mailadres." },
        403
      );
    }

    /*
     * 2. Controleer de requestbody.
     */
    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return jsonResponse(
        { error: "De aanvraag bevat geen geldige JSON." },
        400
      );
    }

    if (
      !rawBody ||
      typeof rawBody !== "object" ||
      Array.isArray(rawBody)
    ) {
      return jsonResponse(
        { error: "Ongeldige aanvraag." },
        400
      );
    }

    const body = rawBody as Record<string, unknown>;

    if (
      (
        body.bookingId != null &&
        typeof body.bookingId !== "string"
      ) ||
      (
        body.packageId != null &&
        typeof body.packageId !== "string"
      )
    ) {
      return jsonResponse(
        { error: "Boeking-ID en pakket-ID moeten tekstwaarden zijn." },
        400
      );
    }

    const bookingId =
      typeof body.bookingId === "string"
        ? body.bookingId.trim().toLowerCase()
        : "";

    const packageId =
      typeof body.packageId === "string"
        ? body.packageId.trim().toLowerCase()
        : "";

    if (bookingId && packageId) {
      return jsonResponse(
        {
          error:
            "Geef een bookingId óf een packageId op, niet beide.",
        },
        400
      );
    }

    if (!bookingId && !packageId) {
      return jsonResponse(
        { error: "Geen boeking of pakket opgegeven." },
        400
      );
    }

    /*
     * 3. LESPAKKET
     *
     * De gedeelde helper:
     * - reserveert het pakket;
     * - controleert de vastgelegde prijs;
     * - hergebruikt de bestaande betaalpoging;
     * - bewaart de Stripe Session-koppeling;
     * - gebruikt geen directe trainertransfer.
     */
    if (packageId) {
      if (!isUuid(packageId)) {
        return jsonResponse(
          { error: "Een geldig lespakket-ID is verplicht." },
          400
        );
      }

      const checkout = await createOrResumePackageCheckout({
        packageId,
        playerId: user.id,
        playerEmail: user.email,
        mode: "embedded",
      });

      if (!checkout.clientSecret) {
        throw new Error(
          "De embedded Checkout-client secret ontbreekt."
        );
      }

      return jsonResponse({
        clientSecret: checkout.clientSecret,
      });
    }

    /*
     * 4. LOSSE LES
     *
     * Deze route gebruikt voorlopig de bestaande losse-lesflow.
     * De migratie daarvan naar checkout_attempts volgt apart.
     */
    if (!isUuid(bookingId)) {
      return jsonResponse(
        { error: "Een geldig boekings-ID is verplicht." },
        400
      );
    }

    const {
      data: bookingData,
      error: bookingError,
    } = await supabaseAdmin
      .from("bookings")
      .select(
        `
          id,
          trainer_id,
          player_id,
          slot_id,
          status,
          paid_at,
          hold_expires_at,
          total_price_cents,
          currency,

          availability_slots (
            id,
            trainer_id,
            status,
            starts_at,
            sport,
            package_id
          )
        `
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      console.error("Boeking ophalen voor embedded Checkout mislukt:", {
        code: bookingError.code,
        message: bookingError.message,
      });

      return jsonResponse(
        {
          error:
            "De boeking kon tijdelijk niet worden opgehaald. Probeer het later opnieuw.",
        },
        503
      );
    }

    if (!bookingData) {
      return jsonResponse(
        { error: "Boeking niet gevonden." },
        404
      );
    }

    const booking =
      bookingData as unknown as BookingForEmbeddedCheckout;

    if (booking.player_id !== user.id) {
      return jsonResponse(
        { error: "Je hebt geen toegang tot deze boeking." },
        403
      );
    }

    if (
      booking.status !== "payment_pending" ||
      booking.paid_at !== null
    ) {
      return jsonResponse(
        {
          error:
            "Deze boeking wacht niet meer op betaling. Controleer je boekingen.",
        },
        409
      );
    }

    const slot = booking.availability_slots;

    if (
      !slot ||
      !booking.slot_id ||
      slot.id !== booking.slot_id ||
      slot.trainer_id !== booking.trainer_id
    ) {
      return jsonResponse(
        { error: "De tijdslotgegevens van deze boeking zijn ongeldig." },
        409
      );
    }

    if (slot.package_id !== null) {
      return jsonResponse(
        {
          error:
            "Deze les hoort bij een pakket en kan niet afzonderlijk worden afgerekend.",
        },
        409
      );
    }

    const holdExpiresAt = Date.parse(
      booking.hold_expires_at ?? ""
    );

    const startsAt = Date.parse(slot.starts_at);

    if (
      !Number.isFinite(holdExpiresAt) ||
      holdExpiresAt <= Date.now() ||
      slot.status !== "held" ||
      !Number.isFinite(startsAt) ||
      startsAt <= Date.now()
    ) {
      return jsonResponse(
        {
          error:
            "Deze reservering kan niet meer worden hervat. Heb je al betaald? Controleer je boekingen en start geen nieuwe betaling.",
        },
        409
      );
    }

    if (
      !Number.isSafeInteger(booking.total_price_cents) ||
      booking.total_price_cents <= 0 ||
      booking.currency.toLowerCase() !== "eur"
    ) {
      return jsonResponse(
        { error: "Het boekingsbedrag of de valuta is ongeldig." },
        409
      );
    }

    const appUrl = getAppUrl();

    const metadata: Record<string, string> = {
      player_id: user.id,
      gowtrain_booking_id: booking.id,
      gowtrain_trainer_id: booking.trainer_id,
      trainer_id: booking.trainer_id,
      slot_id: booking.slot_id,
      booking_type: "single_slot",
      gowtrain_funds_flow: "separate_transfers_v1",
    };

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      ui_mode: "embedded_page",
      mode: "payment",
      payment_method_types: ["card", "ideal"],
      customer_email: user.email,

      line_items: [
        {
          price_data: {
            currency: booking.currency.toLowerCase(),
            unit_amount: booking.total_price_cents,
            product_data: {
              name: `Gowtrain ${slot.sport.toUpperCase()}training`,
              description: "Training inclusief baanhuur via Gowtrain",
            },
          },
          quantity: 1,
        },
      ],

      metadata,

      // Platformbetaling; de trainertransfer gebeurt later.
      payment_intent_data: {
        metadata,
      },

      return_url:
        `${appUrl}/boeken/succes` +
        "?session_id={CHECKOUT_SESSION_ID}",
    };

    const session = await stripe.checkout.sessions.create(
      sessionParams
    );

    if (!session.client_secret) {
      throw new Error(
        "Stripe heeft geen embedded Checkout-client secret teruggegeven."
      );
    }

    return jsonResponse({
      clientSecret: session.client_secret,
    });
  } catch (error: unknown) {
    if (error instanceof PackageCheckoutError) {
      return jsonResponse(
        { error: error.message },
        error.status
      );
    }

    console.error("Embedded Checkout mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return jsonResponse(
      {
        error:
          "De betaalpagina kon niet worden geopend. Probeer het later opnieuw. Heb je al betaald? Controleer eerst je boekingen.",
      },
      503
    );
  }
}