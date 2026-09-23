import { NextRequest, NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

import {
  connectOptions,
  withConnectCors,
} from "@/lib/stripe-connect-cors";
import { buildConnectV2AccountPayload } from "@/lib/stripe-connect-v2-payload";
import { retrieveVerifiedTrainerConnectV2Account } from "@/lib/stripe-connect-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ontbreekt.`);
  }

  return value;
}

const stripeKey = requiredEnv("STRIPE_SECRET_KEY");
const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const stripe = new Stripe(stripeKey, {
  timeout: 10_000,
  maxNetworkRetries: 0,
});

const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

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

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function verifyStoredPayload(
  value: unknown,
  trainerId: string,
  attemptId: string,
): "NL" | "BE" {
  if (!isObject(value) || !isObject(value.identity)) {
    throw new Error("CONNECT_V2_PAYLOAD_INVALID");
  }

  const country = value.identity.country;
  const contactEmail = value.contact_email;
  const displayName = value.display_name;

  if (
    (country !== "NL" && country !== "BE") ||
    typeof contactEmail !== "string" ||
    typeof displayName !== "string"
  ) {
    throw new Error("CONNECT_V2_PAYLOAD_INVALID");
  }

  const expected = buildConnectV2AccountPayload({
    trainerId,
    attemptId,
    contactEmail,
    displayName,
    country,
  });

  if (!isDeepStrictEqual(value, expected)) {
    throw new Error("CONNECT_V2_PAYLOAD_MISMATCH");
  }

  return country;
}

