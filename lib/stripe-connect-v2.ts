import "server-only";

import type Stripe from "stripe";
import { retrieveTrainerConnectV2StatusSnapshot } from "@/lib/stripe-connect-v2-status";

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

/*
 * Strikte verificatie voor onboarding en de bestaande statusroute.
 *
 * Gebruikt dezelfde accountcontroles als de nieuwe synchronisatiehelper.
 * Een gesloten account of configuratieafwijking mag hier nooit als
 * geverifieerde open koppeling aan de link-RPC worden doorgegeven.
 *
 * Geen accountaanmaak.
 * Geen databasewijziging.
 * Geen transfer of bankuitbetaling.
 */
export async function retrieveVerifiedTrainerConnectV2Account(
  stripe: Stripe,
  expected: ExpectedTrainerAccount,
): Promise<VerifiedTrainerConnectAccount> {
  const snapshot = await retrieveTrainerConnectV2StatusSnapshot(
    stripe,
    expected,
  );

  if (snapshot.closed) {
    throw new Error("CONNECT_V2_ACCOUNT_CLOSED");
  }

  if (snapshot.reviewReasons.length > 0) {
    console.error("Connect v2-accountconfiguratie vereist controle:", {
      accountId: snapshot.accountId,
      trainerId: snapshot.trainerId,
      attemptId: snapshot.attemptId,
      reviewReasons: snapshot.reviewReasons,
    });

    throw new Error("CONNECT_V2_ACCOUNT_REQUIRES_REVIEW");
  }

  return {
    accountId: snapshot.accountId,
    trainerId: snapshot.trainerId,
    attemptId: snapshot.attemptId,
    livemode: false,
    country: expected.country,
    dashboard: "express",
    transfersStatus: snapshot.transfersStatus,
    payoutsStatus: snapshot.payoutsStatus,
    checkedAt: snapshot.checkedAt,
  };
}