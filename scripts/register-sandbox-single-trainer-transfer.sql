BEGIN;

CREATE FUNCTION public.register_sandbox_single_trainer_transfer(
  p_booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_existing_id uuid;
  v_current_id uuid;
  v_request public.trainer_transfer_requests%rowtype;
  v_context jsonb;
  v_request_id uuid;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_REQUIRED';
  END IF;

  /*
   * Bij een bestaande opdracht: opdracht eerst locken.
   * De interne validator neemt daarna de locks op:
   * betaalpoging -> boeking -> slot -> trainer.
   */
  SELECT r.id
  INTO v_existing_id
  FROM public.trainer_transfer_requests AS r
  WHERE r.booking_id = p_booking_id;

  IF v_existing_id IS NOT NULL THEN
    SELECT r.*
    INTO v_request
    FROM public.trainer_transfer_requests AS r
    WHERE r.id = v_existing_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_CHANGED';
    END IF;

    /*
     * Geen hergebruik van een ooit geclaimde, voorbereide,
     * afgehandelde of voor review geblokkeerde opdracht.
     */
    IF v_request.status IS DISTINCT FROM 'queued'
       OR v_request.attempts IS DISTINCT FROM 0
       OR v_request.first_stripe_request_at IS NOT NULL
       OR v_request.stripe_request_payload IS NOT NULL
       OR v_request.stripe_transfer_id IS NOT NULL
       OR v_request.succeeded_at IS NOT NULL
       OR v_request.applied_at IS NOT NULL
       OR v_request.lock_token IS NOT NULL
       OR v_request.locked_until IS NOT NULL
       OR v_request.stripe_source_charge_id IS NOT NULL
       OR v_request.source_verified_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_EXISTING_PROCESSING_REQUIRES_REVIEW';
    END IF;
  END IF;

  /*
   * Geen claimcontext: boeking moet nog pending/eligible zijn.
   * De validator houdt alle verkregen locks tot transactie-einde.
   */
  v_context :=
    public.validate_sandbox_single_transfer_booking_internal(
      p_booking_id,
      NULL::uuid,
      NULL::uuid
    );

  IF jsonb_typeof(v_context) IS DISTINCT FROM 'object'
     OR v_context ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_context ->> 'booking_id' IS DISTINCT FROM p_booking_id::text
     OR v_context -> 'source_package_purchase_id'
          IS DISTINCT FROM 'null'::jsonb
     OR v_context -> 'allocation_consistent'
          IS DISTINCT FROM 'true'::jsonb
     OR v_context -> 'stripe_verification_required'
          IS DISTINCT FROM 'true'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTRATION_CONTEXT_INVALID';
  END IF;

  /*
   * Tijdens lockverwerving kan een andere sessie geregistreerd
   * hebben. Niet na de boekingslock alsnog die opdracht locken:
   * dat zou de afgesproken volgorde omkeren.
   */
  SELECT r.id
  INTO v_current_id
  FROM public.trainer_transfer_requests AS r
  WHERE r.booking_id = p_booking_id;

  IF v_current_id IS DISTINCT FROM v_existing_id THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTRATION_CONTEXT_CHANGED';
  END IF;

  IF v_existing_id IS NOT NULL THEN
    IF v_request.booking_id IS DISTINCT FROM p_booking_id
       OR v_request.source_package_purchase_id IS NOT NULL
       OR v_request.trainer_id::text
            IS DISTINCT FROM v_context ->> 'trainer_id'
       OR v_request.amount_cents IS DISTINCT FROM
            (v_context ->> 'amount_cents')::integer
       OR v_request.currency IS DISTINCT FROM 'eur'
       OR v_request.destination_account_id
            IS DISTINCT FROM v_context ->> 'destination_account_id'
       OR v_request.stripe_payment_intent_id
            IS DISTINCT FROM v_context ->> 'payment_intent_id'
       OR v_request.stripe_livemode IS DISTINCT FROM false
       OR v_request.funds_flow IS DISTINCT FROM 'separate_transfers_v1'
       OR v_request.eligible_at IS DISTINCT FROM
            (v_context ->> 'eligible_at')::timestamptz
       OR v_request.stripe_idempotency_key IS DISTINCT FROM
            'gowtrain-trainer-transfer/' || v_request.id::text
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_EXISTING_REQUEST_MISMATCH';
    END IF;

    RETURN v_request.id;
  END IF;

  v_request_id := gen_random_uuid();

  /*
   * Dit registreert een opdracht voor uitsluitend de sandboxflow.
   *
   * stripe_livemode=false is hier de vereiste uitvoeringsomgeving,
   * NIET een verklaring dat deze functie Stripe heeft gecontroleerd.
   *
   * De actuele Stripe-broncontrole moet nog slagen vóór prepare.
   * Geen source_verified_at, broncharge of payload vooraf invullen.
   */
  INSERT INTO public.trainer_transfer_requests (
    id,
    booking_id,
    trainer_id,
    source_package_purchase_id,
    amount_cents,
    currency,
    destination_account_id,
    stripe_payment_intent_id,
    stripe_livemode,
    funds_flow,
    eligible_at,
    status,
    stripe_idempotency_key
  )
  VALUES (
    v_request_id,
    p_booking_id,
    (v_context ->> 'trainer_id')::uuid,
    NULL,
    (v_context ->> 'amount_cents')::integer,
    'eur',
    v_context ->> 'destination_account_id',
    v_context ->> 'payment_intent_id',
    false,
    'separate_transfers_v1',
    (v_context ->> 'eligible_at')::timestamptz,
    'queued',
    'gowtrain-trainer-transfer/' || v_request_id::text
  );

  /*
   * Unieke constraints blijven beslissend:
   * - één opdracht per boeking;
   * - één onafgehandelde testopdracht per bestemming.
   *
   * Een conflict niet negeren of een bestaande opdracht vervangen.
   */
  RETURN v_request_id;
END;
$function$;

/*
 * Interne registratie, nog geen zelfstandig uitvoerbare RPC
 * voor browsers of service_role.
 *
 * De automatische kandidaatfunctie moet straks registratie
 * en claim samen transactioneel uitvoeren.
 */
REVOKE ALL
ON FUNCTION public.register_sandbox_single_trainer_transfer(uuid)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;