import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function isAuthorizedCronRequest(request: NextRequest): boolean {
  /*
    Vercel Cron stuurt:
    Authorization: Bearer [CRON_SECRET]

    Voor lokaal testen gebruik je dezelfde header.
  */
  const authorizationHeader = request.headers.get("authorization");

  return authorizationHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { error: "Niet geautoriseerd." },
      { status: 401 }
    );
  }

  try {
    /*
      Deze functie doet atomair:
      payment_pending + hold verlopen
      → booking cancelled
      → cancellation_reason payment_hold_expired
      → slot available
      → hold_expires_at null
    */
    const { data: releasedCount, error } = await supabaseAdmin.rpc(
      "release_expired_booking_holds"
    );

    if (error) {
      console.error("Verlopen booking holds opruimen fout:", error.message);

      return NextResponse.json(
        {
          error:
            "Verlopen tijdelijke reserveringen konden niet worden opgeruimd.",
        },
        { status: 500 }
      );
    }

    console.log(
      `Gowtrain hold cleanup voltooid. Vrijgegeven slots: ${releasedCount ?? 0}`
    );

    return NextResponse.json({
      success: true,
      releasedCount: releasedCount ?? 0,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Hold cleanup cron fout:", error);

    return NextResponse.json(
      {
        error:
          "Verlopen tijdelijke reserveringen konden niet worden verwerkt.",
      },
      { status: 500 }
    );
  }
}