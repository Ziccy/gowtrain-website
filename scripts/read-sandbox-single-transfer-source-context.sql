BEGIN;

CREATE FUNCTION public.read_sandbox_single_transfer_source_context(
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking public.bookings%rowtype;
  v_slot public.availability_slots%rowtype;
  v_attempt public.single_lesson_payment_attempts%rowtype;
  v_has_attempt boolean;
  v_channel text;
  v_expected_commission integer;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_REQUIRED';
  END IF;

  SELECT b.*
  INTO v_booking
  FROM public.bookings AS b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_MISSING';
  END IF;

  IF v_booking.package_purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PACKAGE_NOT_ALLOWED';
  END IF;

  SELECT s.*
  INTO v_slot
  FROM public.availability_slots AS s
  WHERE s.id = v_booking.slot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SLOT_MISSING';
  END IF;

  IF v_slot.package_id IS NOT NULL
     OR v_slot.trainer_id IS DISTINCT FROM v_booking.trainer_id
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SLOT_CONTEXT_INVALID';
  END IF;

  IF v_booking.paid_at IS NULL
     OR NOT isfinite(v_booking.paid_at)
     OR v_booking.player_id IS NULL
     OR v_booking.currency IS DISTINCT FROM 'eur'
     OR v_booking.stripe_payment_intent_id IS NULL
     OR v_booking.stripe_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PAYMENT_CONTEXT_INVALID';
  END IF;

  /*
   * Uitsluitend de vastgelegde financiële verdeling controleren.
   * Niet vergelijken met een later gewijzigde slotprijs of
   * het huidige commissiepercentage op het trainerprofiel.
   *
   * Dit is een consistentiecontrole, geen bewijs dat deze
   * boekingsvelden historisch onveranderd zijn gebleven.
   */
  IF v_booking.total_price_cents IS NULL
     OR v_booking.total_price_cents <= 0
     OR v_booking.commission_rate_bps IS NULL
     OR v_booking.commission_rate_bps < 0
     OR v_booking.commission_rate_bps > 3000
     OR v_booking.commission_amount_cents IS NULL
     OR v_booking.commission_amount_cents < 0
     OR v_booking.trainer_net_amount_cents IS NULL
     OR v_booking.trainer_net_amount_cents <= 0
     OR v_booking.total_price_cents::bigint IS DISTINCT FROM (
       v_booking.commission_amount_cents::bigint
       + v_booking.trainer_net_amount_cents::bigint
     )
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_AMOUNTS_INVALID';
  END IF;

  v_expected_commission := round(
    v_booking.total_price_cents::numeric
    * v_booking.commission_rate_bps::numeric
    / 10000
  )::integer;

  IF v_booking.commission_amount_cents
       IS DISTINCT FROM v_expected_commission
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ALLOCATION_MISMATCH';
  END IF;

  /*
   * Geen ontbrekende planning aanvullen of gewijzigde lestijden
   * stilzwijgend accepteren. Toekomstige transfergrens mag wel:
   * deze reader geeft geen toestemming om uit te voeren.
   */
  IF v_booking.original_starts_at IS NULL
     OR NOT isfinite(v_booking.original_starts_at)
     OR v_slot.starts_at IS DISTINCT FROM v_booking.original_starts_at
     OR v_booking.trainer_payout_eligible_at IS NULL
     OR NOT isfinite(v_booking.trainer_payout_eligible_at)
     OR v_booking.trainer_payout_eligible_at IS DISTINCT FROM
          v_booking.original_starts_at + interval '24 hours'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PLANNING_INVALID';
  END IF;

  /*
   * Iedere geregistreerde refund op boeking of dezelfde betaling
   * blokkeert deze broncontrole, ongeacht refundopdrachtstatus.
   *
   * Geen refundrijlocks: de uitvoerende validatie zal deze reader
   * opnieuw gebruiken terwijl zij de relevante boekingslock houdt.
   */
  IF v_booking.stripe_refund_id IS NOT NULL
     OR v_booking.refunded_at IS NOT NULL
     OR v_booking.status IN ('refund_pending', 'refunded')
     OR EXISTS (
       SELECT 1
       FROM public.refund_requests AS r
       WHERE r.source_booking_id = v_booking.id
          OR r.stripe_payment_intent_id =
               v_booking.stripe_payment_intent_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.refund_request_items AS i
       WHERE i.booking_id = v_booking.id
     )
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_REFUND_REQUIRES_REVIEW';
  END IF;

  /*
   * Geen betaling accepteren die ook een pakketaankoop
   * of een andere losse boeking financiert.
   */
  IF EXISTS (
    SELECT 1
    FROM public.package_purchases AS p
    WHERE p.stripe_payment_intent_id =
            v_booking.stripe_payment_intent_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.bookings AS b
    WHERE b.id IS DISTINCT FROM v_booking.id
      AND b.stripe_payment_intent_id =
            v_booking.stripe_payment_intent_id
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PAYMENT_SOURCE_CONFLICT';
  END IF;

  SELECT a.*
  INTO v_attempt
  FROM public.single_lesson_payment_attempts AS a
  WHERE a.booking_id = v_booking.id;

  v_has_attempt := FOUND;

  IF v_has_attempt THEN
    /*
     * Een aanwezige maar afwijkende betaalpoging niet negeren
     * en niet terugvallen op de legacy Checkout-interpretatie.
     */
    IF v_attempt.channel IS DISTINCT FROM 'paymentsheet'
       OR v_attempt.status IS DISTINCT FROM 'succeeded'
       OR v_attempt.stripe_livemode IS DISTINCT FROM false
       OR v_attempt.funds_flow IS DISTINCT FROM 'separate_transfers_v1'
       OR v_attempt.player_id IS DISTINCT FROM v_booking.player_id
       OR v_attempt.trainer_id IS DISTINCT FROM v_booking.trainer_id
       OR v_attempt.slot_id IS DISTINCT FROM v_booking.slot_id
       OR v_attempt.amount_cents IS DISTINCT FROM
            v_booking.total_price_cents
       OR v_attempt.currency IS DISTINCT FROM v_booking.currency
       OR v_attempt.participant_count IS DISTINCT FROM
            v_booking.participant_count
       OR v_attempt.starts_at IS DISTINCT FROM
            v_booking.original_starts_at
       OR v_attempt.stripe_payment_intent_id IS DISTINCT FROM
            v_booking.stripe_payment_intent_id
       OR v_attempt.stripe_charge_id IS DISTINCT FROM
            v_booking.stripe_charge_id
       OR v_attempt.stripe_charge_id IS NULL
       OR v_attempt.stripe_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$'
       OR v_attempt.stripe_checkout_session_id IS NOT NULL
       OR v_booking.stripe_checkout_session_id IS NOT NULL
       OR v_attempt.first_stripe_request_at IS NULL
       OR NOT isfinite(v_attempt.first_stripe_request_at)
       OR jsonb_typeof(v_attempt.stripe_create_parameters)
            IS DISTINCT FROM 'object'
       OR v_attempt.payment_verified_at IS NULL
       OR NOT isfinite(v_attempt.payment_verified_at)
       OR v_attempt.booking_confirmed_at IS NULL
       OR NOT isfinite(v_attempt.booking_confirmed_at)
       OR v_attempt.review_code IS NOT NULL
       OR v_attempt.stripe_idempotency_key IS DISTINCT FROM
            'gowtrain-single-payment/' || v_attempt.id::text
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_PAYMENT_ATTEMPT_INVALID';
    END IF;

    IF v_attempt.stripe_create_parameters -> 'amount'
         IS DISTINCT FROM to_jsonb(v_booking.total_price_cents)
       OR v_attempt.stripe_create_parameters ->> 'currency'
         IS DISTINCT FROM v_booking.currency
       OR v_attempt.stripe_create_parameters -> 'metadata'
         IS DISTINCT FROM jsonb_build_object(
           'gowtrain_single_payment_attempt_id', v_attempt.id::text,
           'gowtrain_booking_id', v_booking.id::text,
           'gowtrain_trainer_id', v_booking.trainer_id::text,
           'gowtrain_funds_flow', 'separate_transfers_v1',
           'gowtrain_payment_channel', 'paymentsheet'
         )
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_PAYMENT_SNAPSHOT_MISMATCH';
    END IF;

    v_channel := 'paymentsheet';
  ELSE
    IF v_booking.stripe_checkout_session_id IS NULL
       OR v_booking.stripe_checkout_session_id
            !~ '^cs_test_[A-Za-z0-9]+$'
       OR (
         v_booking.stripe_charge_id IS NOT NULL
         AND v_booking.stripe_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$'
       )
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_LEGACY_REFERENCES_INVALID';
    END IF;

    v_channel := 'legacy_checkout';
  END IF;

  /*
   * Ook een betaalpoging van een andere boeking mag niet
   * dezelfde bron claimen.
   */
  IF EXISTS (
    SELECT 1
    FROM public.single_lesson_payment_attempts AS a
    WHERE a.booking_id IS DISTINCT FROM v_booking.id
      AND (
        a.stripe_payment_intent_id =
          v_booking.stripe_payment_intent_id
        OR (
          v_booking.stripe_checkout_session_id IS NOT NULL
          AND a.stripe_checkout_session_id =
                v_booking.stripe_checkout_session_id
        )
        OR (
          v_booking.stripe_charge_id IS NOT NULL
          AND a.stripe_charge_id = v_booking.stripe_charge_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PAYMENT_ATTEMPT_SOURCE_CONFLICT';
  END IF;

  RETURN jsonb_build_object(
    'source_kind', 'single_lesson',
    'booking_id', v_booking.id,
    'trainer_id', v_booking.trainer_id,
    'payment_channel', v_channel,
    'payment_attempt_id',
      CASE WHEN v_has_attempt THEN v_attempt.id ELSE NULL END,
    'checkout_session_id', v_booking.stripe_checkout_session_id,
    'payment_intent_id', v_booking.stripe_payment_intent_id,
    'stored_charge_id', v_booking.stripe_charge_id,
    'total_amount_cents', v_booking.total_price_cents,
    'commission_rate_bps', v_booking.commission_rate_bps,
    'commission_amount_cents', v_booking.commission_amount_cents,
    'trainer_net_amount_cents', v_booking.trainer_net_amount_cents,
    'currency', v_booking.currency,
    'eligible_at', v_booking.trainer_payout_eligible_at,
    'allocation_consistent', true,
    'stripe_verification_required', true
  );
END;
$function$;

REVOKE ALL
ON FUNCTION public.read_sandbox_single_transfer_source_context(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.read_sandbox_single_transfer_source_context(uuid)
TO service_role;

COMMIT;