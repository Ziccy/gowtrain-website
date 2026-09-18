import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function disabledResponse(request: NextRequest): NextResponse {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      { error: "Trainertransfers zijn niet beschikbaar." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json(
      { error: "Niet geautoriseerd." },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      success: false,
      code: "TRAINER_TRANSFERS_DISABLED",
      message:
        "Trainertransfers zijn uitgeschakeld tijdens de migratie. Geen claim of Stripe-aanroep uitgevoerd.",
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  return disabledResponse(request);
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  return disabledResponse(request);
}