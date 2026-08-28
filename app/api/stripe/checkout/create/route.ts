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

function getAppUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://gowtrain-website.vercel.app");

  return url.replace(/\/$/, "");
}

const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
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

type RequestBody = {
  bookingId?: string;
};

type BookingForCheckout = {
  id: string;
  trainer_id: string;
  player_id: string | null;
  player_email: string;
  player_name: string;
  status: string;
  hold_expires_at: string | null;
  total_price_cents: number;
  currency: string;
  stripe_checkout_session_id: string | null;

  trainers: {
    name: string;
    stripe_payouts_enabled: boolean;
  } | null;

  availability_slots: {
    starts_at: string;
    ends_at: string;
    sport: string;
    max_participants: number;
    venues: {
      name: string;
      city: string;
    } | null;
  } | null;
};

function formatTrainingDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export async function POST(request: NextRequest) {
  try {
    const authorizationHeader = request.headers.get("authorization");

    if (!authorizationHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Je bent niet ingelogd." },
        { status: 401 }
      );
    }

    const accessToken = authorizationHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as RequestBody;
    const bookingId = body.bookingId?.trim();

    if (!bookingId) {
      return NextResponse.json(
        { error: "Boeking ontbreekt." },
        { status: 400 }
      );
    }

    const { data: bookingData, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select(
        `
          id,
          trainer_id,
          player_id,
          player_email,
          player_name,
          status,
          hold_expires_at,
          total_price_cents,
          currency,
          stripe_checkout_session_id,

          trainers (
            name,
            stripe_payouts_enabled
          ),

          availability_slots (
            starts_at,
            ends_at,
            sport,
            max_participants,

            venues (
              name,
              city
            )
          )
        `
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !bookingData) {
      console.error("Booking ophalen voor Checkout fout:", bookingError?.message);

      return NextResponse.json(
        { error: "Deze boeking kon niet worden gevonden." },
        { status: 404 }
      );
    }

    const booking = bookingData as unknown as BookingForCheckout;

    /*
      Alleen de speler die de booking heeft gemaakt mag betalen.
    */
    if (booking.player_id !== user.id) {
      return NextResponse.json(
        { error: "Je mag deze boeking niet betalen." },
        { status: 403 }
      );
    }

    if (booking.status !== "payment_pending") {
      return NextResponse.json(
        { error: "Deze boeking wacht niet meer op betaling." },
        { status: 400 }
      );
    }

    if (
      !booking.hold_expires_at ||
      new Date(booking.hold_expires_at).getTime() <= Date.now()
    ) {
      return NextResponse.json(
        {
          error:
            "Je tijdelijke reservering is verlopen. Kies opnieuw een beschikbaar moment.",
        },
        { status: 400 }
      );
    }

    if (!booking.trainers?.stripe_payouts_enabled) {
      return NextResponse.json(
        {
          error:
            "De trainer heeft uitbetalingen nog niet ingesteld. Kies later opnieuw een moment.",
        },
        { status: 400 }
      );
    }

    if (!booking.availability_slots) {
      return NextResponse.json(
        { error: "De gegevens van dit trainingsmoment ontbreken." },
        { status: 400 }
      );
    }

    /*
      Als er al een actieve Checkout Session bestaat, hergebruiken we die.
    */
    if (booking.stripe_checkout_session_id) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(
          booking.stripe_checkout_session_id
        );

        if (
          existingSession.status === "open" &&
          existingSession.url &&
          existingSession.expires_at &&
          existingSession.expires_at * 1000 > Date.now()
        ) {
          return NextResponse.json({
            checkoutUrl: existingSession.url,
          });
        }
      } catch (e) {
        console.warn("Bestaande Stripe sessie ophalen mislukt, nieuwe maken:", e);
      }
    }

    const slot = booking.availability_slots;
    const venue = slot.venues;

    const trainingDescription = [
      `${slot.sport.toUpperCase()}training`,
      `${booking.player_name} · max. ${slot.max_participants} spelers`,
      venue ? `${venue.name}, ${venue.city}` : null,
      formatTrainingDate(slot.starts_at),
    ]
      .filter(Boolean)
      .join(" · ");

    /*
      Stripe Checkout eist dat expires_at MINIMAAL 30 minuten in de toekomst ligt.
      Daarom garanderen we nu dat expiresAt altijd minimaal nu + 30 min (+ 5 sec) is.
    */
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const holdExpiresInSeconds = Math.floor(
      new Date(booking.hold_expires_at).getTime() / 1000
    );
    const expiresAt = Math.max(holdExpiresInSeconds, nowInSeconds + 1805);

    const appUrl = getAppUrl();

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: booking.player_email,

        payment_method_types: ["ideal", "card"],

        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: booking.currency,
              unit_amount: booking.total_price_cents,
              product_data: {
                name: `Training bij ${booking.trainers.name}`,
                description: trainingDescription,
              },
            },
          },
        ],

        metadata: {
          gowtrain_booking_id: booking.id,
          gowtrain_trainer_id: booking.trainer_id,
        },

        payment_intent_data: {
          metadata: {
            gowtrain_booking_id: booking.id,
            gowtrain_trainer_id: booking.trainer_id,
          },
        },

        success_url: `${appUrl}/boeken/succes?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/mijn-boekingen`,

        expires_at: expiresAt,
      },
      {
        idempotencyKey: `gowtrain-checkout-${booking.id}`,
      }
    );

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe kon geen betaalpagina maken." },
        { status: 500 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", booking.id)
      .eq("status", "payment_pending");

    if (updateError) {
      console.error(
        "Stripe Checkout Session opslaan bij booking fout:",
        updateError.message
      );

      return NextResponse.json(
        { error: "De betaalpagina kon niet worden gekoppeld aan je boeking." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error("Stripe Checkout maken fout:", error);

    return NextResponse.json(
      {
        error:
          "De betaalpagina kon niet worden geopend. Probeer het opnieuw.",
      },
      { status: 500 }
    );
  }
}