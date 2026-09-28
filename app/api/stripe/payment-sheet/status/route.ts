import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { syncSingleLessonPayment } from "@/lib/sync-single-lesson-payment";
import { closeExpiredSingleLessonPayment } from "@/lib/close-expired-single-lesson-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class InvalidBodyError extends Error {}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("PAYMENT_STATUS_CONFIGURATION_MISSING");
  }

  return value;
}

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Authorization, Origin",
    },
  });
}

async function readBookingId(
  request: NextRequest
): Promise<string> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json" || !request.body) {
    throw new InvalidBodyError();
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  let size = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > 1024) {
        await reader.cancel();
        throw new InvalidBodyError();
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
  } catch {
    throw new InvalidBodyError();
  } finally {
    reader.releaseLock();
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    throw new InvalidBodyError();
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new InvalidBodyError();
  }

  const input = body as Record<string, unknown>;

  if (
    Object.keys(input).length !== 1 ||
    typeof input.bookingId !== "string" ||
    !UUID_PATTERN.test(input.bookingId)
  ) {
    throw new InvalidBodyError();
  }

  return input.bookingId.toLowerCase();
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  if (
    process.env.SINGLE_LESSON_PAYMENTSHEET_ENABLED !== "true"
  ) {
    return json(
      {
        code: "PAYMENTSHEET_DISABLED",
        error: "Native betaalcontrole is nog niet beschikbaar.",
      },
      503
    );
  }

  if (request.headers.has("origin")) {
    return json(
      {
        code: "NATIVE_PAYMENT_ROUTE_ONLY",
        error: "Deze ingang is bedoeld voor de native app.",
      },
      403
    );
  }

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!token) {
    return json(
      {
        code: "AUTH_REQUIRED",
        error: "Log in om je betaling te controleren.",
      },
      401
    );
  }

  try {
    const bookingId = await readBookingId(request);

    const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

    if (
      !stripeKey.startsWith("sk_test_") &&
      !stripeKey.startsWith("rk_test_")
    ) {
      throw new Error("PAYMENT_STATUS_TEST_MODE_REQUIRED");
    }

    const admin = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      return json(
        {
          code: "AUTH_REQUIRED",
          error: "Je sessie kon niet worden bevestigd.",
        },
        401
      );
    }

    /*
     * Eigenaarscontrole vóór iedere Stripe- of afsluitactie.
     * Een gewijzigd e-mailadres blokkeert statuscontrole niet:
     * de geverifieerde account-ID is hier beslissend.
     */
    const { data: attempt, error: attemptError } = await admin
      .from("single_lesson_payment_attempts")
      .select(`
        id,
        booking_id,
        player_id,
        channel,
        status,
        stripe_livemode,
        funds_flow,
        stripe_payment_intent_id,
        reservation_expires_at
      `)
      .eq("booking_id", bookingId)
      .eq("player_id", user.id)
      .maybeSingle();

    if (attemptError) {
      throw new Error("PAYMENT_STATUS_LOOKUP_FAILED");
    }

    if (!attempt) {
      return json(
        {
          code: "PAYMENT_ATTEMPT_NOT_AVAILABLE",
          error: "Geen eigen native betaalpoging gevonden.",
        },
        404
      );
    }

    if (
      attempt.channel !== "paymentsheet" ||
      attempt.stripe_livemode !== false ||
      attempt.funds_flow !== "separate_transfers_v1"
    ) {
      throw new Error("PAYMENT_STATUS_CONTEXT_MISMATCH");
    }

    const expiresAt = Date.parse(attempt.reservation_expires_at);

    if (!Number.isFinite(expiresAt)) {
      throw new Error("PAYMENT_STATUS_EXPIRY_INVALID");
    }

    let reviewRequired = attempt.status === "needs_review";

    if (
      attempt.status !== "succeeded" &&
      attempt.status !== "needs_review"
    ) {
      if (expiresAt <= Date.now()) {
        /*
         * Kan een inactieve, verlopen PaymentIntent annuleren.
         * Vrijgave gebeurt uitsluitend na bevestigde annulering.
         * Een geslaagde betaling wordt juist gesynchroniseerd.
         */
        const closed = await closeExpiredSingleLessonPayment(
          attempt.id
        );

        if (
          closed.attemptId !== attempt.id ||
          closed.bookingId !== bookingId
        ) {
          throw new Error("PAYMENT_STATUS_CLOSE_CONTEXT_MISMATCH");
        }

        reviewRequired = closed.outcome === "requires_review";
      } else if (attempt.stripe_payment_intent_id) {
        const synced = await syncSingleLessonPayment(
          attempt.stripe_payment_intent_id
        );

        if (
          !synced.handled ||
          synced.attemptId !== attempt.id ||
          synced.bookingId !== bookingId
        ) {
          throw new Error("PAYMENT_STATUS_SYNC_NOT_CONFIRMED");
        }

        reviewRequired = synced.outcome === "needs_review";
      }
    }

    /*
     * Na synchronisatie opnieuw lezen.
     * Dit is een momentopname, geen toestemming om een
     * nieuwe betaling te starten of een slot vrij te geven.
     */
    const { data: current, error: currentError } = await admin
      .from("single_lesson_payment_attempts")
      .select(`
        id,
        status,
        payment_verified_at,
        booking_confirmed_at,
        cancellation_verified_at
      `)
      .eq("id", attempt.id)
      .eq("player_id", user.id)
      .maybeSingle();

    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("id, status, paid_at")
      .eq("id", bookingId)
      .eq("player_id", user.id)
      .maybeSingle();

    if (
      currentError ||
      bookingError ||
      !current ||
      !booking
    ) {
      throw new Error("PAYMENT_STATUS_FINAL_READ_FAILED");
    }

    return json({
      bookingId,
      attemptStatus: current.status,
      bookingStatus: booking.status,
      paymentRecorded: current.payment_verified_at !== null,
      bookingConfirmed:
        current.booking_confirmed_at !== null &&
        booking.status === "confirmed" &&
        booking.paid_at !== null,
      paymentClosed:
        current.status === "cancelled" &&
        current.cancellation_verified_at !== null,
      reviewRequired:
        reviewRequired || current.status === "needs_review",
      checkedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return json(
        {
          code: "INVALID_PAYMENT_REQUEST",
          error: "Geef alleen een geldig boekingsnummer op.",
        },
        400
      );
    }

    /*
     * Een eerdere synchronisatie of afsluiting kan al
     * gecommit zijn terwijl het antwoord verloren ging.
     */
    return json(
      {
        code: "PAYMENT_STATUS_NOT_CONFIRMED",
        error:
          "De betaalstatus kon niet volledig worden bevestigd. Dit betekent niet dat de betaling is mislukt. Controleer later opnieuw; start geen nieuwe betaling.",
      },
      503
    );
  }
}