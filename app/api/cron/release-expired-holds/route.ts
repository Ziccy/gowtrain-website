import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
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