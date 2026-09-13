import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Niet geautoriseerd." }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Niet geautoriseerd." }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId, packageId } = body;
    if (bookingId && packageId) {
  return NextResponse.json(
    { error: "Geef een bookingId óf een packageId op, niet beide." },
    { status: 400 },
  );
}

    const origin = req.headers.get("origin") || "http://localhost:3000";

    // A. Product details ophalen (Losse les of Lespakket)
    let title = "GowTrain Training";
    let amountCents = 0;
    let trainerId = "";
    let metadata: Record<string, string> = { player_id: user.id };

    if (packageId) {
      const { data: pkg } = await supabaseAdmin
        .from("trainer_packages")
        .select("*, trainer:trainers(*)")
        .eq("id", packageId)
        .single();

      if (!pkg) return NextResponse.json({ error: "Lespakket niet gevonden." }, { status: 404 });
      if (pkg.is_active !== true) {
  return NextResponse.json(
    { error: "Dit lespakket is niet meer beschikbaar." },
    { status: 409 },
  );
}

      title = pkg.title;
      amountCents = pkg.price_cents;
      trainerId = pkg.trainer_id;
      metadata = {
        ...metadata,
        package_id: pkg.id,
        booking_type: "package",
      };
    } else if (bookingId) {
      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("*, availability_slots(*), trainer:trainers(*)")
        .eq("id", bookingId)
        .single();

      if (!booking) return NextResponse.json({ error: "Boeking niet gevonden." }, { status: 404 });
      if (booking.player_id !== user.id) {
  return NextResponse.json(
    { error: "Je hebt geen toegang tot deze boeking." },
    { status: 403 },
  );
}

if (
  booking.status !== "payment_pending" ||
  booking.paid_at !== null
) {
  return NextResponse.json(
    { error: "Deze boeking kan niet opnieuw worden betaald." },
    { status: 409 },
  );
}

const holdExpiresAt = Date.parse(booking.hold_expires_at ?? "");

if (
  !Number.isFinite(holdExpiresAt) ||
  holdExpiresAt <= Date.now() ||
  booking.availability_slots?.status !== "held"
) {
  return NextResponse.json(
    {
      error:
        "De reservering is verlopen of niet meer beschikbaar. Maak een nieuwe reservering.",
    },
    { status: 409 },
  );
}

      title = `GowTrain ${booking.availability_slots?.sport?.toUpperCase() || "Les"}`;
      amountCents = booking.total_price_cents;
      trainerId = booking.trainer_id;
      metadata = {
        ...metadata,
        gowtrain_booking_id: booking.id,
        slot_id: booking.slot_id,
        booking_type: "single_slot",
      };
    } else {
      return NextResponse.json({ error: "Geen boeking of pakket ID opgegeven." }, { status: 400 });
    }

    // B. Embedded Checkout Session Maken (schoon en zonder 'automatic_payment_methods' fout)
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      ui_mode: "embedded",
      mode: "payment",
      payment_method_types: ["card", "ideal"],
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: amountCents,
            product_data: {
              name: title,
              description: "Inclusief training en baanhuur via GowTrain",
            },
          },
          quantity: 1,
        },
      ],
      metadata,
      return_url: packageId
        ? `${origin}/boeken/succes?session_id={CHECKOUT_SESSION_ID}&package_id=${packageId}`
        : `${origin}/boeken/succes?session_id={CHECKOUT_SESSION_ID}`,
    };

    // De betaling komt op het platform binnen.
    // Het trainersdeel wordt later per les afzonderlijk overgeboekt.
    sessionParams.payment_intent_data = {
      metadata: {
        ...metadata,
        trainer_id: trainerId,
        gowtrain_funds_flow: "separate_transfers_v1",
      },
    };

    sessionParams.metadata = {
      ...metadata,
      trainer_id: trainerId,
      gowtrain_funds_flow: "separate_transfers_v1",
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (error: any) {
    console.error("Embedded checkout session error:", error);
    return NextResponse.json(
      { error: error.message || "Fout bij aanmaken betaalsessie." },
      { status: 500 }
    );
  }
}