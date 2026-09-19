const Stripe = require("stripe");

const ACCOUNT_ID = "acct_1UHJRCBAMjpV6Qwm";
const TRAINER_ID = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";

const ORIGINAL_ATTEMPT_ID = "ea191bec-77ea-401e-bf6c-49a05f628887";
const TEST_ATTEMPT_ID = "00000000-0000-0000-0000-000000000000";

async function main() {
  const mode = process.argv[2];

  if (mode !== "simulate" && mode !== "restore") {
    throw new Error("Gebruik uitsluitend simulate of restore.");
  }

  const key = process.env.STRIPE_SECRET_KEY?.trim();

  if (
    !key ||
    (!key.startsWith("sk_test_") && !key.startsWith("rk_test_"))
  ) {
    throw new Error("De bestaande website-testkey is vereist.");
  }

  const stripe = new Stripe(key, {
    timeout: 10_000,
    maxNetworkRetries: 0,
  });

  const before = await stripe.v2.core.accounts.retrieve(
    ACCOUNT_ID,
    {
      include: ["configuration.recipient"],
    }
  );

  if (
    before.object !== "v2.core.account" ||
    before.id !== ACCOUNT_ID ||
    before.livemode !== false ||
    before.closed !== false ||
    before.dashboard !== "express" ||
    before.metadata?.gowtrain_trainer_id !== TRAINER_ID
  ) {
    throw new Error("Accountcontext wijkt af. Niets gewijzigd.");
  }

  const expectedBefore =
    mode === "simulate" ? ORIGINAL_ATTEMPT_ID : TEST_ATTEMPT_ID;

  const target =
    mode === "simulate" ? TEST_ATTEMPT_ID : ORIGINAL_ATTEMPT_ID;

  const current =
    before.metadata?.gowtrain_connect_attempt_id;

  if (current === target) {
    console.log(
      "De doelwaarde staat al op het account. Geen update uitgevoerd."
    );
    console.log(
      "Controleer de bestaande eventafleveringen; deze uitvoer bewijst geen databaseherstel."
    );
    return;
  }

  if (current !== expectedBefore) {
    throw new Error(
      "De huidige pogingmetadata wijkt af van deze test. Niets gewijzigd."
    );
  }

  if (mode === "simulate") {
    const balance =
      before.configuration?.recipient?.capabilities?.stripe_balance;

    if (
      before.configuration?.recipient?.applied !== true ||
      balance?.stripe_transfers?.status !== "active" ||
      balance?.payouts?.status !== "active"
    ) {
      throw new Error(
        "De verwachte actieve recipient-capabilities ontbreken. Test niet gestart."
      );
    }
  }

  const updated = await stripe.v2.core.accounts.update(
    ACCOUNT_ID,
    {
      metadata: {
        ...before.metadata,
        gowtrain_connect_attempt_id: target,
      },
    },
    {
      idempotencyKey:
        `gowtrain-connect-v2-config-review/${ORIGINAL_ATTEMPT_ID}/01/${mode}`,
    }
  );

  if (
    updated.id !== ACCOUNT_ID ||
    updated.livemode !== false ||
    updated.metadata?.gowtrain_trainer_id !== TRAINER_ID ||
    updated.metadata?.gowtrain_connect_attempt_id !== target
  ) {
    throw new Error(
      "De update-uitkomst is niet volledig bevestigd. Niet blind opnieuw uitvoeren."
    );
  }

  console.log(
    JSON.stringify(
      {
        mode,
        updateConfirmed: true,
        accountId: updated.id,
        attemptMetadata: updated.metadata.gowtrain_connect_attempt_id,
        stripeRequestId: updated.lastResponse?.requestId ?? null,
      },
      null,
      2
    )
  );

  console.log(
    "Dit bevestigt alleen de Stripe-metadata-update, niet de webhookverwerking of databaseopslag."
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
    "Stop en controleer de uitkomst. De update kan al zijn uitgevoerd."
  );

  process.exitCode = 1;
});