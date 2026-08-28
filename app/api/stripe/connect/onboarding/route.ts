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
const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL");

const stripe = new Stripe(stripeSecretKey);

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type TrainerStripeData = {
  id: string;
  name: string;
  country_code: string | null;
  stripe_account_id: string | null;
};

export async function POST(request: NextRequest) {
  try {
    /*
      De trainerdashboard-browser stuurt een Supabase access token mee:
      Authorization: Bearer [access token]
    */
    const authorizationHeader = request.headers.get("authorization");

    if (!authorizationHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Je bent niet ingelogd." },
        { status: 401 }
      );
    }

    const accessToken = authorizationHeader.replace("Bearer ", "");

    /*
      Valideer de ingelogde gebruiker met diens eigen access token.
    */
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

    /*
      Zoek uitsluitend het goedgekeurde en actieve trainerprofiel
      dat gekoppeld is aan deze gebruiker.
    */
    const { data: trainerData, error: trainerError } = await supabaseAdmin
      .from("trainers")
      .select("id, name, country_code, stripe_account_id")
      .eq("user_id", user.id)
      .eq("approval_status", "approved")
      .eq("is_active", true)
      .single();

    if (trainerError || !trainerData) {
      console.error(
        "Trainer ophalen voor Stripe Connect fout:",
        trainerError?.message
      );

      return NextResponse.json(
        {
          error:
            "Je trainerprofiel is niet actief of kon niet worden geladen.",
        },
        { status: 403 }
      );
    }

    const trainer = trainerData as TrainerStripeData;

    let stripeAccountId = trainer.stripe_account_id;
    let stripeAccount: Stripe.Account;

    /*
      Heeft de trainer nog geen Connect-account?
      Maak dan één Stripe Express-account aan.
    */
    if (!stripeAccountId) {
      const country =
        trainer.country_code?.trim().toUpperCase() === "BE" ? "BE" : "NL";

      stripeAccount = await stripe.accounts.create({
        type: "express",
        country,
        email: user.email ?? undefined,
        business_type: "individual",

        capabilities: {
          transfers: {
            requested: true,
          },
        },

        metadata: {
          gowtrain_trainer_id: trainer.id,
          gowtrain_trainer_name: trainer.name,
        },
      });

      stripeAccountId = stripeAccount.id;
    } else {
      /*
        Bestaat het account al? Haal dan de actuele gegevens op.
        Zo blijft jullie dashboard ook correct als een lokale webhook
        niet is aangekomen of de trainer later gegevens wijzigt.
      */
      stripeAccount = (await stripe.accounts.retrieve(
        stripeAccountId
      )) as Stripe.Account;
    }

    /*
      Synchroniseer de actuele Stripe-status met Supabase.
    */
    const onboardingComplete =
      stripeAccount.details_submitted === true &&
      stripeAccount.payouts_enabled === true;

    const { error: updateError } = await supabaseAdmin
      .from("trainers")
      .update({
        stripe_account_id: stripeAccount.id,
        stripe_details_submitted: stripeAccount.details_submitted,
        stripe_charges_enabled: stripeAccount.charges_enabled,
        stripe_payouts_enabled: stripeAccount.payouts_enabled,
        stripe_onboarding_completed_at: onboardingComplete
          ? new Date().toISOString()
          : null,
      })
      .eq("id", trainer.id);

    if (updateError) {
      console.error(
        "Stripe account-status opslaan bij trainer fout:",
        updateError.message
      );

      return NextResponse.json(
        {
          error:
            "Je uitbetalingsaccount kon niet aan je profiel worden gekoppeld. Neem contact op met GowTrain.",
        },
        { status: 500 }
      );
    }

    /*
      Maak bij elke klik een verse Stripe-hosted onboardinglink.
      Deze links verlopen snel; daarom nooit opslaan in jullie database.
    */
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${appUrl}/trainer-dashboard?stripe=refresh`,
      return_url: `${appUrl}/trainer-dashboard?stripe=return`,
      type: "account_onboarding",
    });

    return NextResponse.json({
      onboardingUrl: accountLink.url,
    });
  } catch (error) {
    console.error("Stripe Connect onboarding fout:", error);

    return NextResponse.json(
      {
        error:
          "Uitbetalingen instellen lukt nu niet. Probeer het opnieuw.",
      },
      { status: 500 }
    );
  }
}