import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
  "https://gowtrain.com",
]);

if (process.env.NODE_ENV === "development") {
  ALLOWED_ORIGINS.add("http://localhost:3000");
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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("CONFIGURATION_MISSING");
  }

  return value;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  const origin = request.headers.get("origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Deze oorsprong is niet toegestaan." }, 403);
  }

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!token) {
    return json({ error: "Log in met je beheeraccount." }, 401);
  }

  const pageText = request.nextUrl.searchParams.get("page") ?? "1";
  const filter = request.nextUrl.searchParams.get("filter") ?? "review";

  if (
    !/^[1-9]\d*$/.test(pageText) ||
    !["review", "unfinished"].includes(filter)
  ) {
    return json({ error: "Ongeldige overzichtsaanvraag." }, 400);
  }

  const page = Number(pageText);

  if (!Number.isSafeInteger(page) || page > 100_000) {
    return json({ error: "Ongeldig paginanummer." }, 400);
  }

  try {
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
        { error: "Je sessie kon niet worden bevestigd." },
        401
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error("ADMIN_CHECK_FAILED");
    }

    if (profile?.role !== "admin") {
      return json({ error: "Je hebt geen beheerrechten." }, 403);
    }

    /*
     * Geen e-mailadres, Stripe-parameters, client secret,
     * idempotency-key of providerreferenties ophalen.
     */
    let query = admin
      .from("single_lesson_payment_attempts")
      .select(`
        id,
        booking_id,
        channel,
        status,
        amount_cents,
        currency,
        stripe_livemode,
        reservation_expires_at,
        first_stripe_request_at,
        payment_verified_at,
        booking_confirmed_at,
        cancellation_verified_at,
        review_code,
        created_at,
        updated_at
      `);

    if (filter === "review") {
      query = query.eq("status", "needs_review");
    } else {
      query = query.in("status", [
        "reserved",
        "creating",
        "open",
        "processing",
        "needs_review",
      ]);
    }

    const from = (page - 1) * PAGE_SIZE;

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE);

    if (error) {
      throw new Error("PAYMENT_OVERVIEW_FAILED");
    }

    const rows = data ?? [];

    return json({
      items: rows.slice(0, PAGE_SIZE),
      hasMore: rows.length > PAGE_SIZE,
      page,
      filter,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return json(
      {
        error:
          "Het betaaloverzicht kon niet worden geladen. Er zijn geen betaalacties uitgevoerd.",
      },
      503
    );
  }
}