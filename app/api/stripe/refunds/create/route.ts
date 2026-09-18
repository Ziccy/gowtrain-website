import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      code: "LEGACY_REFUND_ROUTE_DISABLED",
      error:
        "Deze oude refundroute is afgesloten. Annuleringen en adminbesluiten worden uitsluitend via de nieuwe refundadministratie verwerkt. Er is geen Stripe-aanroep uitgevoerd.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}