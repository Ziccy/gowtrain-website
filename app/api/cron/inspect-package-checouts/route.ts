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

function stripeLivemode(): boolean {
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

export async function GET(
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
     * Alleen bekijken:
     * - pakketpogingen;
     * - dezelfde Stripe-omgeving;
     * - verstreken controlemoment;
     * - nog niet definitief afgesloten.
     *
     * Kleine batch om deze diagnose kort te houden.
     */
    const { data: attempts, error } = await supabaseAdmin
      .from("checkout_attempts")
      .select(
        `
          id,
          package_id,
          player_id,
          status,
          amount_cents,
          currency,
          stripe_livemode,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          first_stripe_request_at,
          checkout_parameters,
          reservation_expires_at
        `
      )
      .not("package_id", "is", null)
      .eq("stripe_livemode", stripeLivemode())
      .in("status", [
        "reserved",
        "creating",
        "open",
        "payment_processing",
        "review_required",
      ])
      .lte("reservation_expires_at", new Date().toISOString())
      .order("reservation_expires_at", { ascending: true })
      .limit(5);

    if (error) {
      console.error("Betaalpogingen ophalen mislukt:", {
        code: error.code,
        message: error.message,
      });

      return json(
        { error: "Betaalpogingen konden niet worden opgehaald." },
        503
      );
    }

    const results = await Promise.all(
      (attempts ?? []).map(async (attempt) => {
        const base = {
          attemptId: attempt.id,
          databaseStatus: attempt.status,
          reservationExpiresAt: attempt.reservation_expires_at,
        };

        /*
         * Geen Session-ID is niet hetzelfde als:
         * 'er bestaat geen Stripe Session'.
         */
        if (!attempt.stripe_checkout_session_id) {
          const neverStarted =
            attempt.status === "reserved" &&
            attempt.first_stripe_request_at === null &&
            attempt.checkout_parameters === null &&
            attempt.stripe_payment_intent_id === null;

          return {
            ...base,
            finding: neverStarted
              ? "RESERVED_WITHOUT_STRIPE_REQUEST"
              : "STRIPE_RESULT_UNKNOWN",
            nextStep: neverStarted
              ? "Later onder databasevergrendeling opnieuw controleren en afsluiten."
              : "Stripe-resultaat herstellen of handmatig onderzoeken. Niet vrijgeven.",
          };
        }

        try {
          const session = await stripe.checkout.sessions.retrieve(
            attempt.stripe_checkout_session_id,
            {
              expand: ["payment_intent"],
            }
          );

          const paymentIntent =
            session.payment_intent &&
            typeof session.payment_intent !== "string"
              ? session.payment_intent
              : null;

          const returnedPaymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : paymentIntent?.id ?? null;

          const matches =
            session.mode === "payment" &&
            session.livemode === attempt.stripe_livemode &&
            session.client_reference_id === attempt.id &&
            session.metadata?.gowtrain_checkout_attempt_id ===
              attempt.id &&
            session.metadata?.package_id === attempt.package_id &&
            session.metadata?.player_id === attempt.player_id &&
            session.amount_total === attempt.amount_cents &&
            session.currency === attempt.currency &&
            (
              attempt.stripe_payment_intent_id === null ||
              attempt.stripe_payment_intent_id ===
                returnedPaymentIntentId
            );

          if (!matches) {
            return {
              ...base,
              finding: "STRIPE_DATA_MISMATCH",
              nextStep: "Handmatige controle nodig. Niet vrijgeven.",
            };
          }

          const stripeState = {
            checkoutStatus: session.status,
            paymentStatus: session.payment_status,
            paymentIntentStatus: paymentIntent?.status ?? null,
          };

          if (
            session.payment_status === "paid" ||
            paymentIntent?.status === "succeeded"
          ) {
            return {
              ...base,
              ...stripeState,
              finding: "PAYMENT_SUCCEEDED",
              nextStep:
                "Betaalbevestiging verwerken of onderzoeken. Niet vrijgeven.",
            };
          }

          if (
            session.status === "complete" ||
            paymentIntent?.status === "processing" ||
            paymentIntent?.status === "requires_capture"
          ) {
            return {
              ...base,
              ...stripeState,
              finding: "PAYMENT_NEEDS_RECONCILIATION",
              nextStep:
                "Definitieve betaaluitkomst controleren. Niet vrijgeven.",
            };
          }

          if (session.status === "open") {
            return {
              ...base,
              ...stripeState,
              finding: "CHECKOUT_STILL_OPEN",
              nextStep:
                "Checkout later gecontroleerd laten verlopen en opnieuw controleren.",
            };
          }

          if (session.status === "expired") {
            return {
              ...base,
              ...stripeState,
              finding: "CHECKOUT_EXPIRED",
              nextStep:
                "Eventuele Payment Intent en databaseclaims controleren vóór vrijgave.",
            };
          }

          return {
            ...base,
            ...stripeState,
            finding: "UNEXPECTED_STRIPE_STATE",
            nextStep: "Handmatige controle nodig. Niet vrijgeven.",
          };
        } catch (stripeError: unknown) {
          console.error("Stripe-controle mislukt:", {
            attemptId: attempt.id,
            message:
              stripeError instanceof Error
                ? stripeError.message
                : "Onbekende fout.",
          });

          return {
            ...base,
            finding: "STRIPE_CHECK_FAILED",
            nextStep: "Later opnieuw controleren. Niet vrijgeven.",
          };
        }
      })
    );

    return json({
      success: true,
      readOnly: true,
      checked: results.length,
      results,
    });
  } catch (error: unknown) {
    console.error("Inspectie van pakketbetalingen mislukt:", {
      message:
        error instanceof Error ? error.message : "Onbekende fout.",
    });

    return json(
      { error: "De controle kon niet worden uitgevoerd." },
      500
    );
  }
}