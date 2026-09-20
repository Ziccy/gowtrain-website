import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
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

/*
 * De browser vraagt hiermee vooraf toestemming
 * om de API met een Authorization-header aan te roepen.
 */
export async function OPTIONS(
  request: NextRequest
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

/*
 * Voeg CORS-headers toe aan zowel succesvolle antwoorden
 * als foutmeldingen uit de bestaande betaalroute.
 */
async function handleCheckoutRequest(
  request: NextRequest
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

  // Native apps sturen doorgaans geen Origin-header.
  // De bestaande Bearer-tokencontrole blijft altijd vereist.
  const response = await handleCheckoutRequest(request);

  return applyCors(response, origin);
}
export const dynamic = "force-dynamic";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseServiceRoleKey = getRequiredEnv(
  "SUPABASE_SERVICE_ROLE_KEY"
);
const cronSecret = getRequiredEnv("CRON_SECRET");

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

function isAuthorizedCronRequest(
  request: NextRequest
): boolean {
  const authorizationHeader =
    request.headers.get("authorization");

  return (
    authorizationHeader === `Bearer ${cronSecret}`
  );
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        error: "Niet geautoriseerd.",
      },
      {
        status: 401,
      }
    );
  }

  try {
    /*
      De databasefunctie handelt atomair af:

      payment_pending + hold verlopen
      → booking cancelled
      → cancellation_reason payment_hold_expired
      → availability slot weer available
      → hold_expires_at op null
    */
    const {
      data: releasedCount,
      error,
    } = await supabaseAdmin.rpc(
      "release_expired_booking_holds"
    );

    if (error) {
      console.error(
        "Verlopen booking holds opruimen fout:",
        error.message
      );

      return NextResponse.json(
        {
          error:
            "Verlopen tijdelijke reserveringen konden niet worden opgeruimd.",
        },
        {
          status: 500,
        }
      );
    }

    const count =
      typeof releasedCount === "number"
        ? releasedCount
        : Number(releasedCount ?? 0);

    console.log(
      `Gowtrain hold cleanup voltooid. Vrijgegeven slots: ${count}`
    );

    return NextResponse.json(
      {
        success: true,
        releasedCount: count,
        processedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Hold cleanup cron fout:", error);

    return NextResponse.json(
      {
        error:
          "Verlopen tijdelijke reserveringen konden niet worden verwerkt.",
      },
      {
        status: 500,
      }
    );
  }
}