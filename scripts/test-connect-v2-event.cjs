const Stripe = require("stripe");

const ACCOUNT_ID = "acct_1UHJRCBAMjpV6Qwm";
const TRAINER_ID = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";
const ATTEMPT_ID = "ea191bec-77ea-401e-bf6c-49a05f628887";

const OLD_VALUE = "connect-v2-status-01";
const NEW_VALUE = "connect-v2-status-02";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();

  if (
    !key ||
    (!key.startsWith("sk_test_") && !key.startsWith("rk_test_"))
  ) {
    throw new Error("Een bestaande Stripe-testkey is vereist.");
  }

  const stripe = new Stripe(key, {
    timeout: 10_000,
    maxNetworkRetries: 0,
  });

  const before = await stripe.v2.core.accounts.retrieve(ACCOUNT_ID);

  if (
    before.object !== "v2.core.account" ||
    before.id !== ACCOUNT_ID ||
    before.livemode !== false ||
    before.closed !== false ||
    before.dashboard !== "express" ||
    before.metadata?.gowtrain_trainer_id !== TRAINER_ID ||
    before.metadata?.gowtrain_connect_attempt_id !== ATTEMPT_ID
  ) {
    throw new Error(
      "Accountcontext wijkt af. Er wordt niets gewijzigd."
    );
  }

  if (before.metadata?.gowtrain_webhook_test === NEW_VALUE) {
    console.log(
      "Testwaarde staat al op het account. Geen nieuwe update uitgevoerd."
    );
    console.log(
      "Controleer de bestaande Stripe-events en afleveringen."
    );
    return;
  }

  if (before.metadata?.gowtrain_webhook_test !== OLD_VALUE) {
    throw new Error(
      "De verwachte oorspronkelijke testwaarde ontbreekt. Geen update."
    );
  }

  console.log("Accountcontext gecontroleerd. Eén v2-update wordt gestart.");

  const updated = await stripe.v2.core.accounts.update(
    ACCOUNT_ID,
    {
      metadata: {
        ...before.metadata,
        gowtrain_webhook_test: NEW_VALUE,
      },
    },
    {
      idempotencyKey:
        "gowtrain-connect-v2-event-test/" + ATTEMPT_ID + "/02",
    }
  );

  if (
    updated.id !== ACCOUNT_ID ||
    updated.livemode !== false ||
    updated.metadata?.gowtrain_trainer_id !== TRAINER_ID ||
    updated.metadata?.gowtrain_connect_attempt_id !== ATTEMPT_ID ||
    updated.metadata?.gowtrain_webhook_test !== NEW_VALUE
  ) {
    throw new Error(
      "Update-uitkomst niet volledig bevestigd. Niet opnieuw uitvoeren."
    );
  }

  console.log(
    JSON.stringify(
      {
        updateConfirmed: true,
        accountId: updated.id,
        testValue: updated.metadata.gowtrain_webhook_test,
        stripeRequestId: updated.lastResponse?.requestId ?? null,
      },
      null,
      2
    )
  );

  console.log(
    "Dit bevestigt de accountupdate, nog niet de webhookaflevering of databaseopslag."
  );
}

main().catch((error) => {
  console.error({
    message: error instanceof Error ? error.message : "Onbekende fout",
    type: error?.type,
    code: error?.code,
    statusCode: error?.statusCode,
    requestId: error?.requestId,
  });

  console.error(
    "Stop. Niet automatisch opnieuw uitvoeren: de update kan al zijn verwerkt."
  );

  process.exitCode = 1;
});