import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { isDeepStrictEqual } from "node:util";
import { buildConnectV2AccountPayload } from "@/lib/stripe-connect-v2-payload";
import { verifyConnectV2EventNotification } from "@/lib/stripe-connect-v2-event";
import { retrieveTrainerConnectV2StatusSnapshot } from "@/lib/stripe-connect-v2-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ontbreekt.`);
  return value;
}

const stripeKey = requiredEnv("STRIPE_SECRET_KEY");

const stripe = new Stripe(stripeKey, {
  timeout: 10_000,
  maxNetworkRetries: 0,
});

const supabaseAdmin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
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
    headers: { "Cache-Control": "no-store" },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
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
    country,
    contactEmail,
    displayName,
  });

  if (!isDeepStrictEqual(value, expected)) {
    throw new Error("CONNECT_V2_PAYLOAD_MISMATCH");
  }

  return country;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return json(
      { error: "Stripe-signature ontbreekt." },
      400,
    );
  }

  /*
   * Apart secret voor deze thin-eventbestemming.
   * Geen fallback naar STRIPE_WEBHOOK_SECRET.
   *
   * Pas tijdens de request lezen: de route kan vóór het
   * aanmaken van de bestemming worden gebouwd en gedeployd.
   */
  const signingSecret =
    process.env.STRIPE_CONNECT_V2_WEBHOOK_SECRET?.trim();

  if (!signingSecret) {
    console.error("Connect v2-webhooksecret ontbreekt.");

    return json(
      { error: "De Connect-eventbestemming is nog niet geconfigureerd." },
      503,
    );
  }

  if (
    !stripeKey.startsWith("sk_test_") &&
    !stripeKey.startsWith("rk_test_")
  ) {
    return json(
      { error: "Deze eventverwerking is uitsluitend voor testaccounts." },
      503,
    );
  }

  let parsed: ReturnType<typeof verifyConnectV2EventNotification>;

  try {
    const rawBody = await request.text();

    parsed = verifyConnectV2EventNotification(
      stripe,
      rawBody,
      signature,
      signingSecret,
    );
  } catch {
    // Geen raw body, signature of secret loggen.
    console.warn("Connect v2-notificatieverificatie mislukt.");

    return json(
      { error: "De Connect-notificatie kon niet worden geverifieerd." },
      400,
    );
  }

  if (parsed.kind === "ping") {
    return json({
      received: true,
      kind: "ping",
      accountStatusApplied: false,
    });
  }

  if (parsed.kind === "ignored") {
    console.warn("Niet ondersteund Connect v2-event overgeslagen:", {
      eventId: parsed.eventId,
      eventType: parsed.eventType,
    });

    return json({
      received: true,
      ignored: true,
      accountStatusApplied: false,
    });
  }

  let stage = "event_context";

  try {
    /*
     * Deze bestemming is voor rechtstreeks door ons platform
     * aangemaakte v2-accounts.
     *
     * Een aanwezige context niet negeren en ook niet blind
     * gebruiken voor een request in een andere accountomgeving.
     */
    if (parsed.notification.context != null) {
      throw new Error("CONNECT_V2_EVENT_CONTEXT_NOT_SUPPORTED");
    }

    stage = "retrieve_event";

    const notification = parsed.notification;

    if (
      !("fetchEvent" in notification) ||
      typeof notification.fetchEvent !== "function"
    ) {
      throw new Error("CONNECT_V2_EVENT_FETCH_UNAVAILABLE");
    }

    const event = await notification.fetchEvent();

    if (
      event.id !== parsed.eventId ||
      event.object !== "v2.core.event" ||
      event.type !== parsed.eventType ||
      event.livemode !== false ||
      event.context != null
    ) {
      throw new Error("CONNECT_V2_FETCHED_EVENT_MISMATCH");
    }

    const related: unknown =
      "related_object" in event ? event.related_object : undefined;

    if (
      !isObject(related) ||
      related.type !== "v2.core.account" ||
      related.id !== parsed.accountId
    ) {
      throw new Error("CONNECT_V2_FETCHED_ACCOUNT_REFERENCE_MISMATCH");
    }

    stage = "stored_account_lookup";

    // Geen trainer zoeken of koppelen via Stripe-metadata.
    const { data: trainer, error: trainerError } = await supabaseAdmin
      .from("trainers")
      .select(
        "id, user_id, stripe_account_id, stripe_account_api, stripe_account_livemode",
      )
      .eq("stripe_account_id", parsed.accountId)
      .maybeSingle();

    if (trainerError) {
      throw new Error("CONNECT_V2_TRAINER_LOOKUP_FAILED");
    }

    /*
     * Een event kan vóór de databasekoppeling binnenkomen.
     * Niet succesvol afvinken: laat Stripe later opnieuw afleveren.
     * Een blijvend onbekend account vereist afzonderlijke controle.
     */
    if (!trainer) {
      throw new Error("CONNECT_V2_STORED_ACCOUNT_LINK_MISSING");
    }

    if (
      trainer.stripe_account_api !== "accounts_v2" ||
      trainer.stripe_account_livemode !== false
    ) {
      throw new Error("CONNECT_V2_STORED_ACCOUNT_CONTEXT_MISMATCH");
    }

    stage = "linked_attempt_lookup";

    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from("trainer_connect_attempts")
      .select(
        "id, trainer_user_id, stripe_livemode, stripe_request_payload",
      )
      .eq("trainer_id", trainer.id)
      .eq("stripe_account_id", parsed.accountId)
      .eq("account_api", "accounts_v2")
      .eq("status", "linked")
      .maybeSingle();

    if (attemptError) {
      throw new Error("CONNECT_V2_ATTEMPT_LOOKUP_FAILED");
    }

    if (
      !attempt ||
      attempt.trainer_user_id !== trainer.user_id ||
      attempt.stripe_livemode !== false
    ) {
      throw new Error("CONNECT_V2_LINKED_ATTEMPT_MISSING");
    }

    stage = "validate_stored_payload";

    const country = verifyStoredPayload(
      attempt.stripe_request_payload,
      trainer.id,
      attempt.id,
    );

    stage = "retrieve_current_account";

    const snapshot = await retrieveTrainerConnectV2StatusSnapshot(
      stripe,
      {
        accountId: parsed.accountId,
        trainerId: trainer.id,
        attemptId: attempt.id,
        country,
      },
    );

    /*
     * Een sluitingsevent niet succesvol verwerken wanneer de
     * actuele retrieve die sluiting nog niet bevestigt.
     */
    if (
      parsed.eventType === "v2.core.account.closed" &&
      !snapshot.closed
    ) {
      throw new Error("CONNECT_V2_CLOSURE_NOT_CONFIRMED");
    }

    stage = "store_current_status";

    const { data: result, error: storeError } = await supabaseAdmin.rpc(
      "sync_verified_trainer_connect_v2_status",
      {
        p_trainer_id: trainer.id,
        p_attempt_id: attempt.id,
        p_account_id: snapshot.accountId,
        p_closed: snapshot.closed,
        p_transfers_status: snapshot.transfersStatus,
        p_payouts_status: snapshot.payoutsStatus,
        p_checked_at: snapshot.checkedAt,
      },
    );

    if (storeError) {
      console.error("Connect v2-statusopslag mislukt:", {
        eventId: parsed.eventId,
        databaseCode: storeError.code,
      });

      throw new Error("CONNECT_V2_STATUS_STORE_FAILED");
    }

    if (
      !isObject(result) ||
      !["applied", "stale_ignored", "closed_preserved"].includes(
        String(result.result),
      )
    ) {
      throw new Error("CONNECT_V2_STATUS_STORE_NOT_CONFIRMED");
    }

    /*
     * Bij configuratieafwijkingen geeft de helper NULL-capabilities
     * door. Die zijn hierboven veilig aangeboden aan de RPC.
     *
     * Geen succesvolle eventafhandeling claimen zolang controle
     * nodig is. Stripe kan retryen; een blijvende afwijking vraagt
     * beheeropvolging. Er is nog geen aparte adminwaarschuwing.
     */
    if (snapshot.reviewReasons.length > 0) {
      console.error("Connect v2-account vereist controle:", {
        eventId: parsed.eventId,
        accountId: parsed.accountId,
        trainerId: trainer.id,
        result: result.result,
        reviewReasons: snapshot.reviewReasons,
      });

      return json(
        {
          error: "De accountconfiguratie vereist controle.",
          code: "CONNECT_V2_ACCOUNT_REQUIRES_REVIEW",
        },
        503,
      );
    }

    console.log("Connect v2-statusverwerking bevestigd:", {
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      accountId: parsed.accountId,
      trainerId: trainer.id,
      result: result.result,
      closed: result.closed,
      checkedAt: result.checked_at,
    });

    return json({
      received: true,
      eventId: parsed.eventId,
      result: result.result,
      accountStatusApplied: result.result === "applied",
    });
  } catch (error: unknown) {
    const stripeError =
      error instanceof Stripe.errors.StripeError ? error : null;

    console.error("Connect v2-eventverwerking niet bevestigd:", {
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      accountId: parsed.accountId,
      stage,
      message:
        error instanceof Error ? error.message : "Onbekende fout.",
      stripeRequestId: stripeError?.requestId,
      stripeStatusCode: stripeError?.statusCode,
      stripeCode: stripeError?.code,
    });

    return json(
      {
        error: "De Connect-statusverwerking kon niet worden bevestigd.",
      },
      503,
    );
  }
}