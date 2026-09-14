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

type PackageAttempt = {
  id: string;
  package_id: string;
  player_id: string;
  trainer_id: string;
  checkout_mode: string;
  status: string;
  amount_cents: number;
  currency: string;
  stripe_livemode: boolean;
  funds_flow: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  reservation_expires_at: string;
};

type CleanupResult = {
  attemptId: string;
  outcome: "released" | "skipped" | "error";
  reason: string;
};

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

async function inspectAndRelease(
  attempt: PackageAttempt
): Promise<CleanupResult> {
  try {
    /*
     * Controleer Stripe opnieuw bij iedere uitvoering.
     * We gebruiken niet de uitkomst van een eerdere inspectie.
     */
    const session = await stripe.checkout.sessions.retrieve(
      attempt.stripe_checkout_session_id
    );

    const expectedUiMode =
      attempt.checkout_mode === "embedded"
        ? "embedded_page"
        : attempt.checkout_mode === "hosted"
          ? "hosted"
          : null;

    const matches =
      expectedUiMode !== null &&
      session.mode === "payment" &&
      String(session.ui_mode) === expectedUiMode &&
      session.id === attempt.stripe_checkout_session_id &&
      session.livemode === attempt.stripe_livemode &&
      session.client_reference_id === attempt.id &&
      session.metadata?.gowtrain_checkout_attempt_id === attempt.id &&
      session.metadata?.package_id === attempt.package_id &&
      session.metadata?.player_id === attempt.player_id &&
      session.metadata?.trainer_id === attempt.trainer_id &&
      session.metadata?.booking_type === "package" &&
      session.metadata?.gowtrain_funds_flow ===
        "separate_transfers_v1" &&
      attempt.funds_flow === "separate_transfers_v1" &&
      session.amount_total === attempt.amount_cents &&
      session.currency === attempt.currency;

    if (!matches) {
      console.warn("Pakketvrijgave geblokkeerd: Stripe-data wijkt af.", {
        attemptId: attempt.id,
      });

      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason: "Stripe-gegevens wijken af. Handmatige controle nodig.",
      };
    }

    /*
     * Alleen de geteste, eenvoudige situatie automatisch afsluiten.
     *
     * Een aanwezige Payment Intent wordt NIET automatisch
     * geïnterpreteerd als onbetaald of veilig annuleerbaar.
     */
    if (session.payment_status === "paid") {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "Stripe meldt betaald. Betaalbevestiging controleren; niet vrijgegeven.",
      };
    }

    if (session.status !== "expired") {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "Stripe Checkout is nog niet verlopen. Niet vrijgegeven.",
      };
    }

    if (session.payment_status !== "unpaid") {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "Onverwachte betaalstatus. Niet vrijgegeven.",
      };
    }

    if (
      session.payment_intent != null ||
      attempt.stripe_payment_intent_id != null ||
      attempt.paid_at != null
    ) {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "Er bestaat een Payment Intent of betaalregistratie. Eerst nader controleren.",
      };
    }

    /*
     * Stripe heeft bevestigd:
     * - Checkout is verlopen;
     * - betaling is unpaid;
     * - er is geen Payment Intent.
     *
     * De databasefunctie vergrendelt vervolgens pakket en poging,
     * en controleert opnieuw of vrijgave nog is toegestaan.
     */
    const { data: closed, error: closeError } =
      await supabaseAdmin.rpc(
        "close_expired_package_checkout",
        {
          p_attempt_id: attempt.id,
          p_checkout_session_id: session.id,
        }
      );

    if (closeError) {
      console.error("Pakketbetaalpoging afsluiten mislukt:", {
        attemptId: attempt.id,
        code: closeError.code,
        message: closeError.message,
      });

      return {
        attemptId: attempt.id,
        outcome: "error",
        reason:
          "Databaseafsluiting kon niet worden bevestigd. Later opnieuw controleren.",
      };
    }

    if (closed !== true) {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "De database staat vrijgave niet toe. Mogelijk is de poging ondertussen gewijzigd.",
      };
    }

    console.log("Verlopen pakketbetaalpoging afgesloten:", {
      attemptId: attempt.id,
      checkoutSessionId: session.id,
    });

    return {
      attemptId: attempt.id,
      outcome: "released",
      reason: "Verlopen, onbetaalde pakketbetaalpoging afgesloten.",
    };
  } catch (error: unknown) {
    console.error("Stripe-controle voor pakketvrijgave mislukt:", {
      attemptId: attempt.id,
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return {
      attemptId: attempt.id,
      outcome: "error",
      reason:
        "Controle niet afgerond. Geen vrijgave op basis van deze fout.",
    };
  }
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
     * Eerste versie:
     * alleen open pakketpogingen met een opgeslagen Session-ID.
     *
     * Reserved, creating, payment_processing en review_required
     * krijgen later afzonderlijke afhandeling.
     */
    const { data, error } = await supabaseAdmin
      .from("checkout_attempts")
      .select(
        `
          id,
          package_id,
          player_id,
          trainer_id,
          checkout_mode,
          status,
          amount_cents,
          currency,
          stripe_livemode,
          funds_flow,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          paid_at,
          reservation_expires_at
        `
      )
      .not("package_id", "is", null)
      .not("stripe_checkout_session_id", "is", null)
      .eq("status", "open")
      .eq("stripe_livemode", getStripeLivemode())
      .eq("funds_flow", "separate_transfers_v1")
      .lte(
  "reservation_expires_at",
  new Date().toISOString()
)
.lte(
  "next_cleanup_check_at",
  new Date().toISOString()
)
.order("next_cleanup_check_at", { ascending: true })
.order("reservation_expires_at", { ascending: true })
.limit(5);

    if (error) {
      console.error("Verlopen pakketpogingen ophalen mislukt:", {
        code: error.code,
        message: error.message,
      });

      return json(
        { error: "Pakketbetaalpogingen konden niet worden opgehaald." },
        503
      );
    }

    const attempts = (data ?? []) as PackageAttempt[];

    const results: CleanupResult[] = await Promise.all(
  attempts.map(async (attempt): Promise<CleanupResult> => {
    const checkedAt = new Date();
    const nextCheckAt = new Date(
      checkedAt.getTime() + 10 * 60 * 1000
    );

    /*
     * Verschuif het controlemoment voordat Stripe wordt aangeroepen.
     *
     * De voorwaarde voorkomt dat een andere gelijktijdige
     * uitvoering dezelfde planning direct opnieuw overneemt.
     *
     * Bij een uitgevallen uitvoering komt de poging na
     * tien minuten opnieuw beschikbaar voor controle.
     */
    const {
      data: scheduledAttempt,
      error: scheduleError,
    } = await supabaseAdmin
      .from("checkout_attempts")
      .update({
        next_cleanup_check_at: nextCheckAt.toISOString(),
        updated_at: checkedAt.toISOString(),
      })
      .eq("id", attempt.id)
      .eq("status", "open")
      .eq(
        "stripe_checkout_session_id",
        attempt.stripe_checkout_session_id
      )
      .lte(
        "next_cleanup_check_at",
        checkedAt.toISOString()
      )
      .select("id")
      .maybeSingle();

    if (scheduleError) {
      console.error("Volgende pakketcontrole plannen mislukt:", {
        attemptId: attempt.id,
        code: scheduleError.code,
        message: scheduleError.message,
      });

      return {
        attemptId: attempt.id,
        outcome: "error",
        reason:
          "De volgende controle kon niet worden gepland. Geen vrijgave uitgevoerd.",
      };
    }

    if (!scheduledAttempt) {
      return {
        attemptId: attempt.id,
        outcome: "skipped",
        reason:
          "De poging is gewijzigd of een andere uitvoering heeft de controle al ingepland.",
      };
    }

    return await inspectAndRelease(attempt);
  })
);

    const released = results.filter(
      (result) => result.outcome === "released"
    ).length;

    const skipped = results.filter(
      (result) => result.outcome === "skipped"
    ).length;

    const errors = results.filter(
      (result) => result.outcome === "error"
    ).length;

    return json(
      {
        success: errors === 0,
        checked: attempts.length,
        released,
        skipped,
        errors,
        results,
      },
      errors > 0 ? 503 : 200
    );
  } catch (error: unknown) {
    console.error("Pakketopruiming mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return json(
      { error: "De pakketopruiming kon niet worden afgerond." },
      500
    );
  }
}