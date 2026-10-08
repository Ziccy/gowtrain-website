BEGIN;

CREATE FUNCTION public.claim_sandbox_single_trainer_transfer(
  p_request_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request public.trainer_transfer_requests%rowtype;
  v_context jsonb;
  v_now timestamptz;
  v_lock_token uuid;
  v_locked_until timestamptz;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_REQUIRED';
  END IF;

  IF p_lease_seconds IS NULL
     OR p_lease_seconds < 60
     OR p_lease_seconds > 900
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_LEASE_DURATION_INVALID';
  END IF;

  /*
   * Eerst de opdracht.
   * De validator lockt daarna:
   * betaalpoging -> boeking -> slot -> trainer.
   */
  SELECT r.*
  INTO v_request
  FROM public.trainer_transfer_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_MISSING';
  END IF;

  IF v_request.source_package_purchase_id IS NOT NULL
     OR v_request.stripe_livemode IS DISTINCT FROM false
     OR v_request.funds_flow IS DISTINCT FROM 'separate_transfers_v1'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_CONTEXT_INVALID';
  END IF;

  /*
   * Geen herclaim van processing, review_required,
   * succeeded of cancelled, ongeacht de lease.
   */
  IF v_request.status IS DISTINCT FROM 'queued' THEN
    RETURN NULL;
  END IF;

  IF v_request.attempts IS DISTINCT FROM 0
     OR v_request.lock_token IS NOT NULL
     OR v_request.locked_until IS NOT NULL
     OR v_request.first_stripe_request_at IS NOT NULL
     OR v_request.stripe_request_payload IS NOT NULL
     OR v_request.stripe_source_charge_id IS NOT NULL
     OR v_request.source_verified_at IS NOT NULL
     OR v_request.stripe_transfer_id IS NOT NULL
     OR v_request.succeeded_at IS NOT NULL
     OR v_request.applied_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_PREVIOUS_PROCESSING';
  END IF;

  IF v_request.stripe_idempotency_key IS DISTINCT FROM
       'gowtrain-trainer-transfer/' || v_request.id::text
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_IDEMPOTENCY_KEY_INVALID';
  END IF;

  IF v_request.available_at IS NULL
     OR NOT isfinite(v_request.available_at)
     OR v_request.eligible_at IS NULL
     OR NOT isfinite(v_request.eligible_at)
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_SCHEDULE_INVALID';
  END IF;

  v_now := clock_timestamp();

  IF v_request.available_at > v_now
     OR v_request.eligible_at > v_now
  THEN
    RETURN NULL;
  END IF;

  /*
   * Nog geen claimcontext:
   * de boeking moet op dit moment pending/eligible zijn.
   *
   * De opdrachtlock is hierboven al verkregen.
   * De validator controleert de actuele databasegeschiktheid
   * en houdt de overige locks vast tot transactie-einde.
   */
  v_context :=
    public.validate_sandbox_single_transfer_booking_internal(
      v_request.booking_id,
      NULL::uuid,
      NULL::uuid
    );

  IF jsonb_typeof(v_context) IS DISTINCT FROM 'object'
     OR v_context ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_context ->> 'booking_id'
          IS DISTINCT FROM v_request.booking_id::text
     OR v_context -> 'source_package_purchase_id'
          IS DISTINCT FROM 'null'::jsonb
     OR v_context ->> 'trainer_id'
          IS DISTINCT FROM v_request.trainer_id::text
     OR v_context -> 'amount_cents'
          IS DISTINCT FROM to_jsonb(v_request.amount_cents)
     OR v_context ->> 'currency'
          IS DISTINCT FROM v_request.currency
     OR v_context ->> 'destination_account_id'
          IS DISTINCT FROM v_request.destination_account_id
     OR v_context ->> 'payment_intent_id'
          IS DISTINCT FROM v_request.stripe_payment_intent_id
     OR (v_context ->> 'eligible_at')::timestamptz
          IS DISTINCT FROM v_request.eligible_at
     OR v_context -> 'allocation_consistent'
          IS DISTINCT FROM 'true'::jsonb
     OR v_context -> 'stripe_verification_required'
          IS DISTINCT FROM 'true'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_CONTEXT_MISMATCH';
  END IF;

  /*
   * Lease begint pas nadat de controles en lockverwerving
   * zijn afgerond.
   */
  v_now := clock_timestamp();
  v_lock_token := gen_random_uuid();
  v_locked_until :=
    v_now + make_interval(secs => p_lease_seconds);

  UPDATE public.bookings
  SET
    trainer_payout_status = 'processing',
    trainer_payout_last_error = NULL
  WHERE id = v_request.booking_id
    AND package_purchase_id IS NULL
    AND trainer_id = v_request.trainer_id
    AND stripe_payment_intent_id = v_request.stripe_payment_intent_id
    AND trainer_net_amount_cents = v_request.amount_cents
    AND currency = v_request.currency
    AND trainer_payout_status IN ('pending', 'eligible')
    AND stripe_transfer_id IS NULL
    AND trainer_paid_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_CLAIM_NOT_CONFIRMED';
  END IF;

  UPDATE public.trainer_transfer_requests
  SET
    status = 'processing',
    attempts = attempts + 1,
    lock_token = v_lock_token,
    locked_until = v_locked_until,
    last_error = NULL,
    updated_at = v_now
  WHERE id = v_request.id
    AND status = 'queued'
    AND attempts = 0
    AND lock_token IS NULL
    AND locked_until IS NULL
    AND first_stripe_request_at IS NULL
    AND stripe_request_payload IS NULL
    AND stripe_transfer_id IS NULL
    AND succeeded_at IS NULL
    AND applied_at IS NULL
  RETURNING *
  INTO v_request;

  IF NOT FOUND THEN
    /*
     * Exception draait ook de bovenstaande boekingswijziging
     * terug. Geen half toegepaste claim.
     */
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_CLAIM_NOT_CONFIRMED';
  END IF;

  /*
   * Dit is uitsluitend een databaseclaim.
   *
   * stripe_livemode=false is de vereiste uitvoeringsomgeving.
   * Stripe-bron, Connect-status en gemengde transferhistorie
   * moeten daarna actueel worden geverifieerd vóór prepare.
   *
   * De claimtoken nooit loggen of aan browsers doorgeven.
   */
  RETURN jsonb_build_object(
    'source_kind', 'single_lesson',
    'request_id', v_request.id,
    'booking_id', v_request.booking_id,
    'trainer_id', v_request.trainer_id,
    'source_package_purchase_id', NULL,
    'amount_cents', v_request.amount_cents,
    'currency', v_request.currency,
    'destination_account_id', v_request.destination_account_id,
    'stripe_payment_intent_id', v_request.stripe_payment_intent_id,
    'stripe_livemode', v_request.stripe_livemode,
    'funds_flow', v_request.funds_flow,
    'stripe_idempotency_key', v_request.stripe_idempotency_key,
    'lock_token', v_request.lock_token,
    'locked_until', v_request.locked_until,
    'attempts', v_request.attempts
  );
END;
$function$;

/*
 * Interne claimfunctie.
 * De automatische kandidaatfunctie wordt de gecontroleerde ingang.
 */
REVOKE ALL
ON FUNCTION public.claim_sandbox_single_trainer_transfer(uuid,integer)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;