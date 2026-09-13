import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const bookingSelection = `
  id,
  status,
  participant_count,
  total_price_cents,
  currency,
  paid_at,
  trainers (
    id,
    name
  ),
  availability_slots (
    starts_at,
    ends_at,
    sport,
    venues (
      name,
      city,
      address_line,
      postal_code
    )
  )
`;

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

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const authorization =
      request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return json({ error: "Log in om je boeking te bekijken." }, 401);
    }

    const token = authorization.slice(7).trim();

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        401
      );
    }

    const sessionId = request.nextUrl.searchParams.get("session_id");

    if (
      !sessionId ||
      !sessionId.startsWith("cs_") ||
      sessionId.length > 255
    ) {
      return json(
        { error: "Een geldig Checkout Session-ID ontbreekt." },
        400
      );
    }

    /*
     * 1. Zoek een definitieve pakketaankoop.
     *
     * Filter altijd op de ingelogde koper.
     * Een Session-ID uit de URL verleent geen toegang.
     */
    const {
      data: purchase,
      error: purchaseError,
    } = await supabaseAdmin
      .from("package_purchases")
      .select("id, lesson_count, paid_at")
      .eq("stripe_checkout_session_id", sessionId)
      .eq("player_id", user.id)
      .maybeSingle();

    if (purchaseError) {
      throw new Error(purchaseError.message);
    }

    if (purchase) {
      const {
        data: lessons,
        error: lessonsError,
      } = await supabaseAdmin
        .from("bookings")
        .select(bookingSelection)
        .eq("package_purchase_id", purchase.id)
        .eq("player_id", user.id);

      if (lessonsError) {
        throw new Error(lessonsError.message);
      }

      const packageBookings = lessons ?? [];

      /*
       * De aankoop en alle lessen worden samen opgeslagen.
       * Een afwijkend aantal vraagt om controle.
       */
      if (
        !purchase.paid_at ||
        packageBookings.length !== purchase.lesson_count
      ) {
        return json({
          state: "pending",
          isPackage: true,
          booking: null,
          message:
            "De pakketbevestiging is nog niet volledig beschikbaar. Controleer over even je boekingen.",
        });
      }

      const allConfirmed = packageBookings.every(
        (booking) =>
          booking.paid_at &&
          (
            booking.status === "confirmed" ||
            booking.status === "completed"
          )
      );

      if (!allConfirmed) {
        return json({
          state: "changed",
          isPackage: true,
          booking: null,
          message:
            "De status van een of meer pakketlessen is gewijzigd. Bekijk Mijn boekingen voor de actuele situatie.",
        });
      }

      /*
       * Haal het eerste les-ID op via het tijdslot.
       * Vermijd vertrouwen op de invoegvolgorde van boekingen.
       */
      const {
        data: orderedLessons,
        error: orderError,
      } = await supabaseAdmin
        .from("bookings")
        .select("id, availability_slots!inner(starts_at)")
        .eq("package_purchase_id", purchase.id)
        .eq("player_id", user.id)
        .order("starts_at", {
          referencedTable: "availability_slots",
          ascending: true,
        });

      if (orderError) {
        throw new Error(orderError.message);
      }

      // Sorteer ook expliciet op de gerelateerde begintijd.
      const ordered = [...(orderedLessons ?? [])].sort((a, b) => {
        const aSlot = a.availability_slots as unknown as {
          starts_at: string;
        };
        const bSlot = b.availability_slots as unknown as {
          starts_at: string;
        };

        return (
          Date.parse(aSlot.starts_at) -
          Date.parse(bSlot.starts_at)
        );
      });

      const firstBooking = packageBookings.find(
        (booking) => booking.id === ordered[0]?.id
      );

      if (!firstBooking) {
        return json({
          state: "pending",
          isPackage: true,
          booking: null,
          message:
            "De lesgegevens konden nog niet volledig worden gekoppeld. Controleer je boekingen over even opnieuw.",
        });
      }

      return json({
        state: "confirmed",
        isPackage: true,
        booking: firstBooking,
      });
    }

    /*
     * 2. Zoek een losse boeking.
     */
    const {
      data: booking,
      error: bookingError,
    } = await supabaseAdmin
      .from("bookings")
      .select(bookingSelection)
      .eq("stripe_checkout_session_id", sessionId)
      .eq("player_id", user.id)
      .is("package_purchase_id", null)
      .maybeSingle();

    if (bookingError) {
      throw new Error(bookingError.message);
    }

    if (!booking || booking.status === "payment_pending") {
      /*
       * Geen uitspraak dat de betaling geslaagd of mislukt is.
       * De webhook kan nog bezig zijn.
       *
       * Dit antwoord onthult ook niet of de Session
       * bij een andere gebruiker hoort.
       */
      return json({
        state: "pending",
        isPackage: false,
        booking: null,
        message:
          "Er is nog geen definitieve boekingsbevestiging voor deze betaalpagina beschikbaar.",
      });
    }

    if (
      booking.paid_at &&
      (
        booking.status === "confirmed" ||
        booking.status === "completed"
      )
    ) {
      return json({
        state: "confirmed",
        isPackage: false,
        booking,
      });
    }

    return json({
      state: "changed",
      isPackage: false,
      booking: null,
      message:
        "De status van deze boeking is gewijzigd. Bekijk Mijn boekingen voor de actuele situatie.",
    });
  } catch (error: unknown) {
    console.error("Boekingsbevestiging ophalen mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return json(
      {
        error:
          "De bevestiging kon tijdelijk niet worden opgehaald. Probeer het opnieuw.",
      },
      503
    );
  }
}