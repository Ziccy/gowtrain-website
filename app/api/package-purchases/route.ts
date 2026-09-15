import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const supabaseAdmin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

function json(
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Authorization",
    },
  });
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return json(
        { error: "Log in om je pakketaankopen te bekijken." },
        401
      );
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

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

    /*
     * Alleen aankopen van de geverifieerde gebruiker ophalen.
     * Geen player_id uit de querystring accepteren.
     */
    const {
      data: purchases,
      error: purchasesError,
    } = await supabaseAdmin
      .from("package_purchases")
      .select(
        `
          id,
          player_id,
          trainer_id,
          package_title,
          lesson_count,
          participant_count,
          total_price_cents,
          currency,
          paid_at,
          stripe_livemode,
          cancellation_rules_version,
          original_first_lesson_at,
          player_free_cancellation_deadline,
          created_at
        `
      )
      .eq("player_id", user.id)
      .order("created_at", { ascending: false });

    if (purchasesError) {
      throw new Error(purchasesError.message);
    }

    if (!purchases?.length) {
      return json({
        purchases: [],
        checkedAt: new Date().toISOString(),
      });
    }

    const purchaseIds = purchases.map((purchase) => purchase.id);

    /*
     * Gebruik een letterlijke select-string zodat Supabase
     * de gerelateerde velden kan afleiden.
     */
    const {
      data: bookings,
      error: bookingsError,
    } = await supabaseAdmin
      .from("bookings")
      .select(
        `
          id,
          package_purchase_id,
          trainer_id,
          status,
          paid_at,
          currency,
          total_price_cents,
          stripe_refund_id,
          stripe_transfer_id,
          trainer_payout_status,
          availability_slots (
            starts_at,
            status
          )
        `
      )
      .eq("player_id", user.id)
      .in("package_purchase_id", purchaseIds);

    if (bookingsError) {
      throw new Error(bookingsError.message);
    }

    const {
      data: refunds,
      error: refundsError,
    } = await supabaseAdmin
      .from("refund_requests")
      .select(
        `
          id,
          source_package_purchase_id,
          reason_code,
          amount_cents,
          currency,
          status,
          applied_at
        `
      )
      .in("source_package_purchase_id", purchaseIds);

    if (refundsError) {
      throw new Error(refundsError.message);
    }

    const bookingIds = (bookings ?? []).map((booking) => booking.id);

    const openIssueBookingIds = new Set<string>();

    if (bookingIds.length > 0) {
      const { data: issues, error: issuesError } = await supabaseAdmin
        .from("booking_issues")
        .select("booking_id")
        .in("booking_id", bookingIds)
        .in("status", ["open", "in_review"]);

      if (issuesError) {
        throw new Error(issuesError.message);
      }

      for (const issue of issues ?? []) {
        openIssueBookingIds.add(issue.booking_id);
      }
    }

    const checkedAt = Date.now();

    const result = purchases.map((purchase) => {
      const lessons = (bookings ?? []).filter(
        (booking) => booking.package_purchase_id === purchase.id
      );

      const purchaseRefunds = (refunds ?? []).filter(
        (refund) =>
          refund.source_package_purchase_id === purchase.id
      );

      const fullCancellation = purchaseRefunds.find(
        (refund) =>
          refund.reason_code === "player_package_timely_refund"
      );

      const deadline = Date.parse(
        purchase.player_free_cancellation_deadline ?? ""
      );

      const originalStart = Date.parse(
        purchase.original_first_lesson_at ?? ""
      );

      /*
       * Deze beoordeling is bedoeld voor de weergave.
       * De annuleringsfunctie controleert alles opnieuw
       * onder databasevergrendeling wanneer de speler bevestigt.
       */
      let canCancel = false;
      let cancellationMessage: string;

      if (fullCancellation) {
        cancellationMessage =
          fullCancellation.status === "succeeded" &&
          fullCancellation.applied_at
            ? "Dit pakket is geannuleerd en de terugbetaling is verwerkt."
            : "De pakketannulering is geregistreerd. Hieronder staat de status van de terugbetaling.";
      } else if (purchase.stripe_livemode !== false) {
        cancellationMessage =
          "Deze nieuwe annuleringsfunctie is voorlopig alleen beschikbaar voor sandboxaankopen.";
      } else if (
        purchase.cancellation_rules_version !== "package_48h_v1" ||
        !Number.isFinite(deadline) ||
        !Number.isFinite(originalStart) ||
        deadline !== originalStart - 48 * 60 * 60 * 1000
      ) {
        cancellationMessage =
          "De oorspronkelijke annuleringsvoorwaarden zijn niet volledig vastgelegd. Neem contact op met Gowtrain.";
      } else if (checkedAt > deadline) {
        cancellationMessage =
          "De kosteloze annuleringsdeadline is verstreken. Voor stoppen of gemiste pakketlessen volgt geen automatische terugbetaling. Bij een probleem kun je contact opnemen met Gowtrain.";
      } else if (purchaseRefunds.length > 0) {
        cancellationMessage =
          "Er bestaat al een refundopdracht voor dit pakket. Laat Gowtrain het resterende bedrag beoordelen.";
      } else if (
        lessons.some((lesson) => openIssueBookingIds.has(lesson.id))
      ) {
        cancellationMessage =
          "Er loopt een probleemmelding voor dit pakket. Laat Gowtrain de annulering beoordelen.";
      } else {
        const totalLessonAmount = lessons.reduce(
          (sum, lesson) => sum + lesson.total_price_cents,
          0
        );

        /*
         * Supabase-relaties kunnen afhankelijk van de afgeleide
         * types als object of array worden weergegeven.
         */
        const slots = lessons.map((lesson) => {
          const relation = lesson.availability_slots;

          const value = Array.isArray(relation)
            ? relation[0]
            : relation;

          return value as {
            starts_at: string;
            status: string;
          } | null;
        });

        const starts = slots.map((slot) =>
          slot ? Date.parse(slot.starts_at) : NaN
        );

        const lessonsMatch =
          Boolean(purchase.paid_at) &&
          lessons.length === purchase.lesson_count &&
          lessons.length > 0 &&
          totalLessonAmount === purchase.total_price_cents &&
          lessons.every(
            (lesson) =>
              lesson.trainer_id === purchase.trainer_id &&
              lesson.status === "confirmed" &&
              Boolean(lesson.paid_at) &&
              lesson.currency === purchase.currency &&
              lesson.stripe_refund_id === null &&
              lesson.stripe_transfer_id === null &&
              !["processing", "paid"].includes(
                lesson.trainer_payout_status
              )
          ) &&
          slots.every((slot) => slot?.status === "booked") &&
          starts.every(Number.isFinite) &&
          Math.min(...starts) === originalStart;

        if (lessonsMatch) {
          canCancel = true;
          cancellationMessage =
            "Je kunt het volledige pakket tot en met de vermelde deadline kosteloos annuleren. Alle lessen worden dan geannuleerd en het volledige pakketbedrag wordt voor terugbetaling klaargezet.";
        } else {
          cancellationMessage =
            "Een of meer lessen zijn gewijzigd of niet meer geschikt voor automatische pakketannulering. Neem contact op met Gowtrain.";
        }
      }

      /*
       * Alleen gegevens teruggeven die de speler nodig heeft.
       * Geen Stripe-ID's, interne foutmeldingen of andere
       * gebruikersgegevens naar de browser sturen.
       */
      return {
        purchaseId: purchase.id,
        packageTitle: purchase.package_title,
        lessonCount: purchase.lesson_count,
        participantCount: purchase.participant_count,
        totalPriceCents: purchase.total_price_cents,
        currency: purchase.currency,
        originalFirstLessonAt: purchase.original_first_lesson_at,
        freeCancellationDeadline:
          purchase.player_free_cancellation_deadline,
        canCancel,
        cancellationMessage,
        cancellation: fullCancellation
          ? {
              refundStatus: fullCancellation.status,
              amountCents: fullCancellation.amount_cents,
              currency: fullCancellation.currency,
              applied: Boolean(fullCancellation.applied_at),
            }
          : null,
      };
    });

    return json({
      purchases: result,
      checkedAt: new Date(checkedAt).toISOString(),
    });
  } catch (error: unknown) {
    console.error("Pakketaankopen ophalen mislukt:", {
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return json(
      {
        error:
          "Je pakketaankopen konden tijdelijk niet worden opgehaald. Probeer het opnieuw.",
      },
      503
    );
  }
}