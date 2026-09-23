import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (
    /^(TRANSFER_|TRAINER_TRANSFER_)[A-Z0-9_]+$/.test(message) &&
    message.length <= 150
  ) {
    return message;
  }

  return "TRANSFER_RECOVERY_WORKER_FAILED";
}

async function handle(request: NextRequest): Promise<NextResponse> {
  // Eerst toegang controleren, ook als herstel uitgeschakeld is.
  if (requireCronSecret(request)) {
    return json({ error: "Niet geautoriseerd." }, 401);
  }

  /*
   * Afzonderlijke herstelvlag.
   * Ontbrekend, false of een andere waarde betekent uitgeschakeld.
   *
   * De transferuitvoeringsvlag wordt niet gewijzigd of omzeild:
   * deze route bevat uitsluitend herstel van bestaande opdrachten.
   */
  if (
    process.env.SANDBOX_TRAINER_TRANSFER_RECOVERY_ENABLED?.trim() !==
    "true"
  ) {
    return json(
      {
        success: false,
        code: "TRANSFER_RECOVERY_DISABLED",
        message:
          "Transferherstel is uitgeschakeld. Geen worker aangeroepen.",
      },
      503,
    );
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (
    !stripeKey ||
    (
      !stripeKey.startsWith("sk_test_") &&
      !stripeKey.startsWith("rk_test_")
    )
  ) {
    return json(
      {
        success: false,
        code: "TRANSFER_RECOVERY_TEST_KEY_REQUIRED",
        message: "Deze herstelroute is uitsluitend voor sandboxgebruik.",
      },
      403,
    );
  }

  try {
    /*
     * Pas na authenticatie, inschakeling en testkeycontrole laden.
     * Bij een uitgeschakelde route worden de worker en diens
     * database-/Stripe-afhankelijkheden niet via deze import geladen.
     */
    const { runSandboxTransferRecoveryWorker } = await import(
      "@/lib/run-sandbox-transfer-recovery-worker"
    );

    const result = await runSandboxTransferRecoveryWorker();

    switch (result.result) {
      case "not_started":
        return json({
          success: true,
          result: result.result,
          message:
            "Deze aanroep heeft geen onderzoek gestart of timeout afgehandeld. Dit bewijst niet dat er nergens herstel nodig is.",
        });

      case "timeout_processed":
        return json({
          success: true,
          result: result.result,
          requestId: result.requestId,
          checkId: result.checkId,
          message:
            "Onderzoekstimeout geregistreerd. Dit annuleert geen eerdere Stripe-read of synchronisatie. Geen nieuw onderzoek in deze workerstap gestart.",
        });

      case "recorded":
        return json({
          success: true,
          result: result.result,
          requestId: result.requestId,
          checkId: result.checkId,
          recoveryResult: result.recovery.result,
          message:
            "Onderzoeksuitkomst geregistreerd. Dit betekent niet op zichzelf dat een transfer is toegepast of dat geen handmatige beoordeling nodig is.",
        });

      case "investigation_failed":
        return json(
          {
            success: false,
            result: result.result,
            requestId: result.requestId,
            checkId: result.checkId,
            diagnosticCode: result.diagnosticCode,
            failureRecorded: result.failureRecorded,
            message:
              "Het onderzoek is mislukt. Controleer de registratie; financiële toepassing is hiermee niet uitgesloten.",
          },
          503,
        );

      case "completion_not_confirmed":
        return json(
          {
            success: false,
            result: result.result,
            requestId: result.requestId,
            checkId: result.checkId,
            recoveryResult: result.recovery.result,
            message:
              "De onderzoeksafsluiting is niet bevestigd. Financiële synchronisatie kan al zijn toegepast.",
          },
          503,
        );
    }
  } catch (error: unknown) {
    const code = diagnosticCode(error);

    console.error("Transferherstelworker niet volledig bevestigd:", {
      diagnosticCode: code,
    });

    return json(
      {
        success: false,
        code,
        message:
          "De workerstap kon niet volledig worden bevestigd. Controleer de registratie. Deze route vraagt geen nieuwe Stripe-transfer aan.",
      },
      503,
    );
  }
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  return handle(request);
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  return handle(request);
}