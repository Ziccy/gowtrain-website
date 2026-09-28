import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (
    /^(TRANSFER_|TRAINER_TRANSFER_|CONNECT_V2_)[A-Z0-9_]+$/.test(message) &&
    message.length <= 150
  ) {
    return message;
  }

  return "TRANSFER_AUTO_WORKER_NOT_CONFIRMED";
}

/*
 * Uitsluitend POST.
 * Geen boeking, aankoop, bedrag of claim uit browserinput accepteren.
 * De SQL-selector bepaalt de kandidaat binnen de server-side scope.
 *
 * Eén workerstap; geen lus of automatische retry.
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  if (requireCronSecret(request)) {
    return json({ error: "Niet geautoriseerd." }, 401);
  }

  if (
    process.env.SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED !== "true" ||
    process.env.SANDBOX_TRAINER_TRANSFER_AUTOMATIC_ENABLED !== "true"
  ) {
    return json(
      {
        success: false,
        result: "disabled",
        code: "TRANSFER_AUTO_EXECUTION_DISABLED",
        message:
          "Automatische transferuitvoering staat uit. De selector en uitvoerder zijn niet aangeroepen.",
      },
      503,
    );
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (
    !stripeKey ||
    (!stripeKey.startsWith("sk_test_") && !stripeKey.startsWith("rk_test_"))
  ) {
    return json(
      {
        success: false,
        code: "TRANSFER_EXECUTION_TEST_KEY_REQUIRED",
      },
      403,
    );
  }

  try {
    /*
     * Pas na authenticatie, vlaggen en testkeycontrole laden.
     * Geen import of aanroep van de oude payoutclaim.
     */
    const { executeNextSandboxTrainerTransfer } = await import(
      "@/lib/execute-sandbox-trainer-transfer"
    );

    const result = await executeNextSandboxTrainerTransfer();

    switch (result.result) {
      case "disabled":
        return json(
          {
            success: false,
            result: "disabled",
            code: "TRANSFER_AUTO_EXECUTION_DISABLED",
          },
          503,
        );

      case "not_claimed":
        return json({
          success: true,
          result: "not_claimed",
          considered: result.considered,
          deferred: result.deferred,
          busy: result.busy,
          message:
            "Deze aanroep heeft geen uitvoeringsclaim verkregen. Eventuele selectieplanning kan wel zijn bijgewerkt.",
        });

      case "synchronized":
        return json({
          success: true,
          result: "synchronized",
          requestId: result.requestId,
          transferId: result.transferId,
          applicationResult: result.applicationResult,
          message:
            "De sandboxtransfer is geverifieerd en administratief toegepast. Dit bevestigt geen bankuitbetaling.",
        });

      case "not_confirmed":
        return json(
          {
            success: false,
            result: "not_confirmed",
            requestId: result.requestId,
            stage: result.stage,
            diagnosticCode: result.diagnosticCode,
            transferId: result.transferId,
            reviewRecorded: result.reviewRecorded,
            message:
              "De uitvoering is niet volledig bevestigd. De opdracht of Stripe-transfer kan al bestaan. Niet automatisch opnieuw aanvragen; controleer administratie en herstel.",
          },
          503,
        );
    }
  } catch (error: unknown) {
    const code = diagnosticCode(error);

    console.error("Automatische sandboxtransfer niet bevestigd:", {
      diagnosticCode: code,
    });

    return json(
      {
        success: false,
        result: "not_confirmed",
        code,
        message:
          "De workerstap kon niet volledig worden bevestigd. Dit bewijst niet dat niets is gewijzigd. Controleer de administratie voordat een vervolgactie plaatsvindt.",
      },
      503,
    );
  }
}