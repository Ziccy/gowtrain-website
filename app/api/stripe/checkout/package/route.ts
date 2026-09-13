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
    const { packageId } = body;

    if (!packageId) {
      return NextResponse.json({ error: "Geen lespakket ID opgegeven." }, { status: 400 });
    }

    // 1. Lespakket ophalen
    const { data: pkg, error: pkgError } = await supabaseAdmin
      .from("trainer_packages")
      .select("*, trainer:trainers(*), venue:venues(*)")
      .eq("id", packageId)
      .eq("is_active", true)
      .single();

    if (pkgError || !pkg) {
      return NextResponse.json({ error: "Lespakket niet gevonden of niet meer actief." }, { status: 404 });
    }

    const origin = req.headers.get("origin") || "http://localhost:3000";

    // 2. Stripe Checkout Session opbouwen
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card", "ideal"],
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: pkg.price_cents,
            product_data: {
              name: pkg.title,
              description: `${pkg.lesson_count} lessen traject bij ${pkg.trainer?.name || "de trainer"}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        package_id: pkg.id,
        player_id: user.id,
        trainer_id: pkg.trainer_id,
        booking_type: "package",
      },
      success_url: `${origin}/boeken/succes?session_id={CHECKOUT_SESSION_ID}&package_id=${packageId}`,
      cancel_url: `${origin}/boeken/pakket/${packageId}?canceled=true`,
    };


    // De betaling komt op het platform binnen.
    // Het trainersdeel wordt later per les afzonderlijk overgeboekt.
    sessionParams.payment_intent_data = {
      metadata: {
        package_id: pkg.id,
        player_id: user.id,
        trainer_id: pkg.trainer_id,
        booking_type: "package",
        gowtrain_funds_flow: "separate_transfers_v1",
      },
    };

    sessionParams.metadata = {
      ...sessionParams.metadata,
      gowtrain_funds_flow: "separate_transfers_v1",
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ checkoutUrl: session.url });
  } catch (error: any) {
    console.error("Stripe Package Checkout error:", error);
    return NextResponse.json(
      { error: error.message || "Interne fout bij aanmaken betaling." },
      { status: 500 }
    );
  }
}