import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Een nieuwe betaalregistratie mag niet buiten de bijbehorende
 * gecontroleerde betaalflow om worden verwerkt.
 *
 * Een lookupfout is nooit hetzelfde als "geen registratie".
 */
export async function hasSingleLessonPaymentAttempt(
  admin: SupabaseClient,
  bookingId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("single_lesson_payment_attempts")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (error) {
    throw new Error("SINGLE_PAYMENT_GUARD_NOT_CONFIRMED");
  }

  return data !== null;
}