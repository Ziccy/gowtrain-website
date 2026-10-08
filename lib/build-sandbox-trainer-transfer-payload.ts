import "server-only";

import {
  buildTrainerTransferPayload,
  type PreparedTrainerTransferPayload,
} from "@/lib/stripe-trainer-transfer-payload";
import {
  buildSingleLessonTrainerTransferPayload,
  type SingleLessonTransferPayloadInput,
} from "@/lib/stripe-single-lesson-transfer-payload";

type PackageTransferInput =
  Parameters<typeof buildTrainerTransferPayload>[0];

export type SandboxTrainerTransferPayloadInput =
  | (PackageTransferInput & {
      sourceKind?: "package";
    })
  | (SingleLessonTransferPayloadInput & {
      sourceKind: "single_lesson";
      packagePurchaseId?: never;
    });

/*
 * Bestaande pakketaanroepers hoeven geen sourceKind mee te geven.
 * Zij moeten nog steeds een geldig packagePurchaseId aanleveren.
 *
 * Losse lessen vereisen expliciet sourceKind: "single_lesson"
 * en mogen geen packagePurchaseId bevatten.
 *
 * Dit kiest alleen het payloadformaat.
 * De aanroeper blijft verantwoordelijk voor bron- en claimvalidatie.
 */
export function buildSandboxTrainerTransferPayload(
  input: SandboxTrainerTransferPayloadInput,
): PreparedTrainerTransferPayload {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new Error("TRAINER_TRANSFER_PAYLOAD_CONTEXT_INVALID");
  }

  if (input.sourceKind === "single_lesson") {
    return buildSingleLessonTrainerTransferPayload(input);
  }

  if (
    input.sourceKind !== undefined &&
    input.sourceKind !== "package"
  ) {
    throw new Error("TRAINER_TRANSFER_PAYLOAD_KIND_INVALID");
  }

  if (typeof input.packagePurchaseId !== "string") {
    throw new Error("TRAINER_TRANSFER_PAYLOAD_PACKAGE_REQUIRED");
  }

  return buildTrainerTransferPayload(input);
}