async function handlePost(
  request: NextRequest,
): Promise<NextResponse> {
  let stage = "authentication";
  let attemptId: string | null = null;

  try {
    const authorization =
      request.headers.get("authorization");

    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!token) {
      return json(
        { error: "Je bent niet ingelogd." },
        401,
      );
    }

    const supabaseAuth = createClient(
      supabaseUrl,
      anonKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(token);

    if (userError || !user) {
      return json(
        { error: "Je sessie is verlopen. Log opnieuw in." },
        401,
      );
    }

    if (
      !stripeKey.startsWith("sk_test_") &&
      !stripeKey.startsWith("rk_test_")
    ) {
      return json(
        {
          error:
            "Deze statuscontrole is uitsluitend beschikbaar voor testaccounts.",
        },
        403,
      );
    }

    stage = "trainer_lookup";

    const { data: trainer, error: trainerError } =
      await supabaseAdmin
        .from("trainers")
        .select(
          "id, stripe_account_id, stripe_account_api, stripe_account_livemode",
        )
        .eq("user_id", user.id)
        .eq("approval_status", "approved")
        .eq("is_active", true)
        .maybeSingle();

    if (trainerError) {
      throw new Error("CONNECT_V2_TRAINER_LOOKUP_FAILED");
    }

    if (!trainer) {
      return json(
        {
          error:
            "Geen actief en goedgekeurd trainerprofiel gevonden.",
        },
        403,
      );
    }

    if (!trainer.stripe_account_id) {
      return json(
        {
          code: "CONNECT_ACCOUNT_NOT_LINKED",
          error: "Er is nog geen Stripe-account gekoppeld.",
        },
        409,
      );
    }

    if (
      trainer.stripe_account_api !== "accounts_v2" ||
      trainer.stripe_account_livemode !== false
    ) {
      return json(
        {
          code: "CONNECT_EXISTING_LINK_REQUIRES_REVIEW",
          error:
            "De bestaande koppeling is geen geregistreerde v2-testkoppeling.",
        },
        409,
      );
    }

    stage = "linked_attempt_lookup";

    const { data: attempt, error: attemptError } =
      await supabaseAdmin
        .from("trainer_connect_attempts")
        .select(
          "id, trainer_user_id, stripe_livemode, stripe_request_payload",
        )
        .eq("trainer_id", trainer.id)
        .eq("stripe_account_id", trainer.stripe_account_id)
        .eq("account_api", "accounts_v2")
        .eq("status", "linked")
        .maybeSingle();

    if (attemptError) {
      throw new Error("CONNECT_V2_ATTEMPT_LOOKUP_FAILED");
    }

    if (
      !attempt ||
      attempt.trainer_user_id !== user.id ||
      attempt.stripe_livemode !== false
    ) {
      return json(
        {
          code: "CONNECT_V2_LINKED_ATTEMPT_MISSING",
          error:
            "De registratie van de bestaande accountkoppeling vereist controle.",
        },
        409,
      );
    }

    attemptId = attempt.id;

    stage = "validate_stored_payload";

    const country = verifyStoredPayload(
      attempt.stripe_request_payload,
      trainer.id,
      attempt.id,
    );

    stage = "retrieve_v2_account";

    const verified =
      await retrieveVerifiedTrainerConnectV2Account(
        stripe,
        {
          accountId: trainer.stripe_account_id,
          trainerId: trainer.id,
          attemptId: attempt.id,
          country,
        },
      );

    stage = "store_verified_status";

    // Deze RPC controleert eigenaarschap, approval, account-ID
    // en poging opnieuw onder locks.
    // We gebruiken uitsluitend de bestaande linked-poging.
    const { data: stored, error: storeError } =
      await supabaseAdmin.rpc(
        "link_verified_trainer_connect_v2_account",
        {
          p_attempt_id: attempt.id,
          p_user_id: user.id,
          p_account_id: verified.accountId,
          p_transfers_status: verified.transfersStatus,
          p_payouts_status: verified.payoutsStatus,
          p_checked_at: verified.checkedAt,
        },
      );

    if (storeError || stored !== true) {
      throw new Error("CONNECT_V2_STATUS_STORE_NOT_CONFIRMED");
    }

    stage = "read_stored_status";

    // Lees de werkelijk opgeslagen status terug.
    // Een gelijktijdige nieuwere controle kan voorrang hebben gekregen.
    const { data: current, error: currentError } =
      await supabaseAdmin
        .from("trainers")
        .select(
          "stripe_transfers_status, stripe_payouts_status, stripe_account_checked_at",
        )
        .eq("id", trainer.id)
        .eq("user_id", user.id)
        .eq("approval_status", "approved")
        .eq("is_active", true)
        .eq("stripe_account_id", verified.accountId)
        .eq("stripe_account_api", "accounts_v2")
        .eq("stripe_account_livemode", false)
        .eq("stripe_account_closed", false)
        .maybeSingle();

    if (
      currentError ||
      !current ||
      !current.stripe_account_checked_at
    ) {
      throw new Error("CONNECT_V2_STORED_STATUS_NOT_CONFIRMED");
    }

    return json({
      statusChecked: true,
      transfersStatus: current.stripe_transfers_status,
      payoutsStatus: current.stripe_payouts_status,
      checkedAt: current.stripe_account_checked_at,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Onbekende Connect-fout.";

    const stripeError =
      error instanceof Stripe.errors.StripeError
        ? error
        : null;

    console.error("Connect v2-statuscontrole niet bevestigd:", {
      stage,
      attemptId,
      message,
      stripeRequestId: stripeError?.requestId,
      stripeStatusCode: stripeError?.statusCode,
      stripeCode: stripeError?.code,
      stripeType: stripeError?.type,
    });

    // Geen reset, accountaanmaak of markering als afgewezen.
    // Een mislukte statuscontrole maakt de opgeslagen snapshot
    // niet tot een succesvolle actuele controle.
    return json(
      {
        code: "CONNECT_STATUS_NOT_CONFIRMED",
        stage,
        error:
          "De Stripe-status kon niet worden vernieuwd. De eerder opgeslagen status is geen bevestiging van deze controle.",
      },
      503,
    );
  }
}

/*
 * CORS-preflight.
 * Dit controleert geen Stripe-account en wijzigt geen gegevens.
 */
export function OPTIONS(
  request: NextRequest,
): NextResponse {
  return connectOptions(request);
}

/*
 * De bestaande statuscontrole, met CORS-afhandeling
 * voor normale antwoorden en foutmeldingen.
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  return withConnectCors(request, handlePost);
}