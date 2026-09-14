import "server-only";

import Stripe from "stripe";

type LookupInput = {
  attemptId: string;
  firstStripeRequestAt: string;
};

export type PackageSessionLookupResult =
  | {
      outcome: "found";
      session: Stripe.Checkout.Session;
    }
  | {
      outcome: "not_found";
    }
  | {
      outcome: "inconclusive";
      reason: string;
    };

/*
 * Alleen zoeken. Deze functie:
 * - maakt geen Stripe Session aan;
 * - beëindigt geen Session;
 * - wijzigt geen databasegegevens.
 *
 * De gevonden Session moet vóór gebruik nog worden
 * gecontroleerd op koper, pakket, bedrag en Stripe-omgeving.
 */
export async function findPackageCheckoutSession(
  stripe: Stripe,
  input: LookupInput,
): Promise<PackageSessionLookupResult> {
  const firstRequestAt = Date.parse(input.firstStripeRequestAt);

  if (
    !input.attemptId ||
    !Number.isFinite(firstRequestAt) ||
    firstRequestAt > Date.now()
  ) {
    return {
      outcome: "inconclusive",
      reason: "De betaalpoging heeft geen geldige zoektijd.",
    };
  }

  /*
   * Een marge vóór de eerste geregistreerde aanvraag.
   * Zoek tot het huidige moment, zodat ook een later
   * herhaalde aanvraag gevonden kan worden.
   */
  const createdFrom = Math.max(
    0,
    Math.floor(firstRequestAt / 1000) - 300,
  );

  const createdUntil = Math.floor(Date.now() / 1000);

  const matches: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;

  /*
   * Begrens het aantal verzoeken.
   * Als er meer pagina's zijn, verklaren we het resultaat
   * niet ten onrechte als volledig.
   */
  const maximumPages = 5;

  try {
    for (let pageNumber = 0; pageNumber < maximumPages; pageNumber++) {
      const page = await stripe.checkout.sessions.list({
        limit: 100,
        created: {
          gte: createdFrom,
          lte: createdUntil,
        },
        ...(startingAfter
          ? { starting_after: startingAfter }
          : {}),
      });

      for (const session of page.data) {
        /*
         * Beide kenmerken doorzoeken. Een gevonden Session
         * met inconsistente metadata moet later worden
         * geweigerd, niet onzichtbaar blijven in deze zoekactie.
         */
        const belongsToAttempt =
          session.client_reference_id === input.attemptId ||
          session.metadata?.gowtrain_checkout_attempt_id ===
            input.attemptId;

        if (belongsToAttempt) {
          matches.push(session);
        }
      }

      if (matches.length > 1) {
        return {
          outcome: "inconclusive",
          reason:
            "Meerdere Stripe Sessions gevonden voor dezelfde betaalpoging. Handmatige controle nodig.",
        };
      }

      if (!page.has_more) {
        if (matches.length === 1) {
          return {
            outcome: "found",
            session: matches[0],
          };
        }

        return {
          outcome: "not_found",
        };
      }

      const lastSession = page.data[page.data.length - 1];

      if (!lastSession) {
        return {
          outcome: "inconclusive",
          reason:
            "Stripe gaf een onvolledig pagineringsresultaat terug.",
        };
      }

      startingAfter = lastSession.id;
    }

    return {
      outcome: "inconclusive",
      reason:
        "De zoeklimiet is bereikt. Niet alle Stripe Sessions zijn gecontroleerd.",
    };
  } catch (error: unknown) {
    console.error("Stripe Session terugzoeken mislukt:", {
      attemptId: input.attemptId,
      message:
        error instanceof Error
          ? error.message
          : "Onbekende fout.",
    });

    return {
      outcome: "inconclusive",
      reason:
        "Stripe kon niet volledig worden gecontroleerd. Later opnieuw proberen.",
    };
  }
}