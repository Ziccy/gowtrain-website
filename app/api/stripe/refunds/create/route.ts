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
  issueId?: string;
};

type RefundBooking = {
  id: string;
  player_id: string | null;
  trainer_id: string;
  status: string;
  cancellation_policy: string | null;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
};

async function getAuthenticatedUser(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization");

  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
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
    error,
  } = await supabaseAuth.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as RequestBody;

    const bookingId = body.bookingId?.trim();
    const issueId = body.issueId?.trim() || null;

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
          player_id,
          trainer_id,
          status,
          cancellation_policy,
          stripe_payment_intent_id,
          stripe_refund_id
        `
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !bookingData) {
      console.error("Booking ophalen voor refund fout:", bookingError?.message);

      return NextResponse.json(
        { error: "Deze booking kon niet worden gevonden." },
        { status: 404 }
      );
    }

    const booking = bookingData as RefundBooking;

    if (booking.status !== "refund_pending") {
      return NextResponse.json(
        {
          error:
            "Deze booking wacht niet op een terugbetaling of is al verwerkt.",
        },
        { status: 400 }
      );
    }

    const isPlayerTimelyRefund =
      booking.cancellation_policy === "player_timely_refund";

    const isTrainerCancellation =
      booking.cancellation_policy === "trainer_cancelled_refund";

    const isAdminRefund = booking.cancellation_policy === "admin_refund";

    if (
      !isPlayerTimelyRefund &&
      !isTrainerCancellation &&
      !isAdminRefund
    ) {
      return NextResponse.json(
        { error: "Deze annulering geeft geen recht op automatische refund." },
        { status: 400 }
      );
    }

    /*
      Speler mag alleen een refund starten voor een eigen, tijdige annulering.
    */
    if (isPlayerTimelyRefund && booking.player_id !== user.id) {
      return NextResponse.json(
        { error: "Je mag deze booking niet terugbetalen." },
        { status: 403 }
      );
    }

    /*
      Trainer mag alleen refund starten voor een eigen trainerannulering.
    */
    if (isTrainerCancellation) {
      const { data: trainerData, error: trainerError } = await supabaseAdmin
        .from("trainers")
        .select("id")
        .eq("id", booking.trainer_id)
        .eq("user_id", user.id)
        .eq("approval_status", "approved")
        .eq("is_active", true)
        .maybeSingle();

      if (trainerError || !trainerData) {
        return NextResponse.json(
          { error: "Je mag deze trainerannulering niet uitvoeren." },
          { status: 403 }
        );
      }
    }

    /*
      Admin-refund mag alleen vanuit een open/in-review issue worden gestart.
    */
    if (isAdminRefund) {
      if (!issueId) {
        return NextResponse.json(
          {
            error:
              "Een probleemmelding is verplicht voor een administratieve refund.",
          },
          { status: 400 }
        );
      }

      const { data: adminProfile, error: adminError } = await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("id", user.id)
        .maybeSingle();

      if (adminError || adminProfile?.role !== "admin") {
        return NextResponse.json(
          { error: "Je hebt geen rechten om deze refund uit te voeren." },
          { status: 403 }
        );
      }

      const { data: issueData, error: issueError } = await supabaseAdmin
        .from("booking_issues")
        .select("id, booking_id, status, resolution_type")
        .eq("id", issueId)
        .maybeSingle();

      if (issueError || !issueData) {
        return NextResponse.json(
          { error: "Deze probleemmelding kon niet worden gevonden." },
          { status: 404 }
        );
      }

      if (issueData.booking_id !== booking.id) {
        return NextResponse.json(
          { error: "Deze probleemmelding hoort niet bij deze booking." },
          { status: 400 }
        );
      }

      if (!["open", "in_review"].includes(issueData.status)) {
        return NextResponse.json(
          { error: "Deze probleemmelding is al afgehandeld." },
          { status: 400 }
        );
      }

      if (issueData.resolution_type !== "full_refund") {
        return NextResponse.json(
          {
            error:
              "Deze probleemmelding is niet gemarkeerd voor een volledige refund.",
          },
          { status: 400 }
        );
      }
    }

    if (!booking.stripe_payment_intent_id) {
      return NextResponse.json(
        { error: "De oorspronkelijke Stripe-betaling ontbreekt." },
        { status: 400 }
      );
    }

    /*
      Herhaald klikken is veilig: als de refund al bestaat, geven we
      de bestaande Stripe refund-ID terug.
    */
    if (booking.stripe_refund_id) {
      return NextResponse.json({
        refundId: booking.stripe_refund_id,
        status: "already_requested",
      });
    }

    const cancelledBy = isAdminRefund
      ? "admin"
      : isTrainerCancellation
      ? "trainer"
      : "player";

    const refund = await stripe.refunds.create(
      {
        payment_intent: booking.stripe_payment_intent_id,
        reason: "requested_by_customer",
        metadata: {
          gowtrain_booking_id: booking.id,
          gowtrain_issue_id: issueId ?? "",
          gowtrain_cancellation_policy: booking.cancellation_policy ?? "",
          gowtrain_cancelled_by: cancelledBy,
        },
      },
      {
        /*
          Stripe gebruikt deze key om dubbele refunds bij retries
          of dubbelklikken te voorkomen.
        */
        idempotencyKey: `gowtrain-refund-${booking.id}`,
      }
    );

    const { error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        stripe_refund_id: refund.id,
        refund_last_error: null,
      })
      .eq("id", booking.id)
      .eq("status", "refund_pending");

    if (updateError) {
      console.error(
        "Stripe refund-ID opslaan bij booking fout:",
        updateError.message
      );

      return NextResponse.json(
        {
          error:
            "De refund is aangevraagd, maar kon nog niet volledig in Gowtrain worden opgeslagen.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      refundId: refund.id,
      status: refund.status,
      amountCents: refund.amount,
      currency: refund.currency,
    });
  } catch (error) {
    console.error("Stripe refund maken fout:", error);

    return NextResponse.json(
      {
        error:
          "De terugbetaling kon niet worden gestart. Probeer het opnieuw of neem contact op met Gowtrain.",
      },
      { status: 500 }
    );
  }
}