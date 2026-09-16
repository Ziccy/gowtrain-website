import "server-only";

import Stripe from "stripe";

type LookupInput = {
  requestId: string;
  paymentIntentId: string;
};

export type RefundLookupResult =
  | {
      outcome: "found";
      refundId: string;
    }
  | {
      outcome: "not_found";
    }
  | {
      outcome: "inconclusive";
      reason: string;
    };

/*
 * Alleen zoeken bij Stripe.
 *
 * Deze functie:
 * - vraagt geen nieuwe refund aan;
 * - wijzigt geen databasegegevens;
 * - zet geen opdracht opnieuw klaar.
 *
 * Een gevonden refund moet daarna via syncStripeRefund
 * worden gecontroleerd en verwerkt.
 */
export async function findStripeRefund(
  stripe: Stripe,
  input: LookupInput,
): Promise<RefundLookupResult> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.requestId,
    ) ||
    !input.paymentIntentId.startsWith("pi_")
  ) {
    return {
      outcome: "inconclusive",
      reason: "Ongeldige refundopdracht- of betaalreferentie.",
    };
  }

  const matchingIds = new Set<string>();
  let startingAfter: string | undefined;

  const maximumPages = 5;

  try {
    for (let pageNumber = 0; pageNumber < maximumPages; pageNumber++) {
      const page = await stripe.refunds.list({
        payment_intent: input.paymentIntentId,
        limit: 100,
        ...(startingAfter
          ? { starting_after: startingAfter }
          : {}),
      });

      for (const refund of page.data) {
        const requestId =
          refund.metadata?.gowtrain_refund_request_id?.trim();

        if (requestId !== input.requestId) {
          continue;
        }

        const paymentIntentId =
          typeof refund.payment_intent === "string"
            ? refund.payment_intent
            : refund.payment_intent?.id ?? null;

        if (paymentIntentId !== input.paymentIntentId) {
          return {
            outcome: "inconclusive",
            reason: "Een gevonden refund verwijst naar een andere betaling.",
          };
        }

        matchingIds.add(refund.id);
      }

      if (matchingIds.size > 1) {
        return {
          outcome: "inconclusive",
          reason:
            "Meerdere Stripe-refunds gevonden voor dezelfde opdracht. Handmatige controle nodig.",
        };
      }

      /*
       * Eerst de volledige lijst binnen deze betaling doorlopen.
       * Niet stoppen bij de eerste match: er kan nog een tweede zijn.
       */
      if (!page.has_more) {
        const refundId = [...matchingIds][0];

        return refundId
          ? { outcome: "found", refundId }
          : { outcome: "not_found" };
      }

      const lastRefund = page.data[page.data.length - 1];

      if (!lastRefund || lastRefund.id === startingAfter) {
        return {
          outcome: "inconclusive",
          reason: "Stripe gaf geen bruikbaar vervolg voor de refundlijst.",
        };
      }

      startingAfter = lastRefund.id;
    }

    return {
      outcome: "inconclusive",
      reason:
        "De zoeklimiet is bereikt. Niet alle refunds zijn gecontroleerd.",
    };
  } catch {
    return {
      outcome: "inconclusive",
      reason:
        "De Stripe-refundlijst kon niet volledig worden opgehaald. Later opnieuw controleren.",
    };
  }
}