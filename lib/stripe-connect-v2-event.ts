import "server-only";

import type Stripe from "stripe";

const ACCOUNT_EVENT_TYPES = [
  "v2.core.account.closed",
  "v2.core.account.updated",
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[defaults].updated",
  "v2.core.account[identity].updated",
  "v2.core.account[requirements].updated",
] as const;

type AccountEventType = (typeof ACCOUNT_EVENT_TYPES)[number];

type ParsedNotification = ReturnType<
  Stripe["parseEventNotification"]
>;

export type VerifiedConnectV2Notification =
  | {
      kind: "account";
      eventId: string;
      eventType: AccountEventType;
      accountId: string;
      notification: ParsedNotification;
    }
  | {
      kind: "ping";
      eventId: string;
    }
  | {
      kind: "ignored";
      eventId: string;
      eventType: string;
    };

function isAccountEventType(
  value: string,
): value is AccountEventType {
  return ACCOUNT_EVENT_TYPES.some((type) => type === value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/*
 * Verifieert uitsluitend een thin-notificatie.
 *
 * Geen Stripe-netwerkaanroep.
 * Geen databasewijziging.
 * Geen accounttoewijzing via metadata.
 *
 * De uitvoerder moet vervolgens:
 * - de bestaande databasekoppeling opzoeken;
 * - het bijbehorende event/context controleren;
 * - de actuele accountstatus ophalen;
 * - die onder databasecontroles opslaan.
 */
export function verifyConnectV2EventNotification(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  signingSecret: string,
): VerifiedConnectV2Notification {
  if (!signature || !signingSecret) {
    throw new Error("CONNECT_V2_EVENT_SIGNATURE_CONFIG_MISSING");
  }

  // Deze SDK-methode controleert de handtekening én de tijdstolerantie.
  // Niet vervangen door parseEventNotificationWithoutVerification.
  const notification = stripe.parseEventNotification(
    rawBody,
    signature,
    signingSecret,
  );

  if (
    notification.object !== "v2.core.event" ||
    typeof notification.id !== "string" ||
    !notification.id.trim() ||
    typeof notification.type !== "string" ||
    !notification.type.trim()
  ) {
    throw new Error("CONNECT_V2_EVENT_INVALID");
  }

  if (notification.livemode !== false) {
    throw new Error("CONNECT_V2_EVENT_NOT_TESTMODE");
  }

  if (notification.type === "v2.core.event_destination.ping") {
    return {
      kind: "ping",
      eventId: notification.id,
    };
  }

  if (!isAccountEventType(notification.type)) {
    return {
      kind: "ignored",
      eventId: notification.id,
      eventType: notification.type,
    };
  }

  const related: unknown =
    "related_object" in notification
      ? notification.related_object
      : undefined;

  if (
    !isObject(related) ||
    related.type !== "v2.core.account" ||
    typeof related.id !== "string" ||
    !/^acct_[A-Za-z0-9]+$/.test(related.id)
  ) {
    throw new Error("CONNECT_V2_EVENT_ACCOUNT_REFERENCE_INVALID");
  }

  /*
   * related.url wordt bewust niet gevolgd.
   *
   * notification.context blijft behouden in het SDK-object.
   * Deze context is niet hetzelfde als het traineraccount-ID.
   * De ontvangstroute moet de context bij het ophalen van het
   * event correct meenemen en de accountkoppeling apart controleren.
   */
  return {
    kind: "account",
    eventId: notification.id,
    eventType: notification.type,
    accountId: related.id,
    notification,
  };
}