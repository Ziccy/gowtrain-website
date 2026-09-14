import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

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

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Authorization",
    },
  });
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse(
        { error: "Log in om je reserveringen te bekijken." },
        401
      );
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return jsonResponse(
        { error: "Je bent niet ingelogd." },
        401
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        401
      );
    }

    /*
     * De ontvanger wordt uitsluitend uit het geverifieerde
     * account bepaald. Geen user-ID uit de URL gebruiken.
     *
     * Geen Stripe-client secrets, Checkout-parameters of
     * interne foutmeldingen naar de browser teruggeven.
     */
    const { data: attempts, error } = await supabaseAdmin
      .from("checkout_attempts")
      .select(
        `
          id,
          package_id,
          status,
          checkout_mode,
          amount_cents,
          currency,
          reservation_expires_at,
          stripe_session_expires_at,
          purchase_snapshot,
          created_at
        `
      )
      .eq("player_id", user.id)
      .not("package_id", "is", null)
      .in("status", [
        "reserved",
        "creating",
        "open",
        "payment_processing",
        "review_required",
      ])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Pakketreserveringen ophalen mislukt:", {
        code: error.code,
        message: error.message,
      });

      return jsonResponse(
        {
          error:
            "Je pakketreserveringen konden tijdelijk niet worden opgehaald.",
        },
        503
      );
    }

    const now = Date.now();

    const reservations = (attempts ?? []).map((attempt) => {
      const snapshot =
        attempt.purchase_snapshot &&
        typeof attempt.purchase_snapshot === "object" &&
        !Array.isArray(attempt.purchase_snapshot)
          ? (attempt.purchase_snapshot as Record<string, unknown>)
          : {};

      const packageTitle =
        typeof snapshot.package_title === "string" &&
        snapshot.package_title.trim()
          ? snapshot.package_title.trim()
          : "Lespakket";

      const lessonCount =
        typeof snapshot.lesson_count === "number" &&
        Number.isInteger(snapshot.lesson_count)
          ? snapshot.lesson_count
          : null;

      const reservationDeadline = Date.parse(
        attempt.reservation_expires_at
      );

      const sessionDeadline = attempt.stripe_session_expires_at
        ? Date.parse(attempt.stripe_session_expires_at)
        : null;

      /*
       * Alleen aangeven of we een hervatknop mogen tonen.
       * Dit is geen Stripe-statuscontrole.
       *
       * De bestaande betaalpagina gebruikt embedded Checkout.
       * Een hosted poging niet via die andere weergave hervatten.
       */
      const canResume =
        attempt.checkout_mode === "embedded" &&
        ["reserved", "open"].includes(attempt.status) &&
        Number.isFinite(reservationDeadline) &&
        reservationDeadline > now &&
        (
          attempt.status !== "open" ||
          (
            sessionDeadline !== null &&
            Number.isFinite(sessionDeadline) &&
            sessionDeadline > now
          )
        );

      return {
        attemptId: attempt.id,
        packageId: attempt.package_id,
        packageTitle,
        lessonCount,
        status: attempt.status,
        checkoutMode: attempt.checkout_mode,
        totalPriceCents: attempt.amount_cents,
        currency: attempt.currency,
        reservationExpiresAt: attempt.reservation_expires_at,
        stripeSessionExpiresAt: attempt.stripe_session_expires_at,
        createdAt: attempt.created_at,
        canResume,
        resumeUrl:
          canResume && attempt.package_id
            ? `/boeken/checkout?packageId=${encodeURIComponent(
                attempt.package_id
              )}`
            : null,
      };
    });

    return jsonResponse({
      reservations,
      checkedAt: new Date(now).toISOString(),
    });
  } catch (error: unknown) {
    console.error("Pakketreserveringen controleren mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return jsonResponse(
      { error: "Je pakketreserveringen konden niet worden geladen." },
      500
    );
  }
}