import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseServiceRoleKey = getRequiredEnv(
  "SUPABASE_SERVICE_ROLE_KEY"
);
const cronSecret = getRequiredEnv("CRON_SECRET");

const stripe = new Stripe(stripeSecretKey);

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type ClaimedBooking = {
  booking_id: string;
};

type PayoutBooking = {
  id: string;
  trainer_id: string;
  trainer_net_amount_cents: number;
  currency: string;
  stripe_transfer_id: string | null;
  trainer_payout_status: string;

  trainers: {
    id: string;
    name: string;
    stripe_account_id: string | null;
    stripe_payouts_enabled: boolean;
  } | null;
};

function isAuthorizedCronRequest(request: NextRequest): boolean {
  /*
    Vercel Cron stuurt doorgaans:
    Authorization: Bearer [CRON_SECRET]

    Voor lokaal testen kun je dezelfde header meesturen.
  */
  const authorizationHeader = request.headers.get("authorization");

  return authorizationHeader === `Bearer ${cronSecret}`;
}

async function returnBookingToPayoutQueue(
  bookingId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("bookings")
    .update({
      trainer_payout_status: "pending",
      trainer_payout_last_error: errorMessage,
    })
    .eq("id", bookingId)
    .eq("trainer_payout_status", "processing");

  if (error) {
    console.error(
      `Payout-status terugzetten mislukt voor booking ${bookingId}:`,
      error.message
    );
  }
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
      Claim maximaal 25 eligible bookings.
      De database zet ze atomair op processing.
    */
    const { data: claimedData, error: claimError } = await supabaseAdmin.rpc(
      "claim_eligible_trainer_payouts",
      {
        p_limit: 25,
      }
    );

    if (claimError) {
      console.error("Payouts claimen fout:", claimError.message);

      return NextResponse.json(
        { error: "Traineruitbetalingen konden niet worden opgehaald." },
        { status: 500 }
      );
    }

    const claimedBookings = (claimedData ?? []) as ClaimedBooking[];

    if (claimedBookings.length === 0) {
      return NextResponse.json({
        processed: 0,
        paid: 0,
        pending: 0,
        message: "Geen traineruitbetalingen beschikbaar.",
      });
    }

    const bookingIds = claimedBookings.map((item) => item.booking_id);

    const { data: bookingData, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select(
        `
          id,
          trainer_id,
          trainer_net_amount_cents,
          currency,
          stripe_transfer_id,
          trainer_payout_status,

          trainers (
            id,
            name,
            stripe_account_id,
            stripe_payouts_enabled
          )
        `
      )
      .in("id", bookingIds)
      .eq("trainer_payout_status", "processing");

    if (bookingError) {
      console.error("Claimed bookings ophalen fout:", bookingError.message);

      for (const bookingId of bookingIds) {
        await returnBookingToPayoutQueue(
          bookingId,
          "Bookinggegevens konden niet worden opgehaald."
        );
      }

      return NextResponse.json(
        { error: "Traineruitbetalingen konden niet worden verwerkt." },
        { status: 500 }
      );
    }

    const payoutBookings = (bookingData ?? []) as unknown as PayoutBooking[];

    let paidCount = 0;
    let pendingCount = 0;
    const results: Array<{
      bookingId: string;
      status: "paid" | "pending";
      reason?: string;
    }> = [];

    for (const booking of payoutBookings) {
      const trainer = booking.trainers;

      if (
        !trainer?.stripe_account_id ||
        trainer.stripe_payouts_enabled !== true
      ) {
        const reason =
          "Trainer heeft geen actief Stripe-uitbetalingsaccount.";

        await returnBookingToPayoutQueue(booking.id, reason);

        pendingCount += 1;
        results.push({
          bookingId: booking.id,
          status: "pending",
          reason,
        });

        continue;
      }

      if (booking.trainer_net_amount_cents <= 0) {
        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            trainer_payout_status: "not_applicable",
            trainer_payout_last_error: null,
          })
          .eq("id", booking.id)
          .eq("trainer_payout_status", "processing");

        if (error) {
          console.error(
            `Booking ${booking.id} op not_applicable zetten fout:`,
            error.message
          );
        }

        results.push({
          bookingId: booking.id,
          status: "paid",
        });

        continue;
      }

      try {
        /*
          Transfer gaat vanuit het Gowtrain-platformsaldo naar het
          Stripe Connect-account van de trainer.

          De idempotency key is cruciaal:
          als de route na een Stripe-transfer crasht voordat Supabase
          is bijgewerkt, kan een volgende run dezelfde transfer veilig
          opnieuw opvragen zonder dubbel uit te betalen.
        */
        const transfer = await stripe.transfers.create(
          {
            amount: booking.trainer_net_amount_cents,
            currency: booking.currency,
            destination: trainer.stripe_account_id,

            metadata: {
              gowtrain_booking_id: booking.id,
              gowtrain_trainer_id: booking.trainer_id,
              gowtrain_trainer_name: trainer.name,
            },

            description: `Gowtrain uitbetaling booking ${booking.id}`,
          },
          {
            idempotencyKey: `gowtrain-trainer-payout-${booking.id}`,
          }
        );

        const { error: updateError } = await supabaseAdmin
          .from("bookings")
          .update({
            stripe_transfer_id: transfer.id,
            trainer_payout_status: "paid",
            trainer_paid_at: new Date().toISOString(),
            trainer_payout_last_error: null,
          })
          .eq("id", booking.id)
          .eq("trainer_payout_status", "processing");

        if (updateError) {
          /*
            Stripe heeft de transfer mogelijk wel gemaakt.
            De volgende cron-run gebruikt dezelfde idempotency key.
            Daarom zetten we deze booking terug op pending, zodat
            de run later opnieuw veilig kan synchroniseren.
          */
          console.error(
            `Transfer opslaan bij booking ${booking.id} fout:`,
            updateError.message
          );

          await returnBookingToPayoutQueue(
            booking.id,
            "Stripe-transfer is gemaakt, maar kon niet in Gowtrain worden opgeslagen."
          );

          pendingCount += 1;
          results.push({
            bookingId: booking.id,
            status: "pending",
            reason: "Transferstatus kon niet worden opgeslagen.",
          });

          continue;
        }

        paidCount += 1;

        results.push({
          bookingId: booking.id,
          status: "paid",
        });

        console.log(
          `Traineruitbetaling voltooid: booking ${booking.id}, transfer ${transfer.id}`
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Onbekende Stripe-transferfout.";

        console.error(
          `Traineruitbetaling fout voor booking ${booking.id}:`,
          error
        );

        /*
          Bijvoorbeeld bij onvoldoende beschikbaar platformsaldo.
          Bewaar de fout, maar probeer automatisch opnieuw bij de volgende run.
        */
        await returnBookingToPayoutQueue(booking.id, message);

        pendingCount += 1;
        results.push({
          bookingId: booking.id,
          status: "pending",
          reason: message,
        });
      }
    }

    return NextResponse.json({
      processed: payoutBookings.length,
      paid: paidCount,
      pending: pendingCount,
      results,
    });
  } catch (error) {
    console.error("Trainer payout cron fout:", error);

    return NextResponse.json(
      {
        error:
          "Traineruitbetalingen konden niet worden verwerkt. Probeer het later opnieuw.",
      },
      { status: 500 }
    );
  }
}