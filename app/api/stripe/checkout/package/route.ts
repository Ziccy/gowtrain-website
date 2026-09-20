import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createOrResumePackageCheckout,
  PackageCheckoutError,
} from "@/lib/stripe-package-checkout";

export const runtime = "nodejs";

const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
  "https://gowtrain.com",
  "http://localhost:8081",
]);

function applyCors(
  response: NextResponse,
  origin: string | null
): NextResponse {
  response.headers.append("Vary", "Origin");
  response.headers.set("Cache-Control", "no-store");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS"
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type"
    );
  }

  return response;
}

export async function OPTIONS(
  request: Request
): Promise<NextResponse> {
  const origin = request.headers.get("origin");

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return applyCors(
      NextResponse.json(
        { error: "Deze web-origin is niet toegestaan." },
        { status: 403 }
      ),
      null
    );
  }

  return applyCors(
    new NextResponse(null, { status: 204 }),
    origin
  );
}

export async function POST(
  request: Request
): Promise<NextResponse> {
  const origin = request.headers.get("origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return applyCors(
      NextResponse.json(
        { error: "Deze web-origin is niet toegestaan." },
        { status: 403 }
      ),
      null
    );
  }

  const response = await handlePackageCheckout(request);
  return applyCors(response, origin);
}

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
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

async function handlePackageCheckout(
  request: Request
): Promise<NextResponse> {
  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const accessToken = authorization.slice(7).trim();

    if (!accessToken) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (userError || !user) {
      return json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        401
      );
    }

    if (!user.email || !user.email_confirmed_at) {
      return json(
        { error: "Bevestig eerst je e-mailadres." },
        403
      );
    }

    // Ook op de server controleren dat de koper een speler is.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Spelerprofiel controleren mislukt:", {
        code: profileError.code,
        message: profileError.message,
      });

      return json(
        { error: "Je profiel kon tijdelijk niet worden gecontroleerd." },
        503
      );
    }

    if (!profile || profile.role !== "player") {
      return json(
        { error: "Je hebt een speleraccount nodig om een pakket te boeken." },
        403
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Ongeldige aanvraag." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Ongeldige aanvraag." }, 400);
    }

    const packageIdValue = (
      body as Record<string, unknown>
    ).packageId;

    const packageId =
      typeof packageIdValue === "string"
        ? packageIdValue.trim().toLowerCase()
        : "";

    if (!isUuid(packageId)) {
      return json(
        { error: "Een geldig lespakket-ID is verplicht." },
        400
      );
    }

    /*
     * Bestaande helper behouden:
     * - reserveert het pakket;
     * - gebruikt de vastgelegde databaseprijs;
     * - hergebruikt een bestaande betaalpoging;
     * - gebruikt de geverifieerde gebruiker als koper.
     */
    const checkout = await createOrResumePackageCheckout({
      packageId,
      playerId: user.id,
      playerEmail: user.email,
      mode: "hosted",
    });

    if (!checkout.checkoutUrl) {
      throw new Error("De Checkout-URL ontbreekt.");
    }

    return json({
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (error: unknown) {
    if (error instanceof PackageCheckoutError) {
      return json(
        { error: error.message },
        error.status
      );
    }

    console.error("Pakket-Checkout aanmaken mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return json(
      {
        error:
          "De betaalpagina kon niet worden geopend. Probeer het later opnieuw. Een bestaande betaalpoging blijft gereserveerd totdat de status is gecontroleerd.",
      },
      503
    );
  }
}