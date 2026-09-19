import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { inspectSandboxPackageTransferSource } from "@/lib/inspect-sandbox-package-transfer-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/*
 * Expliciet afgebakende broninspectie van de nieuwe v2-testaankoop.
 * Dit geeft geen toestemming voor transferuitvoering.
 */
const TEST_PURCHASE_ID = "4e54c469-299a-4fa6-a61f-3f8a61bc2f57";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const supabaseAdmin = createClient(
  supabaseUrl,
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function isCurrentAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("ADMIN_ROLE_CHECK_FAILED");
  }

  return data?.role === "admin";
}

function diagnosticCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    if (error.type === "StripeConnectionError") {
      return "STRIPE_CONNECTION_ERROR";
    }

    if (error.type === "StripeAuthenticationError") {
      return "STRIPE_AUTHENTICATION_ERROR";
    }

    if (error.type === "StripePermissionError") {
      return "STRIPE_PERMISSION_ERROR";
    }

    if (error.code === "resource_missing") {
      return "STRIPE_RESOURCE_MISSING";
    }

    return "STRIPE_REQUEST_ERROR";
  }

  const message = error instanceof Error ? error.message : "";

  if (
    /^TRANSFER_SOURCE_[A-Z0-9_]+$/.test(message) &&
    message.length <= 150
  ) {
    return message;
  }

  return "SOURCE_INSPECTION_NOT_CONFIRMED";
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  let userId: string | null = null;

  try {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!token) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser(token);

    if (authError || !user) {
      return json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        401,
      );
    }

    userId = user.id;

    if (!(await isCurrentAdmin(user.id))) {
      return json({ error: "Alleen admins hebben toegang." }, 403);
    }
  } catch {
    return json(
      { error: "De toegang kon niet worden gecontroleerd." },
      503,
    );
  }

  // Zonder bewezen adminautorisatie nooit de bronhelper aanroepen.
  if (!userId) {
    return json({ error: "Geen toegang." }, 403);
  }

  let responseBody: Record<string, unknown>;
  let responseStatus: number;

  try {
    /*
     * Geen input voor purchaseId accepteren.
     * De helper leest Supabase en Stripe, maar schrijft niets.
     */
    const source = await inspectSandboxPackageTransferSource(
      TEST_PURCHASE_ID,
    );

    responseBody = {
      inspectionConfirmed: true,
      transferAuthorized: false,
      environment: "test",
      source,
      message:
        "De afgebakende broncontrole is geslaagd. Bestemming, eerdere separate transfers en beschikbaar trainersdeel zijn hiermee niet goedgekeurd.",
    };

    responseStatus = 200;
  } catch (error: unknown) {
    const code = diagnosticCode(error);
    const stripeError =
      error instanceof Stripe.errors.StripeError ? error : null;

    console.error("Admin-pakketbroninspectie niet bevestigd:", {
      purchaseId: TEST_PURCHASE_ID,
      diagnosticCode: code,
      stripeRequestId: stripeError?.requestId,
      stripeStatusCode: stripeError?.statusCode,
    });

    const requiresReview =
      code === "TRANSFER_SOURCE_REFUND_REQUIRES_REVIEW" ||
      code === "TRANSFER_SOURCE_DISPUTE_REQUIRES_REVIEW";

    responseBody = {
      inspectionConfirmed: false,
      transferAuthorized: false,
      diagnosticCode: code,
      error: requiresReview
        ? "Deze betaalbron bevat een refund- of disputeregistratie en valt buiten de eerste ondersteunde transferflow."
        : "De broncontrole kon niet volledig worden bevestigd. Er is geen transfer geregistreerd of uitgevoerd.",
    };

    responseStatus = requiresReview ? 409 : 503;
  }

  /*
   * Controleer de adminrol opnieuw vóór we financiële
   * inspectiegegevens of diagnostiek teruggeven.
   */
  try {
    if (!(await isCurrentAdmin(userId))) {
      return json({ error: "De adminrechten zijn niet meer actief." }, 403);
    }
  } catch {
    return json(
      { error: "De actuele toegang kon niet worden bevestigd." },
      503,
    );
  }

  return json(responseBody, responseStatus);
}