BEGIN;

CREATE FUNCTION public.read_claimed_sandbox_single_transfer_history(
  p_request_id uuid,
  p_lock_token uuid,
  p_source_charge_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request public.trainer_transfer_requests%rowtype;
  v_context jsonb;
  v_history jsonb;
  v_own_count bigint;
  v_now timestamptz;
BEGIN
  IF p_request_id IS NULL
     OR p_lock_token IS NULL
     OR p_source_charge_id IS NULL
     OR p_source_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_HISTORY_INPUT_INVALID';
  END IF;

  -- Opdracht vóór betaalpoging, boeking, slot en trainer.
  SELECT r.*
  INTO v_request
  FROM public.trainer_transfer_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_MISSING';
  END IF;

  IF v_request.source_package_purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PACKAGE_NOT_ALLOWED';
  END IF;

  /*
   * Controleert onder locks:
   * - eigen processing-claim met geldig token en lease;
   * - attempts = 1 en nog niet voorbereid;
   * - actuele boeking, betaalpoging, bedragen en planning;
   * - database-refunds, issues en Connect-koppeling.
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
     OR v_context ->> 'payment_intent_id'
          IS DISTINCT FROM v_request.stripe_payment_intent_id
     OR v_context ->> 'destination_account_id'
          IS DISTINCT FROM v_request.destination_account_id
     OR v_context -> 'amount_cents'
          IS DISTINCT FROM to_jsonb(v_request.amount_cents)
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_HISTORY_CONTEXT_INVALID';
  END IF;

  /*
   * Een bestaande bronverwijzing nooit vervangen.
   * Bij legacy Checkout kan de boekingscharge ontbreken.
   * In dat geval moet de backend deze charge zelfstandig bij
   * Stripe hebben gekoppeld aan de oorspronkelijke PaymentIntent.
   */
  IF (
       v_request.stripe_source_charge_id IS NOT NULL
       AND v_request.stripe_source_charge_id
             IS DISTINCT FROM p_source_charge_id
     )
     OR (
       v_context ->> 'stored_charge_id' IS NOT NULL
       AND v_context ->> 'stored_charge_id'
             IS DISTINCT FROM p_source_charge_id
     )
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_HISTORY_CHARGE_MISMATCH';
  END IF;

  /*
   * Alle relevante opdrachten lezen, inclusief de eigen claim.
   * De eerder verkregen locks blijven behouden.
   *
   * Geen filter op status of bronsoort:
   * onzekere opdrachten en pakkettransfers blijven zichtbaar.
   */
  v_history :=
    public.read_sandbox_single_trainer_transfer_history(
      v_request.booking_id,
      p_source_charge_id
    );

  IF jsonb_typeof(v_history) IS DISTINCT FROM 'object'
     OR v_history ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_history ->> 'booking_id'
          IS DISTINCT FROM v_request.booking_id::text
     OR v_history -> 'purchase_id' IS DISTINCT FROM 'null'::jsonb
     OR v_history ->> 'trainer_id'
          IS DISTINCT FROM v_request.trainer_id::text
     OR v_history ->> 'payment_intent_id'
          IS DISTINCT FROM v_request.stripe_payment_intent_id
     OR v_history ->> 'source_charge_id'
          IS DISTINCT FROM p_source_charge_id
     OR v_history ->> 'destination_account_id'
          IS DISTINCT FROM v_request.destination_account_id
     OR v_history -> 'source_total_amount_cents'
          IS DISTINCT FROM v_context -> 'total_amount_cents'
     OR v_history -> 'source_trainer_net_amount_cents'
          IS DISTINCT FROM to_jsonb(v_request.amount_cents)
     OR v_history -> 'stripe_verification_required'
          IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(v_history -> 'requests')
          IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_history -> 'orphan_bookings')
          IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_HISTORY_RESPONSE_INVALID';
  END IF;

  IF v_history -> 'request_count' IS DISTINCT FROM
       to_jsonb(jsonb_array_length(v_history -> 'requests'))
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_HISTORY_COUNT_INVALID';
  END IF;

  IF v_history -> 'orphan_bookings' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ORPHAN_HISTORY_REQUIRES_REVIEW';
  END IF;

  /*
   * Precies één eigen rij; niet alleen één passende rij naast
   * eventuele dubbele entries met dezelfde opdracht-ID.
   */
  SELECT count(*)
  INTO v_own_count
  FROM jsonb_array_elements(v_history -> 'requests') AS item(value)
  WHERE item.value #>> '{request,id}' = v_request.id::text;

  IF v_own_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_OWN_HISTORY_NOT_UNIQUE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_history -> 'requests') AS item(value)
    WHERE item.value #>> '{request,id}' = v_request.id::text
      AND item.value #>> '{request,booking_id}' =
            v_request.booking_id::text
      AND item.value #>> '{request,status}' = 'processing'
      AND item.value #> '{request,attempts}' = '1'::jsonb
      AND item.value #> '{request,source_package_purchase_id}'
            = 'null'::jsonb
      AND item.value #>> '{booking,id}' = v_request.booking_id::text
      AND item.value #>> '{booking,trainer_payout_status}' = 'processing'
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_OWN_HISTORY_CONTEXT_INVALID';
  END IF;

  v_now := clock_timestamp();

  IF v_request.locked_until <= v_now THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_EXPIRED';
  END IF;

  /*
   * Geen token teruggeven en geen Stripe-verificatie claimen.
   * claim_verified betreft uitsluitend de databaseclaim.
   */
  RETURN jsonb_build_object(
    'claim_verified', true,
    'source_kind', 'single_lesson',
    'request_id', v_request.id,
    'booking_id', v_request.booking_id,
    'purchase_id', NULL,
    'destination_account_id', v_request.destination_account_id,
    'locked_until', v_request.locked_until,
    'checked_at', v_now,
    'history', v_history
  );
END;
$function$;

REVOKE ALL
ON FUNCTION public.read_claimed_sandbox_single_transfer_history(
  uuid, uuid, text
)
FROM PUBLIC, anon, authenticated, service_role;

/*
 * Backend mag inspecteren met het daadwerkelijk verkregen token.
 * Geen registratie, nieuwe claim of Stripe-write.
 */
GRANT EXECUTE
ON FUNCTION public.read_claimed_sandbox_single_transfer_history(
  uuid, uuid, text
)
TO service_role;

COMMIT;