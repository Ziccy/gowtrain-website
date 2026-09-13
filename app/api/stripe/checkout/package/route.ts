import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createOrResumePackageCheckout,
  PackageCheckoutError,
} from "@/lib/stripe-package-checkout";

export const runtime = "nodejs";

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

export async function POST(
  request: Request
): Promise<NextResponse> {
  const headers = {
    "Cache-Control": "no-store",
  };

  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Je bent niet ingelogd." },
        { status: 401, headers }
      );
    }

    const accessToken = authorization.slice(7).trim();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Je bent niet ingelogd." },
        { status: 401, headers }
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        { status: 401, headers }
      );
    }

    if (!user.email || !user.email_confirmed_at) {
      return NextResponse.json(
        { error: "Bevestig eerst je e-mailadres." },
        { status: 403, headers }
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Ongeldige aanvraag." },
        { status: 400, headers }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Ongeldige aanvraag." },
        { status: 400, headers }
      );
    }

    const packageIdValue = (
      body as Record<string, unknown>
    ).packageId;

    const packageId =
      typeof packageIdValue === "string"
        ? packageIdValue.trim().toLowerCase()
        : "";

    if (!isUuid(packageId)) {
      return NextResponse.json(
        { error: "Een geldig lespakket-ID is verplicht." },
        { status: 400, headers }
      );
    }

    /*
     * De helper reserveert het pakket en gebruikt uitsluitend
     * de vastgelegde prijsgegevens uit de database.
     *
     * De koper komt uit de geverifieerde sessie,
     * niet uit de requestbody.
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

    return NextResponse.json(
      {
        checkoutUrl: checkout.checkoutUrl,
      },
      { headers }
    );
  } catch (error: unknown) {
    if (error instanceof PackageCheckoutError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers }
      );
    }

    console.error("Pakket-Checkout aanmaken mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return NextResponse.json(
      {
        error:
          "De betaalpagina kon niet worden geopend. Probeer het later opnieuw. Een bestaande betaalpoging blijft gereserveerd totdat de status is gecontroleerd.",
      },
      { status: 503, headers }
    );
  }
}