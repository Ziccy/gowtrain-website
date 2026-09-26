import { supabase } from "@/lib/supabase-browser";

export type BookingMessageState = {
  booking_id: string;
  has_messages: boolean;
  unread_count: number;
  last_sender_role: "player" | "trainer" | null;
};

const BATCH_SIZE = 500;

function parseUnreadCount(value: unknown): number {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "Het aantal ongelezen berichten kon niet worden gecontroleerd."
    );
  }

  return count;
}

function parseMessageState(value: unknown): BookingMessageState {
  if (typeof value !== "object" || value === null) {
    throw new Error("De berichtenstatus heeft een ongeldig formaat.");
  }

  const row = value as Record<string, unknown>;

  if (
    typeof row.booking_id !== "string" ||
    typeof row.has_messages !== "boolean" ||
    (
      row.last_sender_role !== null &&
      row.last_sender_role !== "player" &&
      row.last_sender_role !== "trainer"
    )
  ) {
    throw new Error("De berichtenstatus heeft een ongeldig formaat.");
  }

  const unreadCount = parseUnreadCount(row.unread_count);

  if (
    (!row.has_messages &&
      (unreadCount !== 0 || row.last_sender_role !== null)) ||
    (row.has_messages && row.last_sender_role === null)
  ) {
    throw new Error("De ontvangen berichtenstatus is niet consistent.");
  }

  return {
    booking_id: row.booking_id,
    has_messages: row.has_messages,
    unread_count: unreadCount,
    last_sender_role: row.last_sender_role,
  };
}

/**
 * Haalt de centrale berichtenstatus op voor eigen boekingen.
 *
 * De database bepaalt de gebruiker via auth.uid().
 * Ontbrekende of ongeldige resultaten worden niet als
 * "geen ongelezen berichten" behandeld.
 */
export async function getBookingMessageStates(
  bookingIds: readonly string[]
): Promise<Map<string, BookingMessageState>> {
  const uniqueIds = [...new Set(bookingIds)];
  const states = new Map<string, BookingMessageState>();

  for (let offset = 0; offset < uniqueIds.length; offset += BATCH_SIZE) {
    const batch = uniqueIds.slice(offset, offset + BATCH_SIZE);
    const expectedIds = new Set(batch);

    const { data, error } = await supabase.rpc(
      "get_booking_message_states",
      { p_booking_ids: batch }
    );

    if (error) {
      throw new Error(
        "De berichtenstatus kon niet worden geladen. Probeer opnieuw te vernieuwen."
      );
    }

    if (!Array.isArray(data)) {
      throw new Error("De berichtenstatus kon niet worden bevestigd.");
    }

    for (const value of data) {
      const state = parseMessageState(value);

      if (
        !expectedIds.has(state.booking_id) ||
        states.has(state.booking_id)
      ) {
        throw new Error(
          "De berichtenstatus bevat onverwachte of dubbele boekingen."
        );
      }

      states.set(state.booking_id, state);
    }

    for (const bookingId of batch) {
      if (!states.has(bookingId)) {
        throw new Error(
          "De berichtenstatus van een boeking ontbreekt. Vernieuw je boekingen."
        );
      }
    }
  }

  return states;
}