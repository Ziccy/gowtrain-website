import "server-only";

import type Stripe from "stripe";

type CapabilityStatus =
  | "active"
  | "pending"
  | "restricted"
  | "unsupported";

type ExpectedTrainerAccount = {
  accountId: string;
  trainerId: string;
  attemptId: string;
  country: "NL" | "BE";
};

export type TrainerConnectV2StatusSnapshot = {
  accountId: string;
  trainerId: string;
  attemptId: string;
  livemode: false;
  closed: boolean;
  transfersStatus: CapabilityStatus | null;
  payoutsStatus: CapabilityStatus | null;
  checkedAt: string;

  /*
   * Een afwijking is geen geslaagde configuratieverificatie.
   * De uitvoerder moet deze redenen expliciet afhandelen.
   */
  reviewReasons: string[];
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
      return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/*
 * Leest een bestaande, vooraf uit onze database bepaalde koppeling.
 *
 * expected mag niet rechtstreeks uit browserinput of uitsluitend
 * uit Stripe-metadata worden samengesteld.
 *
 * Geen accountaanmaak.
 * Geen onboardinglink.
 * Geen databasewrites.
 * Geen transfer of bankuitbetaling.
 */
export async function retrieveTrainerConnectV2StatusSnapshot(
  stripe: Stripe,
  expected: ExpectedTrainerAccount,
): Promise<TrainerConnectV2StatusSnapshot> {
  if (
    !/^acct_[A-Za-z0-9]+$/.test(expected.accountId) ||
    !isUuid(expected.trainerId) ||
    !isUuid(expected.attemptId) ||
    !["NL", "BE"].includes(expected.country)
  ) {
    throw new Error("CONNECT_V2_STATUS_CONTEXT_INVALID");
  }

  // Startmoment van deze controle, niet de aankomsttijd van de response.
  const checkedAt = new Date().toISOString();

  const account = await stripe.v2.core.accounts.retrieve(
    expected.accountId,
    {
      include: [
        "configuration.recipient",
        "identity",
        "defaults",
      ],
    },
  );

  if (
    account.object !== "v2.core.account" ||
    account.id !== expected.accountId
  ) {
    throw new Error("CONNECT_V2_STATUS_ACCOUNT_MISMATCH");
  }

  if (account.livemode !== false) {
    throw new Error("CONNECT_V2_STATUS_LIVE_ACCOUNT_NOT_ALLOWED");
  }

  if (typeof account.closed !== "boolean") {
    throw new Error("CONNECT_V2_STATUS_CLOSED_STATE_UNKNOWN");
  }

  const base = {
    accountId: account.id,
    trainerId: expected.trainerId,
    attemptId: expected.attemptId,
    livemode: false as const,
    checkedAt,
  };

  /*
   * Het verwachte opgeslagen account-ID en de testomgeving zijn
   * hierboven bevestigd.
   *
   * Een sluiting niet negeren doordat bij een gesloten account
   * metadata of configuratie inmiddels ontbreken/afwijken.
   */
  if (account.closed === true) {
    return {
      ...base,
      closed: true,
      transfersStatus: null,
      payoutsStatus: null,
      reviewReasons: [],
    };
  }

  const reviewReasons: string[] = [];

  if (account.dashboard !== "express") {
    reviewReasons.push("DASHBOARD_MISMATCH");
  }

  if (
    account.metadata?.gowtrain_trainer_id !== expected.trainerId
  ) {
    reviewReasons.push("TRAINER_METADATA_MISMATCH");
  }

  if (
    account.metadata?.gowtrain_connect_attempt_id !==
    expected.attemptId
  ) {
    reviewReasons.push("ATTEMPT_METADATA_MISMATCH");
  }

  if (account.identity?.country !== expected.country) {
    reviewReasons.push("COUNTRY_MISMATCH");
  }

  const recipient = account.configuration?.recipient;

  if (
    !Array.isArray(account.applied_configurations) ||
    !account.applied_configurations.includes("recipient") ||
    recipient?.applied !== true
  ) {
    reviewReasons.push("RECIPIENT_NOT_APPLIED");
  }

  if (
    account.defaults?.responsibilities?.fees_collector !==
    "application"
  ) {
    reviewReasons.push("FEES_RESPONSIBILITY_MISMATCH");
  }

  if (
    account.defaults?.responsibilities?.losses_collector !==
    "application"
  ) {
    reviewReasons.push("LOSSES_RESPONSIBILITY_MISMATCH");
  }

  const balanceCapabilities =
    recipient?.capabilities?.stripe_balance;

  const transfersStatus = readCapabilityStatus(
    balanceCapabilities?.stripe_transfers?.status,
  );

  const payoutsStatus = readCapabilityStatus(
    balanceCapabilities?.payouts?.status,
  );

  if (transfersStatus === null) {
    reviewReasons.push("TRANSFERS_STATUS_UNKNOWN");
  }

  if (payoutsStatus === null) {
    reviewReasons.push("PAYOUTS_STATUS_UNKNOWN");
  }

  /*
   * Bij een afwijkende of onvolledige verificatie geen bruikbare
   * capabilitystatussen aan onze administratie doorgeven.
   *
   * NULL betekent hier: niet betrouwbaar bevestigd voor Gowtrain.
   * We verzinnen geen Stripe-status zoals "restricted".
   */
  if (reviewReasons.length > 0) {
    return {
      ...base,
      closed: false,
      transfersStatus: null,
      payoutsStatus: null,
      reviewReasons,
    };
  }

  return {
    ...base,
    closed: false,
    transfersStatus,
    payoutsStatus,
    reviewReasons: [],
  };
}