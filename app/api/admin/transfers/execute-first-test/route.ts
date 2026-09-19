import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { executeSandboxTrainerTransfer } from "@/lib/execute-sandbox-trainer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BOOKING_ID = "c413bd74-8c8f-4ba5-8f03-98430c08f905";
const PURCHASE_ID = "c02e8212-9379-4f3f-8edd-023dea74910a";
const AMOUNT_CENTS = 1900;
const CONFIRMATION = "TRANSFER 19 EUR";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`${name} ontbreekt.`);

  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const database = createClient(
  supabaseUrl,
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

async function isCurrentAdmin(userId: string): Promise<boolean> {
  const { data, error } = await database
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error("ADMIN_ROLE_CHECK_FAILED");

  return data?.role === "admin";
}

/*
 * Uitsluitend de expliciet toegestane eerste testtransfer.
 *
 * GET voert niets uit; Next.js retourneert daarvoor 405.
 * Geen automatische batches, retries of herstelacties.
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  let stage = "authentication";
  let requestId: string | null = null;

  try {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!token) {
      return json({ error: "Je bent niet ingelogd." }, 401);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError || !user) {
      return json(
        { error: "Je sessie is ongeldig of verlopen." },
        401,
      );
    }

    if (!(await isCurrentAdmin(user.id))) {
      return json({ error: "Alleen admins hebben toegang." }, 403);
    }

    stage = "confirmation";

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Ongeldige JSON-aanvraag." }, 400);
    }

    /*
     * Browserinput kan de scope alleen bevestigen, niet veranderen.
     * Ook onbekende parameters weigeren.
     */
    const allowedFields = new Set([
      "bookingId",
      "purchaseId",
      "amountCents",
      "confirmation",
    ]);

    if (
      !isObject(body) ||
      Object.keys(body).some((key) => !allowedFields.has(key)) ||
      body.bookingId !== BOOKING_ID ||
      body.purchaseId !== PURCHASE_ID ||
      body.amountCents !== AMOUNT_CENTS ||
      body.confirmation !== CONFIRMATION
    ) {
      return json(
        {
          error:
            "De aanvraag komt niet overeen met de expliciet toegestane testtransfer.",
        },
        400,
      );
    }

    /*
     * Stop vóór transferregistratie en vóór de uitvoerder.
     * Een succesvolle disabled-response is geen uitgevoerde transfer.
     */
    if (
      process.env.SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED !== "true"
    ) {
      return json({
        result: "disabled",
        executionConfirmed: false,
        registrationAttempted: false,
        stripeCreateAttempted: false,
        message:
          "Uitvoering staat uit. Deze aanvraag heeft geen transferopdracht geregistreerd, geclaimd of verzonden.",
      });
    }

    const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

    if (
      !stripeKey.startsWith("sk_test_") &&
      !stripeKey.startsWith("rk_test_")
    ) {
      return json(
        {
          error: "Deze route ondersteunt uitsluitend Stripe-testkeys.",
          executionConfirmed: false,
        },
        503,
      );
    }

    // Vlak vóór de eerste write de actuele adminrol opnieuw controleren.
    stage = "access_recheck";

    if (!(await isCurrentAdmin(user.id))) {
      return json(
        { error: "De adminrechten zijn niet meer actief." },
        403,
      );
    }

    stage = "register";

    /*
     * De database controleert onder locks onder meer:
     * - oorspronkelijke aankoop en les;
     * - start + 24 uur volgens de databaseklok;
     * - refund-/issueblokkades;
     * - de v2-bestemming;
     * - pakketbedragen en unieke bestemming.
     *
     * Een bestaande opdracht wordt niet gereset.
     */
    const { data, error: registrationError } = await database.rpc(
      "register_sandbox_trainer_transfer",
      {
        p_booking_id: BOOKING_ID,
      },
    );

    if (registrationError) {
      console.error("Eerste testtransfer: registratie niet bevestigd.", {
        stage,
        bookingId: BOOKING_ID,
        databaseCode: registrationError.code,
        message: registrationError.message,
      });

      const knownRejection = [
        "P0001",
        "23505",
        "23514",
      ].includes(registrationError.code);

      return json(
        {
          result: "registration_not_confirmed",
          executionConfirmed: false,
          code: registrationError.code,
          error:
            registrationError.code === "P0001"
              ? registrationError.message
              : "De registratie is niet bevestigd. Controleer de bestaande opdracht voordat je opnieuw probeert.",
          message:
            "Deze route heeft de uitvoerder niet aangeroepen. Dit sluit verwerking door een andere gelijktijdige aanvraag niet uit.",
        },
        knownRejection ? 409 : 503,
      );
    }

    if (!isUuid(data)) {
      throw new Error("TRANSFER_REGISTRATION_RESPONSE_INVALID");
    }

    requestId = data;

    stage = "execute";

    const execution = await executeSandboxTrainerTransfer(requestId);

    switch (execution.result) {
      case "synchronized":
        return json({
          result: "synchronized",
          executionConfirmed: true,
          requestId: execution.requestId,
          transferId: execution.transferId,
          applicationResult: execution.applicationResult,
          message:
            "De Stripe-testtransfer is geverifieerd en administratief toegepast. Dit bevestigt geen bankuitbetaling.",
        });

      case "not_claimed":
        return json(
          {
            result: "not_claimed",
            executionConfirmed: false,
            requestId,
            message:
              "Deze aanvraag heeft geen claim verkregen. Controleer de bestaande opdracht; ze kan al in verwerking of afgerond zijn. Niet opnieuw aanvragen.",
          },
          409,
        );

      case "disabled":
        return json(
          {
            result: "disabled_after_registration",
            executionConfirmed: false,
            requestId,
            message:
              "De opdracht is geregistreerd, maar de uitvoerder staat uit. Er is vanuit deze uitvoerder geen transfer verzonden. Controleer de opdracht voordat je verdergaat.",
          },
          409,
        );

      case "not_confirmed":
        return json(
          {
            result: "not_confirmed",
            executionConfirmed: false,
            requestId,
            stage: execution.stage,
            diagnosticCode: execution.diagnosticCode,
            transferId: execution.transferId,
            reviewRecorded: execution.reviewRecorded,
            error:
              "De uitkomst is niet volledig bevestigd. De transfer kan al bij Stripe bestaan. Niet opnieuw betalen of een transfer aanvragen; eerst herstelonderzoek uitvoeren.",
          },
          503,
        );
    }
  } catch (error: unknown) {
    console.error("Eerste testtransfer: aanvraag niet bevestigd.", {
      stage,
      requestId,
      message:
        error instanceof Error ? error.message : "Onbekende fout.",
    });

    return json(
      {
        result: "not_confirmed",
        executionConfirmed: false,
        stage,
        ...(requestId ? { requestId } : {}),
        error:
          "De aanvraag kon niet volledig worden bevestigd. Controleer de bestaande administratie voordat je opnieuw probeert.",
      },
      503,
    );
  }
}