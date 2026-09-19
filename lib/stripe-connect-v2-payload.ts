import "server-only";

import type Stripe from "stripe";

/*
 * Leid het type af van de daadwerkelijk geïnstalleerde SDK.
 * Geen import via interne node_modules-paden.
 */
export type ConnectV2AccountCreateParams = NonNullable<
  Parameters<Stripe["v2"]["core"]["accounts"]["create"]>[0]
>;

type ConnectV2PayloadInput = {
  trainerId: string;
  attemptId: string;
  contactEmail: string;
  displayName: string;
  country: "NL" | "BE";
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/*
 * Bouwt uitsluitend een aanvraagobject.
 *
 * Geen Stripe-aanroep.
 * Geen databasewijziging.
 * Geen nieuwe interpretatie van een eerder verzonden aanvraag.
 *
 * Dit object moet vóór verzending exact worden opgeslagen.
 * De uitvoerder gebruikt vervolgens de opgeslagen payload.
 */
export function buildConnectV2AccountPayload(
  input: ConnectV2PayloadInput,
): ConnectV2AccountCreateParams {
  const contactEmail = input.contactEmail.trim();
  const displayName = input.displayName.trim();

  if (
    !isUuid(input.trainerId) ||
    !isUuid(input.attemptId) ||
    !["NL", "BE"].includes(input.country) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) ||
    !displayName
  ) {
    throw new Error("CONNECT_V2_PAYLOAD_INPUT_INVALID");
  }

  return {
    contact_email: contactEmail,
    display_name: displayName,
    dashboard: "express",

    identity: {
      country: input.country,
    },

    defaults: {
      currency: "eur",
      locales: ["nl"],
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },

    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              requested: true,
            },
          },
        },
      },
    },

    metadata: {
      gowtrain_trainer_id: input.trainerId,
      gowtrain_connect_attempt_id: input.attemptId,
    },

    include: [
      "configuration.recipient",
      "identity",
      "defaults",
      "requirements",
    ],
  };
}