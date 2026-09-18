import "server-only";

import Stripe from "stripe";

type CapabilityStatus =
  | "active"
  | "pending"
  | "restricted"
  | "unsupported";

export type VerifiedTrainerConnectAccount = {
  accountId: string;
  trainerId: string;
  attemptId: string;
  livemode: false;
  country: string;
  dashboard: "express";
  transfersStatus: CapabilityStatus | null;
  payoutsStatus: CapabilityStatus | null;
  checkedAt: string;
};

type ExpectedTrainerAccount = {
  accountId: string;
  trainerId: string;
  attemptId: string;
  country: "NL" | "BE";
};

function readCapabilityStatus(
  value: unknown,
): CapabilityStatus | null {
  switch (value) {
    case "active":
    case "pending":
    case "restricted":
    case "unsupported":
      return value;

    default:
      /*
       * Ontbrekende of onbekende status is geen toestemming
       * voor een transfer of payout.
       */
      return null;
  }
}

/*
 * Uitsluitend verificatie van een nieuw, via onze v2-flow
 * aangemaakt traineraccount.
 *
 * Geen accountaanmaak.
 * Geen koppeling op basis van uitsluitend metadata.
 * Geen databasewijziging.
 * Geen transfer of bankuitbetaling.
 */
export async function retrieveVerifiedTrainerConnectV2Account(
  stripe: Stripe,
  expected: ExpectedTrainerAccount,
): Promise<VerifiedTrainerConnectAccount> {
  if (
    !expected.accountId ||
    !expected.trainerId ||
    !expected.attemptId ||
    !["NL", "BE"].includes(expected.country)
  ) {
    throw new Error("CONNECT_V2_EXPECTED_CONTEXT_INVALID");
  }

  const account = await stripe.v2.core.accounts.retrieve(
    expected.accountId,
    {
      include: [
        "configuration.recipient",
        "identity",
      ],
    },
  );

  if (
    account.object !== "v2.core.account" ||
    account.id !== expected.accountId
  ) {
    throw new Error("CONNECT_V2_ACCOUNT_ID_MISMATCH");
  }

  if (account.livemode !== false) {
    throw new Error("CONNECT_V2_LIVE_ACCOUNT_NOT_ALLOWED");
  }

  if (account.closed === true) {
    throw new Error("CONNECT_V2_ACCOUNT_CLOSED");
  }

  if (account.dashboard !== "express") {
    throw new Error("CONNECT_V2_DASHBOARD_MISMATCH");
  }

  if (
    account.metadata?.gowtrain_trainer_id !==
    expected.trainerId
  ) {
    throw new Error("CONNECT_V2_TRAINER_METADATA_MISMATCH");
  }

  if (
    account.metadata?.gowtrain_connect_attempt_id !==
    expected.attemptId
  ) {
    throw new Error("CONNECT_V2_ATTEMPT_METADATA_MISMATCH");
  }

  if (account.identity?.country !== expected.country) {
    throw new Error("CONNECT_V2_COUNTRY_MISMATCH");
  }

  const recipient = account.configuration?.recipient;

  if (
    !account.applied_configurations.includes("recipient") ||
    recipient?.applied !== true
  ) {
    throw new Error("CONNECT_V2_RECIPIENT_NOT_APPLIED");
  }

  const balanceCapabilities =
    recipient.capabilities?.stripe_balance;

  return {
    accountId: account.id,
    trainerId: expected.trainerId,
    attemptId: expected.attemptId,
    livemode: false,
    country: expected.country,
    dashboard: "express",
    transfersStatus: readCapabilityStatus(
      balanceCapabilities?.stripe_transfers?.status,
    ),
    payoutsStatus: readCapabilityStatus(
      balanceCapabilities?.payouts?.status,
    ),
    checkedAt: new Date().toISOString(),
  };
}