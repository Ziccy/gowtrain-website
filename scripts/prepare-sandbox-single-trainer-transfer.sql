BEGIN;

CREATE FUNCTION public.prepare_sandbox_single_trainer_transfer(
  p_request_id uuid,
  p_lock_token uuid,
  p_source jsonb,
  p_destination jsonb,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request public.trainer_transfer_requests%rowtype;
  v_context jsonb;
  v_history_result jsonb;
  v_scan jsonb;
  v_expected_payload jsonb;

  v_charge_id text;
  v_source_checked_at timestamptz;
  v_destination_checked_at timestamptz;
  v_scan_started_at timestamptz;
  v_scan_finished_at timestamptz;
  v_now timestamptz;
BEGIN
  IF p_request_id IS NULL OR p_lock_token IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_CLAIM_REQUIRED';
  END IF;

  IF jsonb_typeof(p_source) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_destination) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_INPUT_INVALID';
  END IF;

  SELECT r.*
  INTO v_request
  FROM public.trainer_transfer_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_MISSING';
  END IF;

  /*
   * Een onzekere of eerdere voorbereiding nooit opnieuw vrijgeven.
   * Ook niet met dezelfde payload of idempotency-key.
   */
  IF v_request.first_stripe_request_at IS NOT NULL
     OR v_request.stripe_request_payload IS NOT NULL
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ALREADY_PREPARED';
  END IF;

  /*
   * Opdrachtlock is al verkregen.
   * Daarna: betaalpoging -> boeking -> slot -> trainer.
   *
   * Controleert ook claimtoken, lease, eerste poging,
   * bedragen, transfermoment, refunds, issues en Connect-context.
   */
  v_context :=
    public.validate_sandbox_single_transfer_booking_internal(
      v_request.booking_id,
      p_request_id,
      p_lock_token
    );

  IF jsonb_typeof(v_context) IS DISTINCT FROM 'object'
     OR v_context ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_context ->> 'booking_id'
          IS DISTINCT FROM v_request.booking_id::text
     OR v_context ->> 'trainer_id'
          IS DISTINCT FROM v_request.trainer_id::text
     OR v_context -> 'source_package_purchase_id'
          IS DISTINCT FROM 'null'::jsonb
     OR v_context -> 'allocation_consistent'
          IS DISTINCT FROM 'true'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_CONTEXT_INVALID';
  END IF;

  /*
   * p_source moet afkomstig zijn uit de vertrouwde server-side
   * Stripe-verificatie. PostgreSQL haalt Stripe niet zelf op.
   *
   * Vergelijk die waarneming met de opnieuw gecontroleerde
   * databasecontext, inclusief de oorspronkelijke betaalroute.
   */
  v_charge_id := p_source ->> 'chargeId';

  IF v_charge_id IS NULL
     OR v_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$'
     OR p_source ->> 'sourceKind' IS DISTINCT FROM 'single_lesson'
     OR p_source ->> 'bookingId'
          IS DISTINCT FROM v_request.booking_id::text
     OR p_source ->> 'trainerId'
          IS DISTINCT FROM v_request.trainer_id::text
     OR p_source ->> 'paymentChannel'
          IS DISTINCT FROM v_context ->> 'payment_channel'
     OR p_source -> 'paymentAttemptId'
          IS DISTINCT FROM v_context -> 'payment_attempt_id'
     OR p_source -> 'checkoutSessionId'
          IS DISTINCT FROM v_context -> 'checkout_session_id'
     OR p_source ->> 'paymentIntentId'
          IS DISTINCT FROM v_request.stripe_payment_intent_id
     OR p_source ->> 'paymentIntentId'
          IS DISTINCT FROM v_context ->> 'payment_intent_id'
     OR p_source -> 'amountCents'
          IS DISTINCT FROM v_context -> 'total_amount_cents'
     OR p_source ->> 'currency' IS DISTINCT FROM 'eur'
     OR p_source -> 'livemode' IS DISTINCT FROM 'false'::jsonb
     OR p_source ->> 'fundsFlow'
          IS DISTINCT FROM 'separate_transfers_v1'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_SOURCE_MISMATCH';
  END IF;

  IF (
       v_context ->> 'stored_charge_id' IS NOT NULL
       AND v_context ->> 'stored_charge_id'
             IS DISTINCT FROM v_charge_id
     )
     OR (
       v_request.stripe_source_charge_id IS NOT NULL
       AND v_request.stripe_source_charge_id
             IS DISTINCT FROM v_charge_id
     )
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_CHARGE_MISMATCH';
  END IF;

  IF p_destination ->> 'accountId'
       IS DISTINCT FROM v_request.destination_account_id
     OR p_destination ->> 'trainerId'
       IS DISTINCT FROM v_request.trainer_id::text
     OR p_destination ->> 'attemptId'
       IS DISTINCT FROM v_context ->> 'connect_attempt_id'
     OR p_destination -> 'livemode'
       IS DISTINCT FROM 'false'::jsonb
     OR p_destination -> 'closed'
       IS DISTINCT FROM 'false'::jsonb
     OR p_destination ->> 'transfersStatus'
       IS DISTINCT FROM 'active'
     OR p_destination -> 'reviewReasons'
       IS DISTINCT FROM '[]'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_DESTINATION_MISMATCH';
  END IF;

  /*
   * Zelfstandig de volledige gemengde historie controleren.
   * Geen eerdere transfer uit deze losse-lesbetaling toestaan.
   */
  v_scan := p_source -> 'transferInspection';

  v_history_result :=
    public.validate_claimed_sandbox_single_transfer_history(
      p_request_id,
      p_lock_token,
      v_charge_id,
      v_scan
    );

  IF jsonb_typeof(v_history_result) IS DISTINCT FROM 'object'
     OR v_history_result -> 'history_verified'
          IS DISTINCT FROM 'true'::jsonb
     OR v_history_result ->> 'source_kind'
          IS DISTINCT FROM 'single_lesson'
     OR v_history_result ->> 'request_id'
          IS DISTINCT FROM p_request_id::text
     OR v_history_result -> 'source_transferred_cents'
          IS DISTINCT FROM '0'::jsonb
     OR v_history_result -> 'current_amount_cents'
          IS DISTINCT FROM to_jsonb(v_request.amount_cents)
     OR v_history_result -> 'source_total_including_current_cents'
          IS DISTINCT FROM to_jsonb(v_request.amount_cents)
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_HISTORY_NOT_CONFIRMED';
  END IF;

  v_source_checked_at := (p_source ->> 'checkedAt')::timestamptz;
  v_destination_checked_at :=
    (p_destination ->> 'checkedAt')::timestamptz;
  v_scan_started_at := (v_scan ->> 'checkedAt')::timestamptz;
  v_scan_finished_at := (v_scan ->> 'finishedAt')::timestamptz;

  v_now := clock_timestamp();

  IF v_source_checked_at IS NULL
     OR v_destination_checked_at IS NULL
     OR v_scan_started_at IS NULL
     OR v_scan_finished_at IS NULL
     OR NOT isfinite(v_source_checked_at)
     OR NOT isfinite(v_destination_checked_at)
     OR NOT isfinite(v_scan_started_at)
     OR NOT isfinite(v_scan_finished_at)
     OR v_source_checked_at < v_now - interval '2 minutes'
     OR v_destination_checked_at < v_now - interval '2 minutes'
     OR v_scan_started_at < v_now - interval '2 minutes'
     OR v_scan_started_at < v_source_checked_at
     OR v_scan_finished_at < v_scan_started_at
     OR v_source_checked_at > v_now + interval '5 seconds'
     OR v_destination_checked_at > v_now + interval '5 seconds'
     OR v_scan_started_at > v_now + interval '5 seconds'
     OR v_scan_finished_at > v_now + interval '5 seconds'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_VERIFICATION_TIMES_INVALID';
  END IF;

  /*
   * Exact dezelfde payload als:
   * buildSingleLessonTrainerTransferPayload.
   *
   * Geen extra parameters of afwijkende metadata accepteren.
   */
  v_expected_payload := jsonb_build_object(
    'amount', v_request.amount_cents,
    'currency', 'eur',
    'destination', v_request.destination_account_id,
    'source_transaction', v_charge_id,
    'transfer_group', 'gowtrain-single/' || v_request.booking_id::text,
    'metadata', jsonb_build_object(
      'gowtrain_transfer_request_id', v_request.id::text,
      'gowtrain_booking_id', v_request.booking_id::text,
      'gowtrain_trainer_id', v_request.trainer_id::text,
      'gowtrain_payment_intent_id', v_request.stripe_payment_intent_id,
      'gowtrain_funds_flow', 'separate_transfers_v1',
      'gowtrain_booking_type', 'single_lesson'
    )
  );

  IF p_payload IS DISTINCT FROM v_expected_payload THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_PAYLOAD_MISMATCH';
  END IF;

  v_now := clock_timestamp();

  IF v_request.locked_until <= v_now + interval '30 seconds' THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARE_LEASE_TOO_SHORT';
  END IF;

  /*
   * Eenmalige vrijgave.
   *
   * first_stripe_request_at betekent: verzending is mogelijk.
   * Het bewijst NIET dat Stripe de aanvraag ontvangen heeft.
   *
   * Bij een verloren prepare-response niet alsnog verzenden
   * door deze payload terug te lezen.
   */
  UPDATE public.trainer_transfer_requests
  SET
    stripe_source_charge_id = v_charge_id,
    source_verified_at = v_source_checked_at,
    stripe_request_payload = p_payload,
    first_stripe_request_at = v_now,
    next_reconciliation_at = v_now + interval '5 minutes',
    last_error = NULL,
    updated_at = v_now
  WHERE id = v_request.id
    AND source_package_purchase_id IS NULL
    AND status = 'processing'
    AND attempts = 1
    AND lock_token = p_lock_token
    AND locked_until > v_now + interval '30 seconds'
    AND first_stripe_request_at IS NULL
    AND stripe_request_payload IS NULL
    AND stripe_source_charge_id IS NULL
    AND source_verified_at IS NULL
    AND stripe_transfer_id IS NULL
    AND succeeded_at IS NULL
    AND applied_at IS NULL
  RETURNING *
  INTO v_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PREPARATION_NOT_CONFIRMED';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'booking_id', v_request.booking_id,
    'stripe_idempotency_key', v_request.stripe_idempotency_key,
    'stripe_request_payload', v_request.stripe_request_payload,
    'first_stripe_request_at', v_request.first_stripe_request_at,
    'lock_token', v_request.lock_token,
    'locked_until', v_request.locked_until
  );
END;
$function$;

/*
 * Voorlopig intern: nog geen service-role- of browseringang.
 * De uitvoeringskoppeling en benodigde rechten volgen pas
 * bij de gecontroleerde installatie.
 */
REVOKE ALL
ON FUNCTION public.prepare_sandbox_single_trainer_transfer(
  uuid, uuid, jsonb, jsonb, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;