-- Losse-lestransfers: gecontroleerde installatie
-- Broncommit: f07737ece50563c69dd1dfbead6da32b8edc673e
-- Exact 20 migraties; geen testfixtures.
-- Dit bestand COMMIT de wijzigingen als alle stappen slagen.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM cron.job
    WHERE jobid IN (3, 11, 15)
      AND active = false
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'INSTALL_TRANSFER_JOBS_MUST_BE_PAUSED';
  END IF;

  IF to_regclass('public.single_transfer_admissions') IS NOT NULL THEN
    RAISE EXCEPTION 'INSTALL_ADMISSIONS_ALREADY_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.trainer_transfer_requests
    WHERE status = 'processing'
       OR (status = 'succeeded' AND applied_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'INSTALL_PROCESSING_REQUEST_REQUIRES_REVIEW';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.trainer_transfer_recovery_checks
    WHERE status = 'running'
  ) THEN
    RAISE EXCEPTION 'INSTALL_RUNNING_RECOVERY_REQUIRES_REVIEW';
  END IF;
END;
$preflight$;


-- MIGRATIE: read-sandbox-single-transfer-source-context.sql
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


-- MIGRATIE: validate-completed-single-transfer-history-entry.sql
CREATE FUNCTION public.validate_completed_single_transfer_history_entry(
  p_entry jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_request jsonb;
  v_booking jsonb;
  v_attempt jsonb;
  v_payload jsonb;

  v_request_id text;
  v_booking_id text;
  v_trainer_id text;
  v_attempt_id text;
  v_transfer_id text;
  v_payment_id text;
  v_charge_id text;
  v_destination text;

  v_amount bigint;
  v_total bigint;
  v_commission bigint;
  v_rate bigint;
  v_participants bigint;

  v_field text;
  v_timestamp timestamptz;
  v_prepared_at timestamptz;
  v_verified_at timestamptz;
  v_succeeded_at timestamptz;
  v_trainer_paid_at timestamptz;
BEGIN
  IF jsonb_typeof(p_entry) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_entry -> 'request') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_entry -> 'booking') IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_OBJECT_INVALID';
  END IF;

  v_request := p_entry -> 'request';
  v_booking := p_entry -> 'booking';
  v_attempt := p_entry -> 'payment_attempt';

  /*
   * Expliciet JSON-null vereist.
   * Een ontbrekend veld is geen bevestigde losse-lescontext.
   */
  IF v_request -> 'source_package_purchase_id'
       IS DISTINCT FROM 'null'::jsonb
     OR v_booking -> 'package_purchase_id'
       IS DISTINCT FROM 'null'::jsonb
     OR p_entry -> 'purchase' IS DISTINCT FROM 'null'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_PACKAGE_CONFLICT';
  END IF;

  v_request_id := v_request ->> 'id';
  v_booking_id := v_request ->> 'booking_id';
  v_trainer_id := v_request ->> 'trainer_id';

  FOREACH v_field IN ARRAY ARRAY[
    v_request_id, v_booking_id, v_trainer_id
  ]
  LOOP
    IF v_field IS NULL OR v_field !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_UUID_INVALID';
    END IF;
  END LOOP;

  IF jsonb_typeof(v_request -> 'amount_cents')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_booking -> 'total_price_cents')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_booking -> 'commission_amount_cents')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_booking -> 'commission_rate_bps')
       IS DISTINCT FROM 'number'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_AMOUNT_INVALID';
  END IF;

  v_amount := (v_request ->> 'amount_cents')::bigint;
  v_total := (v_booking ->> 'total_price_cents')::bigint;
  v_commission := (v_booking ->> 'commission_amount_cents')::bigint;
  v_rate := (v_booking ->> 'commission_rate_bps')::bigint;

  IF v_request -> 'amount_cents' IS DISTINCT FROM to_jsonb(v_amount)
     OR v_booking -> 'total_price_cents' IS DISTINCT FROM to_jsonb(v_total)
     OR v_booking -> 'commission_amount_cents'
          IS DISTINCT FROM to_jsonb(v_commission)
     OR v_booking -> 'commission_rate_bps'
          IS DISTINCT FROM to_jsonb(v_rate)
     OR v_amount <= 0 OR v_amount > 2147483647
     OR v_total <= 0 OR v_total > 2147483647
     OR v_commission < 0 OR v_commission > 2147483647
     OR v_rate < 0 OR v_rate > 3000
     OR v_commission + v_amount IS DISTINCT FROM v_total
     OR round(v_total::numeric * v_rate::numeric / 10000)
          IS DISTINCT FROM v_commission::numeric
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_ALLOCATION_MISMATCH';
  END IF;

  v_transfer_id := v_request ->> 'stripe_transfer_id';
  v_payment_id := v_request ->> 'stripe_payment_intent_id';
  v_charge_id := v_request ->> 'stripe_source_charge_id';
  v_destination := v_request ->> 'destination_account_id';

  IF v_transfer_id IS NULL OR v_transfer_id !~ '^tr_[A-Za-z0-9]+$'
     OR v_payment_id IS NULL OR v_payment_id !~ '^pi_[A-Za-z0-9]+$'
     OR v_charge_id IS NULL OR v_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$'
     OR v_destination IS NULL OR v_destination !~ '^acct_[A-Za-z0-9]+$'
     OR length(v_destination) > 255
     OR v_request ->> 'status' IS DISTINCT FROM 'succeeded'
     OR v_request ->> 'currency' IS DISTINCT FROM 'eur'
     OR v_request -> 'stripe_livemode' IS DISTINCT FROM 'false'::jsonb
     OR v_request ->> 'funds_flow' IS DISTINCT FROM 'separate_transfers_v1'
     OR v_request -> 'attempts' IS DISTINCT FROM '1'::jsonb
     OR v_request -> 'has_lock_token' IS DISTINCT FROM 'false'::jsonb
     OR v_request -> 'locked_until' IS DISTINCT FROM 'null'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_REQUEST_INVALID';
  END IF;

  IF v_booking ->> 'id' IS DISTINCT FROM v_booking_id
     OR v_booking ->> 'trainer_id' IS DISTINCT FROM v_trainer_id
     OR v_booking ->> 'currency' IS DISTINCT FROM 'eur'
     OR v_booking -> 'trainer_net_amount_cents'
          IS DISTINCT FROM to_jsonb(v_amount)
     OR v_booking ->> 'stripe_payment_intent_id'
          IS DISTINCT FROM v_payment_id
     OR v_booking ->> 'trainer_payout_status' IS DISTINCT FROM 'paid'
     OR v_booking ->> 'stripe_transfer_id' IS DISTINCT FROM v_transfer_id
     OR NOT (v_booking ? 'stripe_charge_id')
     OR (
       v_booking -> 'stripe_charge_id' IS DISTINCT FROM 'null'::jsonb
       AND v_booking ->> 'stripe_charge_id' IS DISTINCT FROM v_charge_id
     )
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_BOOKING_MISMATCH';
  END IF;

  v_timestamp := (v_booking ->> 'paid_at')::timestamptz;

  IF v_timestamp IS NULL OR NOT isfinite(v_timestamp) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_TIMESTAMP_INVALID';
  END IF;

  IF v_attempt = 'null'::jsonb THEN
    IF (v_booking ->> 'stripe_checkout_session_id')
         ~ '^cs_test_[A-Za-z0-9]+$' IS NOT TRUE
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_CHECKOUT_INVALID';
    END IF;
  ELSE
    IF jsonb_typeof(v_attempt) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_ATTEMPT_MISSING';
    END IF;

    v_attempt_id := v_attempt ->> 'id';

    IF v_attempt_id IS NULL OR v_attempt_id !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_UUID_INVALID';
    END IF;

    IF (v_booking ->> 'slot_id') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      IS NOT TRUE
       OR jsonb_typeof(v_booking -> 'participant_count')
            IS DISTINCT FROM 'number'
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_ATTEMPT_MISMATCH';
    END IF;

    v_participants := (v_booking ->> 'participant_count')::bigint;

    IF v_participants < 1 OR v_participants > 4
       OR v_booking -> 'participant_count'
            IS DISTINCT FROM to_jsonb(v_participants)
       OR v_attempt ->> 'booking_id' IS DISTINCT FROM v_booking_id
       OR v_attempt ->> 'trainer_id' IS DISTINCT FROM v_trainer_id
       OR v_attempt ->> 'slot_id' IS DISTINCT FROM v_booking ->> 'slot_id'
       OR v_attempt -> 'player_matches_booking'
            IS DISTINCT FROM 'true'::jsonb
       OR v_attempt ->> 'channel' IS DISTINCT FROM 'paymentsheet'
       OR v_attempt ->> 'status' IS DISTINCT FROM 'succeeded'
       OR v_attempt -> 'amount_cents' IS DISTINCT FROM to_jsonb(v_total)
       OR v_attempt ->> 'currency' IS DISTINCT FROM 'eur'
       OR v_attempt -> 'stripe_livemode' IS DISTINCT FROM 'false'::jsonb
       OR v_attempt ->> 'funds_flow'
            IS DISTINCT FROM 'separate_transfers_v1'
       OR v_attempt -> 'participant_count'
            IS DISTINCT FROM to_jsonb(v_participants)
       OR v_attempt ->> 'stripe_payment_intent_id'
            IS DISTINCT FROM v_payment_id
       OR v_attempt ->> 'stripe_charge_id' IS DISTINCT FROM v_charge_id
       OR v_booking ->> 'stripe_charge_id' IS DISTINCT FROM v_charge_id
       OR v_attempt -> 'stripe_checkout_session_id'
            IS DISTINCT FROM 'null'::jsonb
       OR v_booking -> 'stripe_checkout_session_id'
            IS DISTINCT FROM 'null'::jsonb
       OR v_attempt -> 'review_code' IS DISTINCT FROM 'null'::jsonb
       OR v_attempt ->> 'stripe_idempotency_key' IS DISTINCT FROM
            'gowtrain-single-payment/' || v_attempt_id
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_ATTEMPT_MISMATCH';
    END IF;

    v_timestamp := (v_attempt ->> 'starts_at')::timestamptz;

    IF v_timestamp IS NULL OR NOT isfinite(v_timestamp)
       OR v_timestamp IS DISTINCT FROM
            (v_booking ->> 'original_starts_at')::timestamptz
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_LESSON_TIME_MISMATCH';
    END IF;

    FOREACH v_field IN ARRAY ARRAY[
      'first_stripe_request_at',
      'payment_verified_at',
      'booking_confirmed_at'
    ]
    LOOP
      v_timestamp := (v_attempt ->> v_field)::timestamptz;

      IF v_timestamp IS NULL OR NOT isfinite(v_timestamp) THEN
        RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_TIMESTAMP_INVALID';
      END IF;
    END LOOP;
  END IF;

  FOREACH v_field IN ARRAY ARRAY[
    'first_stripe_request_at',
    'source_verified_at',
    'succeeded_at',
    'applied_at'
  ]
  LOOP
    v_timestamp := (v_request ->> v_field)::timestamptz;

    IF v_timestamp IS NULL OR NOT isfinite(v_timestamp) THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_TIMESTAMP_INVALID';
    END IF;
  END LOOP;

  v_prepared_at := (v_request ->> 'first_stripe_request_at')::timestamptz;
  v_verified_at := (v_request ->> 'source_verified_at')::timestamptz;
  v_succeeded_at := (v_request ->> 'succeeded_at')::timestamptz;
  v_trainer_paid_at := (v_booking ->> 'trainer_paid_at')::timestamptz;

  IF v_verified_at > v_prepared_at + interval '5 seconds'
     OR v_succeeded_at < v_prepared_at - interval '2 minutes'
     OR v_trainer_paid_at IS DISTINCT FROM v_succeeded_at
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_REQUEST_TIMES_MISMATCH';
  END IF;

  v_payload := jsonb_build_object(
    'amount', v_amount,
    'currency', 'eur',
    'destination', v_destination,
    'source_transaction', v_charge_id,
    'transfer_group', 'gowtrain-single/' || v_booking_id,
    'metadata', jsonb_build_object(
      'gowtrain_transfer_request_id', v_request_id,
      'gowtrain_booking_id', v_booking_id,
      'gowtrain_trainer_id', v_trainer_id,
      'gowtrain_payment_intent_id', v_payment_id,
      'gowtrain_funds_flow', 'separate_transfers_v1',
      'gowtrain_booking_type', 'single_lesson'
    )
  );

  IF v_request -> 'stripe_request_payload' IS DISTINCT FROM v_payload
     OR v_request ->> 'stripe_idempotency_key' IS DISTINCT FROM
          'gowtrain-trainer-transfer/' || v_request_id
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_STORED_REQUEST_MISMATCH';
  END IF;

  RETURN v_payload;
END;
$function$;

/*
 * Interne validator, geen nieuwe browser- of service-role-RPC.
 * Aanroep straks vanuit de bestaande SECURITY DEFINER-keten.
 */
REVOKE ALL
ON FUNCTION public.validate_completed_single_transfer_history_entry(jsonb)
FROM PUBLIC, anon, authenticated, service_role;


-- MIGRATIE: validate-completed-package-transfer-history-entry.sql
CREATE FUNCTION public.validate_completed_package_transfer_history_entry(
  p_entry jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_request jsonb;
  v_booking jsonb;
  v_purchase jsonb;
  v_payload jsonb;

  v_request_id text;
  v_booking_id text;
  v_trainer_id text;
  v_purchase_id text;
  v_transfer_id text;
  v_payment_id text;
  v_charge_id text;
  v_destination text;
  v_value text;

  v_amount bigint;
  v_total bigint;
  v_commission bigint;
  v_purchase_total bigint;
  v_purchase_net bigint;
  v_attempts bigint;

  v_field text;
  v_timestamp timestamptz;
  v_prepared_at timestamptz;
  v_verified_at timestamptz;
  v_succeeded_at timestamptz;
BEGIN
  IF jsonb_typeof(p_entry) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_entry -> 'request') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_entry -> 'booking') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_entry -> 'purchase') IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_OBJECT_INVALID';
  END IF;

  v_request := p_entry -> 'request';
  v_booking := p_entry -> 'booking';
  v_purchase := p_entry -> 'purchase';

  v_request_id := v_request ->> 'id';
  v_booking_id := v_request ->> 'booking_id';
  v_trainer_id := v_request ->> 'trainer_id';
  v_purchase_id := v_request ->> 'source_package_purchase_id';

  FOREACH v_value IN ARRAY ARRAY[
    v_request_id, v_booking_id, v_trainer_id, v_purchase_id
  ]
  LOOP
    IF v_value IS NULL OR v_value !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_UUID_INVALID';
    END IF;
  END LOOP;

  IF jsonb_typeof(v_request -> 'amount_cents')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_request -> 'attempts')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_booking -> 'total_price_cents')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_booking -> 'commission_amount_cents')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_purchase -> 'total_price_cents')
       IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_purchase -> 'trainer_net_amount_cents')
       IS DISTINCT FROM 'number'
  THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_AMOUNT_INVALID';
  END IF;

  v_amount := (v_request ->> 'amount_cents')::bigint;
  v_attempts := (v_request ->> 'attempts')::bigint;
  v_total := (v_booking ->> 'total_price_cents')::bigint;
  v_commission := (v_booking ->> 'commission_amount_cents')::bigint;
  v_purchase_total := (v_purchase ->> 'total_price_cents')::bigint;
  v_purchase_net := (v_purchase ->> 'trainer_net_amount_cents')::bigint;

  IF v_request -> 'amount_cents'
       IS DISTINCT FROM to_jsonb(v_amount)
     OR v_request -> 'attempts'
       IS DISTINCT FROM to_jsonb(v_attempts)
     OR v_booking -> 'total_price_cents'
       IS DISTINCT FROM to_jsonb(v_total)
     OR v_booking -> 'commission_amount_cents'
       IS DISTINCT FROM to_jsonb(v_commission)
     OR v_purchase -> 'total_price_cents'
       IS DISTINCT FROM to_jsonb(v_purchase_total)
     OR v_purchase -> 'trainer_net_amount_cents'
       IS DISTINCT FROM to_jsonb(v_purchase_net)
     OR v_amount <= 0 OR v_amount > 2147483647
     OR v_attempts < 1 OR v_attempts > 2147483647
     OR v_total <= 0 OR v_total > 2147483647
     OR v_commission < 0 OR v_commission > 2147483647
     OR v_purchase_total <= 0 OR v_purchase_total > 2147483647
     OR v_purchase_net < 0 OR v_purchase_net > 2147483647
     OR v_commission + v_amount IS DISTINCT FROM v_total
     OR v_total > v_purchase_total
     OR v_amount > v_purchase_net
  THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_ALLOCATION_MISMATCH';
  END IF;

  v_transfer_id := v_request ->> 'stripe_transfer_id';
  v_payment_id := v_request ->> 'stripe_payment_intent_id';
  v_charge_id := v_request ->> 'stripe_source_charge_id';
  v_destination := v_request ->> 'destination_account_id';

  IF v_transfer_id IS NULL OR v_transfer_id !~ '^tr_[A-Za-z0-9]+$'
     OR v_payment_id IS NULL OR v_payment_id !~ '^pi_[A-Za-z0-9]+$'
     OR v_charge_id IS NULL OR v_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$'
     OR v_destination IS NULL OR v_destination !~ '^acct_[A-Za-z0-9]+$'
     OR v_request ->> 'status' IS DISTINCT FROM 'succeeded'
     OR v_request ->> 'currency' IS DISTINCT FROM 'eur'
     OR v_request -> 'stripe_livemode' IS DISTINCT FROM 'false'::jsonb
     OR v_request ->> 'funds_flow'
          IS DISTINCT FROM 'separate_transfers_v1'
     OR v_request -> 'has_lock_token' IS DISTINCT FROM 'false'::jsonb
     OR v_request -> 'locked_until' IS DISTINCT FROM 'null'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_REQUEST_INVALID';
  END IF;

  IF v_booking ->> 'id' IS DISTINCT FROM v_booking_id
     OR v_booking ->> 'trainer_id' IS DISTINCT FROM v_trainer_id
     OR v_booking ->> 'package_purchase_id' IS DISTINCT FROM v_purchase_id
     OR v_booking ->> 'currency' IS DISTINCT FROM 'eur'
     OR v_booking -> 'trainer_net_amount_cents'
          IS DISTINCT FROM to_jsonb(v_amount)
     OR v_booking ->> 'trainer_payout_status' IS DISTINCT FROM 'paid'
     OR v_booking ->> 'stripe_transfer_id' IS DISTINCT FROM v_transfer_id
     OR v_purchase ->> 'id' IS DISTINCT FROM v_purchase_id
     OR v_purchase ->> 'trainer_id' IS DISTINCT FROM v_trainer_id
     OR v_purchase ->> 'currency' IS DISTINCT FROM 'eur'
     OR v_purchase -> 'stripe_livemode' IS DISTINCT FROM 'false'::jsonb
     OR v_purchase ->> 'funds_flow'
          IS DISTINCT FROM 'separate_transfers_v1'
     OR v_purchase ->> 'stripe_payment_intent_id'
          IS DISTINCT FROM v_payment_id
  THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_CONTEXT_MISMATCH';
  END IF;

  v_timestamp := (v_booking ->> 'paid_at')::timestamptz;

  IF v_timestamp IS NULL OR NOT isfinite(v_timestamp) THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_TIMESTAMP_INVALID';
  END IF;

  v_timestamp := (v_purchase ->> 'paid_at')::timestamptz;

  IF v_timestamp IS NULL OR NOT isfinite(v_timestamp) THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_TIMESTAMP_INVALID';
  END IF;

  FOREACH v_field IN ARRAY ARRAY[
    'first_stripe_request_at',
    'source_verified_at',
    'succeeded_at',
    'applied_at'
  ]
  LOOP
    v_timestamp := (v_request ->> v_field)::timestamptz;

    IF v_timestamp IS NULL OR NOT isfinite(v_timestamp) THEN
      RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_TIMESTAMP_INVALID';
    END IF;
  END LOOP;

  v_prepared_at := (v_request ->> 'first_stripe_request_at')::timestamptz;
  v_verified_at := (v_request ->> 'source_verified_at')::timestamptz;
  v_succeeded_at := (v_request ->> 'succeeded_at')::timestamptz;
  v_timestamp := (v_booking ->> 'trainer_paid_at')::timestamptz;

  IF v_verified_at > v_prepared_at + interval '5 seconds'
     OR v_succeeded_at < v_prepared_at - interval '2 minutes'
     OR v_timestamp IS DISTINCT FROM v_succeeded_at
  THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_REQUEST_TIMES_MISMATCH';
  END IF;

  /*
   * Historische pakketpayload exact behouden.
   * Geen nieuwe bronsoortmetadata aan bestaande transfers toevoegen.
   */
  v_payload := jsonb_build_object(
    'amount', v_amount,
    'currency', 'eur',
    'destination', v_destination,
    'source_transaction', v_charge_id,
    'transfer_group', 'gowtrain-package/' || v_purchase_id,
    'metadata', jsonb_build_object(
      'gowtrain_transfer_request_id', v_request_id,
      'gowtrain_booking_id', v_booking_id,
      'gowtrain_trainer_id', v_trainer_id,
      'gowtrain_package_purchase_id', v_purchase_id,
      'gowtrain_payment_intent_id', v_payment_id,
      'gowtrain_funds_flow', 'separate_transfers_v1'
    )
  );

  IF v_request -> 'stripe_request_payload' IS DISTINCT FROM v_payload
     OR v_request ->> 'stripe_idempotency_key' IS DISTINCT FROM
          'gowtrain-trainer-transfer/' || v_request_id
  THEN
    RAISE EXCEPTION 'TRANSFER_PACKAGE_HISTORY_STORED_REQUEST_MISMATCH';
  END IF;

  /*
   * Alleen de gevalideerde verwachte payload teruggeven.
   * Geen Stripe-waarneming of budgetvrijgave suggereren.
   */
  RETURN v_payload;
END;
$function$;

/*
 * Interne validator. Aanroepen vanuit de gecontroleerde
 * SECURITY DEFINER-historieketen, niet vanuit de browser.
 */
REVOKE ALL
ON FUNCTION public.validate_completed_package_transfer_history_entry(jsonb)
FROM PUBLIC, anon, authenticated, service_role;


-- MIGRATIE: extend-sandbox-transfer-recovery-context.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Alleen structurele herkenning voor herstelonderzoek.
 *
 * GEEN toestemming voor registratie, claim, prepare of verzending.
 * GEEN nieuwe beoordeling van refundrecht of Connect-geschiktheid.
 *
 * Een latere refund, annulering of gewijzigde bestemming mag
 * onderzoek naar een mogelijk uitgevoerde transfer niet op zichzelf
 * onmogelijk maken.
 *
 * De opgeslagen bestemming en payload worden verderop door
 * de bestaande zoek- en synchronisatieketen gecontroleerd.
 */
CREATE FUNCTION public.is_sandbox_single_transfer_recovery_context(
  p_request_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.trainer_transfer_requests AS r
    JOIN public.bookings AS b
      ON b.id = r.booking_id
    JOIN public.availability_slots AS s
      ON s.id = b.slot_id
    WHERE r.id = p_request_id
      AND r.source_package_purchase_id IS NULL
      AND b.package_purchase_id IS NULL
      AND s.package_id IS NULL
      AND s.trainer_id = b.trainer_id
      AND b.trainer_id = r.trainer_id
      AND b.paid_at IS NOT NULL
      AND isfinite(b.paid_at)
      AND b.stripe_payment_intent_id = r.stripe_payment_intent_id
      AND r.stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
      AND r.amount_cents > 0
      AND b.trainer_net_amount_cents = r.amount_cents
      AND b.currency = r.currency
      AND r.currency = 'eur'
      AND r.stripe_livemode = false
      AND r.funds_flow = 'separate_transfers_v1'
      AND r.stripe_idempotency_key =
        'gowtrain-trainer-transfer/' || r.id::text
  );
$function$;

REVOKE ALL
ON FUNCTION public.is_sandbox_single_transfer_recovery_context(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.is_sandbox_single_transfer_recovery_context(uuid)
TO service_role;

/*
 * Exacte, gecontroleerde vervangingen in bestaande definities.
 *
 * Geen globale vervanging van pakketvoorwaarden.
 * Alleen onderstaande zes functies en de opgegeven fragmenten.
 *
 * De overige functiebody, SECURITY DEFINER, search_path,
 * eigenaar en bestaande uitvoerrechten blijven behouden.
 *
 * Dit script is bewust niet herhaalbaar:
 * bij een al toegepaste of afwijkende definitie stopt het.
 */
DO $migration$
DECLARE
  v_patch record;
  v_function_oid oid;
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
BEGIN
  FOR v_patch IN
    SELECT *
    FROM (
      VALUES
        (
          'public.start_sandbox_transfer_recovery_check(uuid)',
          true,
          false
        ),
        (
          'public.start_next_sandbox_transfer_recovery_check()',
          true,
          true
        ),
        (
          'public.expire_next_sandbox_transfer_recovery_check()',
          false,
          true
        ),
        (
          'public.expire_sandbox_transfer_recovery_check(uuid)',
          true,
          false
        ),
        (
          'public.finish_sandbox_transfer_recovery_check(uuid,text,text,text)',
          true,
          false
        ),
        (
          'public.record_sandbox_transfer_recovery_scan(uuid,timestamp with time zone,timestamp with time zone,integer,text,text,jsonb)',
          true,
          false
        )
    ) AS patches(
      function_signature,
      replace_request_guard,
      replace_selector_filter
    )
  LOOP
    v_function_oid :=
      to_regprocedure(v_patch.function_signature)::oid;

    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION
        'RECOVERY_CONTEXT_MIGRATION_FUNCTION_MISSING: %',
        v_patch.function_signature;
    END IF;

    v_definition := pg_get_functiondef(v_function_oid);

    IF v_patch.replace_request_guard THEN
      v_old :=
        'OR v_request.source_package_purchase_id IS NULL';

      v_new :=
        'OR (
       v_request.source_package_purchase_id IS NULL
       AND NOT public.is_sandbox_single_transfer_recovery_context(
         v_request.id
       )
     )';

      v_occurrences := (
        length(v_definition)
        - length(replace(v_definition, v_old, ''))
      ) / length(v_old);

      IF v_occurrences IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION
          'RECOVERY_CONTEXT_MIGRATION_GUARD_MISMATCH: %',
          v_patch.function_signature;
      END IF;

      v_definition := replace(v_definition, v_old, v_new);
    END IF;

    IF v_patch.replace_selector_filter THEN
      v_old :=
        'AND r.source_package_purchase_id IS NOT NULL';

      v_new :=
        'AND (
      r.source_package_purchase_id IS NOT NULL
      OR public.is_sandbox_single_transfer_recovery_context(r.id)
    )';

      v_occurrences := (
        length(v_definition)
        - length(replace(v_definition, v_old, ''))
      ) / length(v_old);

      IF v_occurrences IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION
          'RECOVERY_CONTEXT_MIGRATION_SELECTOR_MISMATCH: %',
          v_patch.function_signature;
      END IF;

      v_definition := replace(v_definition, v_old, v_new);
    END IF;

    /*
     * De afwijzing betreft na uitbreiding beide bronsoorten.
     * Functies met een vaste diagnostische code behouden die code.
     */
    v_definition := replace(
      v_definition,
      'Geen ondersteunde pakkettesttransfer.',
      'Geen ondersteunde sandboxtransfercontext.'
    );

    EXECUTE v_definition;
  END LOOP;
END;
$migration$;


-- MIGRATIE: extend-sandbox-transfer-review-context.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Vereist eerst:
 * scripts/extend-sandbox-transfer-recovery-context.sql
 *
 * Breidt uitsluitend de twee bestaande reviewfuncties uit.
 * Geen financiële opdrachten of boekingen verwerken tijdens
 * het installeren van deze definities.
 */
DO $migration$
DECLARE
  v_signature text;
  v_function_oid oid;
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
BEGIN
  IF to_regprocedure(
    'public.is_sandbox_single_transfer_recovery_context(uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_REVIEW_CONTEXT_HELPER_MISSING';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.block_expired_sandbox_trainer_transfer(uuid)',
    'public.mark_sandbox_trainer_transfer_for_review(uuid,uuid,text)'
  ]
  LOOP
    v_function_oid := to_regprocedure(v_signature)::oid;

    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION
        'TRANSFER_REVIEW_MIGRATION_FUNCTION_MISSING: %',
        v_signature;
    END IF;

    -- Alleen regeleinden normaliseren voor exacte blokvergelijking.
    v_definition := replace(
      pg_get_functiondef(v_function_oid),
      chr(13),
      ''
    );

    /*
     * 1. Pakketcontext behouden; losse context expliciet controleren.
     */
    v_old := 'OR v_request.source_package_purchase_id IS NULL';

    v_new := 'OR (
       v_request.source_package_purchase_id IS NULL
       AND NOT public.is_sandbox_single_transfer_recovery_context(
         v_request.id
       )
     )';

    v_occurrences := (
      length(v_definition)
      - length(replace(v_definition, v_old, ''))
    ) / length(v_old);

    IF v_occurrences IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'TRANSFER_REVIEW_MIGRATION_GUARD_MISMATCH: %',
        v_signature;
    END IF;

    v_definition := replace(v_definition, v_old, v_new);

    /*
     * 2. Aankooplock alleen voor een echte pakketaankoop.
     *
     * Pakket: opdracht -> aankoop -> boeking.
     * Losse les: opdracht -> boeking.
     *
     * Geen locks op betaalpogingen of refundopdrachten toevoegen.
     */
    v_old := $old$  PERFORM p.id
  FROM public.package_purchases AS p
  WHERE p.id = v_request.source_package_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'De oorspronkelijke pakketaankoop ontbreekt.';
  END IF;$old$;

    v_new := $new$  IF v_request.source_package_purchase_id IS NOT NULL THEN
    PERFORM p.id
    FROM public.package_purchases AS p
    WHERE p.id = v_request.source_package_purchase_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'De oorspronkelijke pakketaankoop ontbreekt.';
    END IF;
  END IF;$new$;

    v_occurrences := (
      length(v_definition)
      - length(replace(v_definition, v_old, ''))
    ) / length(v_old);

    IF v_occurrences IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'TRANSFER_REVIEW_MIGRATION_LOCK_BLOCK_MISMATCH: %',
        v_signature;
    END IF;

    v_definition := replace(v_definition, v_old, v_new);

    /*
     * 3. Losse context opnieuw beoordelen nadat de bestaande
     * SELECT ... FOR UPDATE de boekingslock heeft verkregen.
     *
     * De bestaande controles op processing, bedrag, trainer,
     * valuta en afwezig resultaat blijven hieronder intact.
     */
    v_old := '  IF v_booking.package_purchase_id';

    v_new := $new$  IF v_request.source_package_purchase_id IS NULL
     AND NOT public.is_sandbox_single_transfer_recovery_context(
       v_request.id
     )
  THEN
    RAISE EXCEPTION 'TRANSFER_REVIEW_SINGLE_CONTEXT_CHANGED';
  END IF;

  IF v_booking.package_purchase_id$new$;

    v_occurrences := (
      length(v_definition)
      - length(replace(v_definition, v_old, ''))
    ) / length(v_old);

    IF v_occurrences IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'TRANSFER_REVIEW_MIGRATION_BOOKING_CHECK_MISMATCH: %',
        v_signature;
    END IF;

    v_definition := replace(v_definition, v_old, v_new);

    v_definition := replace(
      v_definition,
      'Geen ondersteunde pakkettesttransfer.',
      'Geen ondersteunde sandboxtransfercontext.'
    );

    /*
     * CREATE OR REPLACE behoudt de bestaande eigenaar en ACL.
     * Geen uitvoeringsaanroep van de gewijzigde functie.
     */
    EXECUTE v_definition;
  END LOOP;
END;
$migration$;


-- MIGRATIE: extend-sandbox-transfer-application-context.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Vereist:
 * scripts/extend-sandbox-transfer-recovery-context.sql
 *
 * Breidt uitsluitend bestaande resultaatsynchronisatie uit.
 * Geen transferaanmaak, claim, prepare of herverzending.
 *
 * De bestaande pakketpayload en pakketcontroles blijven behouden.
 */
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_patch record;
  v_occurrences integer;
BEGIN
  IF to_regprocedure(
    'public.is_sandbox_single_transfer_recovery_context(uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_APPLICATION_CONTEXT_HELPER_MISSING';
  END IF;

  v_function_oid := to_regprocedure(
    'public.apply_verified_sandbox_trainer_transfer(uuid,text,text,text,integer,text,timestamp with time zone,timestamp with time zone)'
  )::oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_APPLICATION_FUNCTION_MISSING';
  END IF;

  v_definition := replace(
    pg_get_functiondef(v_function_oid),
    chr(13),
    ''
  );

  FOR v_patch IN
    SELECT *
    FROM (
      VALUES
      (
        1,
        'supported_context',
        $old$     OR v_request.source_package_purchase_id IS NULL$old$,
        $new$     OR (
       v_request.source_package_purchase_id IS NULL
       AND NOT public.is_sandbox_single_transfer_recovery_context(
         v_request.id
       )
     )$new$
      ),
      (
        2,
        'payload_start',
        $old$  v_expected_payload := jsonb_build_object(
    'amount', v_request.amount_cents,$old$,
        $new$  IF v_request.source_package_purchase_id IS NOT NULL THEN
    -- Bestaande pakketpayload exact behouden.
    v_expected_payload := jsonb_build_object(
    'amount', v_request.amount_cents,$new$
      ),
      (
        3,
        'payload_single_branch',
        $old$  IF v_request.stripe_request_payload
       IS DISTINCT FROM v_expected_payload$old$,
        $new$  ELSE
    /*
     * Exact dezelfde losse-lespayload als de TypeScript-builder.
     * Geen pakketmetadata met een leeg of verzonnen aankoop-ID.
     */
    v_expected_payload := jsonb_build_object(
      'amount', v_request.amount_cents,
      'currency', v_request.currency,
      'destination', v_request.destination_account_id,
      'source_transaction', v_request.stripe_source_charge_id,
      'transfer_group',
        'gowtrain-single/' || v_request.booking_id::text,
      'metadata', jsonb_build_object(
        'gowtrain_transfer_request_id', v_request.id::text,
        'gowtrain_booking_id', v_request.booking_id::text,
        'gowtrain_trainer_id', v_request.trainer_id::text,
        'gowtrain_payment_intent_id',
          v_request.stripe_payment_intent_id,
        'gowtrain_funds_flow', 'separate_transfers_v1',
        'gowtrain_booking_type', 'single_lesson'
      )
    );
  END IF;

  IF v_request.stripe_request_payload
       IS DISTINCT FROM v_expected_payload$new$
      ),
      (
        4,
        'purchase_lock',
        $old$  SELECT p.*
  INTO v_purchase
  FROM public.package_purchases AS p
  WHERE p.id = v_request.source_package_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'De oorspronkelijke pakketaankoop ontbreekt.';
  END IF;$old$,
        $new$  /*
   * Pakket: opdracht -> aankoop -> boeking.
   * Losse les: opdracht -> boeking.
   */
  IF v_request.source_package_purchase_id IS NOT NULL THEN
    SELECT p.*
    INTO v_purchase
    FROM public.package_purchases AS p
    WHERE p.id = v_request.source_package_purchase_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'De oorspronkelijke pakketaankoop ontbreekt.';
    END IF;
  END IF;$new$
      ),
      (
        5,
        'booking_context_start',
        $old$  IF v_purchase.stripe_livemode IS DISTINCT FROM false$old$,
        $new$  IF v_request.source_package_purchase_id IS NOT NULL THEN
    -- Bestaande aankoop- en boekingscontroles ongewijzigd.
    IF v_purchase.stripe_livemode IS DISTINCT FROM false$new$
      ),
      (
        6,
        'booking_context_single_branch',
        $old$    RAISE EXCEPTION
      'De aankoop of boeking wijkt af van de voorbereide transfer.';
  END IF;$old$,
        $new$    RAISE EXCEPTION
      'De aankoop of boeking wijkt af van de voorbereide transfer.';
    END IF;
  ELSE
    /*
     * Hercontrole na verkrijgen van de boekingslock.
     * Geen refund- of actuele Connect-geschiktheidsbeslissing:
     * het gaat om registratie van een werkelijk uitgevoerd resultaat.
     */
    IF NOT public.is_sandbox_single_transfer_recovery_context(
      v_request.id
    )
       OR v_booking.package_purchase_id IS NOT NULL
       OR v_booking.trainer_id IS DISTINCT FROM v_request.trainer_id
       OR v_booking.stripe_payment_intent_id IS DISTINCT FROM
            v_request.stripe_payment_intent_id
       OR v_booking.trainer_net_amount_cents IS DISTINCT FROM
            v_request.amount_cents
       OR v_booking.currency IS DISTINCT FROM v_request.currency
       OR v_booking.paid_at IS NULL
       OR NOT isfinite(v_booking.paid_at)
       OR (
         v_booking.stripe_charge_id IS NOT NULL
         AND v_booking.stripe_charge_id IS DISTINCT FROM
               v_request.stripe_source_charge_id
       )
    THEN
      RAISE EXCEPTION 'TRANSFER_APPLICATION_SINGLE_CONTEXT_MISMATCH';
    END IF;
  END IF;$new$
      ),
      (
        7,
        'context_message',
        $old$Geen geschikte voorbereide pakkettesttransfer voor resultaatsynchronisatie.$old$,
        $new$Geen geschikte voorbereide sandboxtransfer voor resultaatsynchronisatie.$new$
      )
    ) AS patches(step, label, old_text, new_text)
    ORDER BY step
  LOOP
    v_occurrences := (
      length(v_definition)
      - length(replace(v_definition, v_patch.old_text, ''))
    ) / length(v_patch.old_text);

    IF v_occurrences IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'TRANSFER_APPLICATION_MIGRATION_BLOCK_MISMATCH: %',
        v_patch.label;
    END IF;

    v_definition := replace(
      v_definition,
      v_patch.old_text,
      v_patch.new_text
    );
  END LOOP;

  /*
   * CREATE OR REPLACE behoudt eigenaar en bestaande uitvoerrechten.
   * Alleen de definitie wijzigen; de functie niet aanroepen.
   */
  EXECUTE v_definition;
END;
$migration$;


-- MIGRATIE: extend-sandbox-transfer-history-projection.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Verrijkt de bestaande historieloader.
 *
 * Geen verandering aan:
 * - selectiebereik;
 * - status- of omgevingsfilters;
 * - limiet van 2000 opdrachten;
 * - detectie van boekingen met onverklaarde transferhistorie.
 *
 * Geen volledige betaalpayload, client secret of persoonsgegevens
 * toevoegen aan de projectie.
 */
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_patch record;
  v_occurrences integer;
BEGIN
  v_function_oid := to_regprocedure(
    'public.read_sandbox_trainer_transfer_history(uuid,text)'
  )::oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_HISTORY_PROJECTION_FUNCTION_MISSING';
  END IF;

  v_definition := replace(
    pg_get_functiondef(v_function_oid),
    chr(13),
    ''
  );

  FOR v_patch IN
    SELECT *
    FROM (
      VALUES
      (
        1,
        'booking_source_fields',
        $old$            'total_price_cents', b.total_price_cents,
            'commission_amount_cents', b.commission_amount_cents,$old$,
        $new$            'total_price_cents', b.total_price_cents,
            'commission_rate_bps', b.commission_rate_bps,
            'stripe_checkout_session_id', b.stripe_checkout_session_id,
            'stripe_payment_intent_id', b.stripe_payment_intent_id,
            'stripe_charge_id', b.stripe_charge_id,
            'slot_id', b.slot_id,
            'participant_count', b.participant_count,
            'original_starts_at', b.original_starts_at,
            'commission_amount_cents', b.commission_amount_cents,$new$
      ),
      (
        2,
        'payment_attempt_projection',
        $old$        'purchase', CASE WHEN original.id IS NULL THEN NULL ELSE$old$,
        $new$        /*
         * Bij een legacy Checkout-boeking bestaat geen nieuwe
         * betaalpoging. NULL is daar een expliciete bronvariant,
         * geen reden om betalingscontroles over te slaan.
         *
         * Een aanwezige afwijkende poging blijft zichtbaar.
         * Niet filteren op succeeded, paymentsheet of testmode.
         *
         * De bestaande unieke booking_id-constraint maakt
         * deze scalaire subquery eenduidig.
         */
        'payment_attempt', (
          SELECT jsonb_build_object(
            'id', a.id,
            'booking_id', a.booking_id,
            'trainer_id', a.trainer_id,
            'slot_id', a.slot_id,
            'channel', a.channel,
            'status', a.status,
            'amount_cents', a.amount_cents,
            'currency', a.currency,
            'stripe_livemode', a.stripe_livemode,
            'funds_flow', a.funds_flow,
            'participant_count', a.participant_count,
            'starts_at', a.starts_at,
            'stripe_idempotency_key', a.stripe_idempotency_key,
            'stripe_checkout_session_id', a.stripe_checkout_session_id,
            'stripe_payment_intent_id', a.stripe_payment_intent_id,
            'stripe_charge_id', a.stripe_charge_id,
            'first_stripe_request_at', a.first_stripe_request_at,
            'payment_verified_at', a.payment_verified_at,
            'booking_confirmed_at', a.booking_confirmed_at,
            'review_code', a.review_code,
            'player_matches_booking',
              a.player_id IS NOT DISTINCT FROM b.player_id
          )
          FROM public.single_lesson_payment_attempts AS a
          WHERE a.booking_id = b.id
        ),
        'purchase', CASE WHEN original.id IS NULL THEN NULL ELSE$new$
      )
    ) AS patches(step, label, old_text, new_text)
    ORDER BY step
  LOOP
    v_occurrences := (
      length(v_definition)
      - length(replace(v_definition, v_patch.old_text, ''))
    ) / length(v_patch.old_text);

    IF v_occurrences IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'TRANSFER_HISTORY_PROJECTION_BLOCK_MISMATCH: %',
        v_patch.label;
    END IF;

    v_definition := replace(
      v_definition,
      v_patch.old_text,
      v_patch.new_text
    );
  END LOOP;

  /*
   * Behoudt de bestaande functie-eigenaar en uitvoerrechten.
   * Alleen de definitie aanpassen; geen historie-inspectie uitvoeren.
   */
  EXECUTE v_definition;
END;
$migration$;


-- MIGRATIE: extend-sandbox-package-claim-mixed-history.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Vereist eerst:
 * - extend-sandbox-transfer-history-projection.sql
 * - validate-completed-single-transfer-history-entry.sql
 *
 * De huidige claim blijft hier een PAKKETclaim.
 * Eerdere historie mag pakket- én losse-lestransfers bevatten.
 *
 * Geen wijzigingen aan selectie, registratie of uitvoering.
 */
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_patch record;
  v_occurrences integer;
BEGIN
  IF to_regprocedure(
    'public.validate_completed_single_transfer_history_entry(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_MIXED_HISTORY_VALIDATOR_MISSING';
  END IF;

  v_function_oid := to_regprocedure(
    'public.validate_claimed_sandbox_transfer_history(uuid,uuid,text,jsonb)'
  )::oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_MIXED_HISTORY_FUNCTION_MISSING';
  END IF;

  v_definition := replace(
    pg_get_functiondef(v_function_oid),
    chr(13),
    ''
  );

  FOR v_patch IN
    SELECT *
    FROM (
      VALUES
      (
        1,
        'entry_shape',
        $old$    IF jsonb_typeof(v_request) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_booking) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_purchase) IS DISTINCT FROM 'object'
    THEN$old$,
        $new$    IF jsonb_typeof(v_request) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_booking) IS DISTINCT FROM 'object'
       OR (
         v_request -> 'source_package_purchase_id'
           IS DISTINCT FROM 'null'::jsonb
         AND jsonb_typeof(v_purchase) IS DISTINCT FROM 'object'
       )
       OR (
         v_request -> 'source_package_purchase_id' = 'null'::jsonb
         AND v_purchase IS DISTINCT FROM 'null'::jsonb
       )
    THEN$new$
      ),
      (
        2,
        'package_validation_start',
        $old$    IF v_booking ->> 'id' IS DISTINCT FROM v_request ->> 'booking_id'$old$,
        $new$    IF v_request -> 'source_package_purchase_id'
         IS DISTINCT FROM 'null'::jsonb
    THEN
      -- Bestaande pakketvalidatie ongewijzigd behouden.
    IF v_booking ->> 'id' IS DISTINCT FROM v_request ->> 'booking_id'$new$
      ),
      (
        3,
        'single_validation_branch',
        $old$    IF v_request ->> 'stripe_source_charge_id'
         IS DISTINCT FROM p_source_charge_id
       AND v_request ->> 'destination_account_id'
         IS DISTINCT FROM v_destination$old$,
        $new$    ELSE
      /*
       * Een volledig toegepaste losse-lestransfer expliciet
       * valideren. Geen aankoopobject verzinnen.
       */
      v_expected_payload :=
        public.validate_completed_single_transfer_history_entry(
          v_entry
        );

      v_amount := (v_request ->> 'amount_cents')::bigint;

      /*
       * De huidige claim betreft een pakketaankoop.
       * Een losse les mag niet dezelfde betaling/bron claimen.
       */
      IF v_request ->> 'stripe_payment_intent_id'
           = v_payment_intent_id
         OR v_request ->> 'stripe_source_charge_id'
           = p_source_charge_id
      THEN
        RAISE EXCEPTION
          'TRANSFER_SINGLE_HISTORY_PACKAGE_SOURCE_CONFLICT';
      END IF;
    END IF;

    /*
     * Voor BEIDE soorten historie dezelfde scanscope eisen.
     * Historie buiten de scan nooit stilzwijgend verwijderen.
     */
    IF v_request ->> 'stripe_source_charge_id'
         IS DISTINCT FROM p_source_charge_id
       AND v_request ->> 'destination_account_id'
         IS DISTINCT FROM v_destination$new$
      ),
      (
        4,
        'package_payload_start',
        $old$    v_expected_payload := jsonb_build_object(
      'amount', v_amount,$old$,
        $new$    IF v_request -> 'source_package_purchase_id'
         IS DISTINCT FROM 'null'::jsonb
    THEN
      -- De oorspronkelijke pakketpayload exact behouden.
    v_expected_payload := jsonb_build_object(
      'amount', v_amount,$new$
      ),
      (
        5,
        'payload_branch_end',
        $old$    IF v_request -> 'stripe_request_payload'
         IS DISTINCT FROM v_expected_payload$old$,
        $new$    END IF;

    /*
     * Voor losse lessen staat v_expected_payload al vast
     * door validate_completed_single_transfer_history_entry.
     *
     * Hieronder blijven de gedeelde payload-, Stripe-,
     * reversal-, datum- en telcontroles voor beide soorten gelden.
     */
    IF v_request -> 'stripe_request_payload'
         IS DISTINCT FROM v_expected_payload$new$
      )
    ) AS patches(step, label, old_text, new_text)
    ORDER BY step
  LOOP
    v_occurrences := (
      length(v_definition)
      - length(replace(v_definition, v_patch.old_text, ''))
    ) / length(v_patch.old_text);

    IF v_occurrences IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'TRANSFER_MIXED_HISTORY_BLOCK_MISMATCH: %',
        v_patch.label;
    END IF;

    v_definition := replace(
      v_definition,
      v_patch.old_text,
      v_patch.new_text
    );
  END LOOP;

  /*
   * Alleen de bestaande definitie vervangen.
   * Eigenaar en bestaande uitvoerrechten behouden.
   * Geen uitvoering van de historievalidator tijdens installatie.
   */
  EXECUTE v_definition;
END;
$migration$;


-- MIGRATIE: read-sandbox-single-trainer-transfer-history.sql
CREATE FUNCTION public.read_sandbox_single_trainer_transfer_history(
  p_booking_id uuid,
  p_source_charge_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_context jsonb;
  v_trainer public.trainers%rowtype;
  v_booking public.bookings%rowtype;
  v_requests jsonb;
  v_orphan_bookings jsonb;
  v_count bigint;
BEGIN
  IF p_booking_id IS NULL
     OR p_source_charge_id IS NULL
     OR p_source_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_INPUT_INVALID';
  END IF;

  /*
   * Broncontext opnieuw lezen.
   * Deze aanroep bewijst geen actuele Stripe-verificatie
   * en geeft geen uitvoeringsautorisatie.
   */
  v_context :=
    public.read_sandbox_single_transfer_source_context(p_booking_id);

  IF v_context IS NULL
     OR v_context ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_context ->> 'booking_id' IS DISTINCT FROM p_booking_id::text
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_SOURCE_INVALID';
  END IF;

  SELECT b.*
  INTO v_booking
  FROM public.bookings AS b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_BOOKING_MISSING';
  END IF;

  IF v_context ->> 'payment_intent_id'
       IS DISTINCT FROM v_booking.stripe_payment_intent_id
     OR v_context ->> 'trainer_id'
       IS DISTINCT FROM v_booking.trainer_id::text
     OR (
       v_booking.stripe_charge_id IS NOT NULL
       AND v_booking.stripe_charge_id IS DISTINCT FROM p_source_charge_id
     )
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_SOURCE_MISMATCH';
  END IF;

  SELECT t.*
  INTO v_trainer
  FROM public.trainers AS t
  WHERE t.id = v_booking.trainer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_TRAINER_MISSING';
  END IF;

  IF v_trainer.stripe_account_id IS NULL
     OR v_trainer.stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     OR length(v_trainer.stripe_account_id) > 255
     OR v_trainer.stripe_account_api IS DISTINCT FROM 'accounts_v2'
     OR v_trainer.stripe_account_livemode IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_DESTINATION_INVALID';
  END IF;

  /*
   * Ruimer lezen dan alleen dezelfde betaalbron:
   * - opdracht voor deze boeking;
   * - dezelfde PI of broncharge;
   * - dezelfde trainer, ook via de gekoppelde boeking;
   * - dezelfde bestemming.
   *
   * Geen status-, bronsoort- of livemodefilter:
   * afwijkende opdrachten moeten zichtbaar blijven.
   */
  SELECT count(*)
  INTO v_count
  FROM public.trainer_transfer_requests AS r
  LEFT JOIN public.bookings AS b ON b.id = r.booking_id
  WHERE r.booking_id = v_booking.id
     OR r.stripe_payment_intent_id = v_booking.stripe_payment_intent_id
     OR r.stripe_source_charge_id = p_source_charge_id
     OR r.trainer_id = v_booking.trainer_id
     OR b.trainer_id = v_booking.trainer_id
     OR r.destination_account_id = v_trainer.stripe_account_id;

  IF v_count > 2000 THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_LIMIT_REACHED';
  END IF;

  /*
   * Expliciete projectie:
   * geen claimtoken, volledige betaalpayload, naam of e-mailadres.
   *
   * De opgeslagen TRANSFERpayload is wel nodig om eerdere
   * transfers exact te kunnen vergelijken.
   */
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'request', jsonb_build_object(
          'id', r.id,
          'booking_id', r.booking_id,
          'trainer_id', r.trainer_id,
          'source_package_purchase_id', r.source_package_purchase_id,
          'status', r.status,
          'amount_cents', r.amount_cents,
          'currency', r.currency,
          'destination_account_id', r.destination_account_id,
          'stripe_payment_intent_id', r.stripe_payment_intent_id,
          'stripe_livemode', r.stripe_livemode,
          'funds_flow', r.funds_flow,
          'stripe_source_charge_id', r.stripe_source_charge_id,
          'source_verified_at', r.source_verified_at,
          'stripe_idempotency_key', r.stripe_idempotency_key,
          'stripe_request_payload', r.stripe_request_payload,
          'first_stripe_request_at', r.first_stripe_request_at,
          'stripe_transfer_id', r.stripe_transfer_id,
          'succeeded_at', r.succeeded_at,
          'applied_at', r.applied_at,
          'attempts', r.attempts,
          'locked_until', r.locked_until,
          'has_lock_token', r.lock_token IS NOT NULL
        ),
        'booking', CASE WHEN b.id IS NULL THEN NULL ELSE
          jsonb_build_object(
            'id', b.id,
            'trainer_id', b.trainer_id,
            'package_purchase_id', b.package_purchase_id,
            'status', b.status,
            'paid_at', b.paid_at,
            'total_price_cents', b.total_price_cents,
            'commission_rate_bps', b.commission_rate_bps,
            'commission_amount_cents', b.commission_amount_cents,
            'trainer_net_amount_cents', b.trainer_net_amount_cents,
            'currency', b.currency,
            'stripe_checkout_session_id', b.stripe_checkout_session_id,
            'stripe_payment_intent_id', b.stripe_payment_intent_id,
            'stripe_charge_id', b.stripe_charge_id,
            'slot_id', b.slot_id,
            'participant_count', b.participant_count,
            'original_starts_at', b.original_starts_at,
            'trainer_payout_status', b.trainer_payout_status,
            'stripe_transfer_id', b.stripe_transfer_id,
            'trainer_paid_at', b.trainer_paid_at
          )
        END,
        'payment_attempt', (
          SELECT jsonb_build_object(
            'id', a.id,
            'booking_id', a.booking_id,
            'trainer_id', a.trainer_id,
            'slot_id', a.slot_id,
            'channel', a.channel,
            'status', a.status,
            'amount_cents', a.amount_cents,
            'currency', a.currency,
            'stripe_livemode', a.stripe_livemode,
            'funds_flow', a.funds_flow,
            'participant_count', a.participant_count,
            'starts_at', a.starts_at,
            'stripe_idempotency_key', a.stripe_idempotency_key,
            'stripe_checkout_session_id', a.stripe_checkout_session_id,
            'stripe_payment_intent_id', a.stripe_payment_intent_id,
            'stripe_charge_id', a.stripe_charge_id,
            'first_stripe_request_at', a.first_stripe_request_at,
            'payment_verified_at', a.payment_verified_at,
            'booking_confirmed_at', a.booking_confirmed_at,
            'review_code', a.review_code,
            'player_matches_booking',
              a.player_id IS NOT DISTINCT FROM b.player_id
          )
          FROM public.single_lesson_payment_attempts AS a
          WHERE a.booking_id = b.id
        ),
        'purchase', CASE WHEN original.id IS NULL THEN NULL ELSE
          jsonb_build_object(
            'id', original.id,
            'trainer_id', original.trainer_id,
            'total_price_cents', original.total_price_cents,
            'trainer_net_amount_cents', original.trainer_net_amount_cents,
            'currency', original.currency,
            'stripe_payment_intent_id', original.stripe_payment_intent_id,
            'stripe_livemode', original.stripe_livemode,
            'funds_flow', original.funds_flow,
            'paid_at', original.paid_at
          )
        END
      )
      ORDER BY r.created_at, r.id
    ),
    '[]'::jsonb
  )
  INTO v_requests
  FROM public.trainer_transfer_requests AS r
  LEFT JOIN public.bookings AS b ON b.id = r.booking_id
  LEFT JOIN public.package_purchases AS original
    ON original.id = r.source_package_purchase_id
  WHERE r.booking_id = v_booking.id
     OR r.stripe_payment_intent_id = v_booking.stripe_payment_intent_id
     OR r.stripe_source_charge_id = p_source_charge_id
     OR r.trainer_id = v_booking.trainer_id
     OR b.trainer_id = v_booking.trainer_id
     OR r.destination_account_id = v_trainer.stripe_account_id;

  /*
   * Ook oude processing/paid-boekingen zonder opdracht vinden.
   * Niet resetten, migreren of als verklaarde historie behandelen.
   */
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', b.id,
        'package_purchase_id', b.package_purchase_id,
        'trainer_payout_status', b.trainer_payout_status,
        'stripe_transfer_id', b.stripe_transfer_id,
        'trainer_paid_at', b.trainer_paid_at
      )
      ORDER BY b.id
    ),
    '[]'::jsonb
  )
  INTO v_orphan_bookings
  FROM public.bookings AS b
  WHERE (
    b.id = v_booking.id
    OR b.trainer_id = v_booking.trainer_id
    OR b.stripe_payment_intent_id = v_booking.stripe_payment_intent_id
    OR b.stripe_charge_id = p_source_charge_id
  )
    AND (
      b.trainer_payout_status IN ('processing', 'paid')
      OR b.stripe_transfer_id IS NOT NULL
      OR b.trainer_paid_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.trainer_transfer_requests AS r
      WHERE r.booking_id = b.id
    );

  RETURN jsonb_build_object(
    'source_kind', 'single_lesson',
    'booking_id', v_booking.id,
    'purchase_id', NULL,
    'trainer_id', v_booking.trainer_id,
    'payment_intent_id', v_booking.stripe_payment_intent_id,
    'source_charge_id', p_source_charge_id,
    'destination_account_id', v_trainer.stripe_account_id,
    'source_total_amount_cents', v_booking.total_price_cents,
    'source_trainer_net_amount_cents', v_booking.trainer_net_amount_cents,
    'stripe_verification_required', true,
    'request_count', v_count,
    'requests', v_requests,
    'orphan_bookings', v_orphan_bookings
  );
END;
$function$;

REVOKE ALL
ON FUNCTION public.read_sandbox_single_trainer_transfer_history(uuid,text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.read_sandbox_single_trainer_transfer_history(uuid,text)
TO service_role;


-- MIGRATIE: validate-sandbox-single-transfer-booking-internal.sql
CREATE FUNCTION public.validate_sandbox_single_transfer_booking_internal(
  p_booking_id uuid,
  p_request_id uuid,
  p_lock_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request public.trainer_transfer_requests%rowtype;
  v_booking public.bookings%rowtype;
  v_slot public.availability_slots%rowtype;
  v_trainer public.trainers%rowtype;
  v_connect_attempt public.trainer_connect_attempts%rowtype;

  v_payment_attempt_id uuid;
  v_current_attempt_id uuid;
  v_source jsonb;
  v_now timestamptz;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_REQUIRED';
  END IF;

  IF (p_request_id IS NULL)
       IS DISTINCT FROM (p_lock_token IS NULL)
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_INPUT_INCOMPLETE';
  END IF;

  /*
   * Met claimcontext: opdracht eerst locken.
   *
   * Zonder claimcontext moet een aanroeper die een bestaande
   * opdracht gebruikt die opdracht zelf al als eerste locken.
   *
   * Volgorde:
   * opdracht (indien aanwezig)
   * -> betaalpoging (indien aanwezig)
   * -> boeking -> slot -> trainer.
   *
   * De bestaande native betaalbevestiging gebruikt eveneens
   * betaalpoging -> boeking -> slot.
   *
   * Geen refundopdrachten locken vanuit deze keten.
   */
  IF p_request_id IS NOT NULL THEN
    SELECT r.*
    INTO v_request
    FROM public.trainer_transfer_requests AS r
    WHERE r.id = p_request_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REQUEST_MISSING';
    END IF;

    IF v_request.booking_id IS DISTINCT FROM p_booking_id
       OR v_request.source_package_purchase_id IS NOT NULL
       OR v_request.status IS DISTINCT FROM 'processing'
       OR v_request.lock_token IS DISTINCT FROM p_lock_token
       OR v_request.locked_until IS NULL
       OR NOT isfinite(v_request.locked_until)
       OR v_request.locked_until <= clock_timestamp()
       OR v_request.attempts IS DISTINCT FROM 1
       OR v_request.stripe_livemode IS DISTINCT FROM false
       OR v_request.funds_flow IS DISTINCT FROM 'separate_transfers_v1'
       OR v_request.first_stripe_request_at IS NOT NULL
       OR v_request.stripe_request_payload IS NOT NULL
       OR v_request.stripe_transfer_id IS NOT NULL
       OR v_request.succeeded_at IS NOT NULL
       OR v_request.applied_at IS NOT NULL
       OR v_request.stripe_idempotency_key IS DISTINCT FROM
            'gowtrain-trainer-transfer/' || v_request.id::text
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_UNPREPARED_CLAIM_INVALID';
    END IF;
  END IF;

  /*
   * Eventuele betaalpoging vóór de boeking locken.
   * Bij afwezigheid bestaat geen rij om te locken;
   * na de boekingslock controleren we de koppeling opnieuw.
   */
  SELECT a.id
  INTO v_payment_attempt_id
  FROM public.single_lesson_payment_attempts AS a
  WHERE a.booking_id = p_booking_id;

  IF v_payment_attempt_id IS NOT NULL THEN
    PERFORM a.id
    FROM public.single_lesson_payment_attempts AS a
    WHERE a.id = v_payment_attempt_id
      AND a.booking_id = p_booking_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_ATTEMPT_CHANGED';
    END IF;
  END IF;

  SELECT b.*
  INTO v_booking
  FROM public.bookings AS b
  WHERE b.id = p_booking_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_MISSING';
  END IF;

  IF v_booking.package_purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PACKAGE_NOT_ALLOWED';
  END IF;

  SELECT a.id
  INTO v_current_attempt_id
  FROM public.single_lesson_payment_attempts AS a
  WHERE a.booking_id = p_booking_id;

  IF v_current_attempt_id IS DISTINCT FROM v_payment_attempt_id THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ATTEMPT_CHANGED';
  END IF;

  SELECT s.*
  INTO v_slot
  FROM public.availability_slots AS s
  WHERE s.id = v_booking.slot_id
  FOR SHARE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SLOT_MISSING';
  END IF;

  SELECT t.*
  INTO v_trainer
  FROM public.trainers AS t
  WHERE t.id = v_booking.trainer_id
  FOR SHARE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_TRAINER_MISSING';
  END IF;

  /*
   * Bron-, bedrag-, betaalpoging- en database-refundcontrole
   * opnieuw uitvoeren onder de verkregen locks.
   *
   * Deze reader verifieert Stripe niet zelf.
   * De afzonderlijke actuele Stripe-broncontrole blijft verplicht.
   */
  v_source :=
    public.read_sandbox_single_transfer_source_context(p_booking_id);

  IF v_source IS NULL
     OR v_source ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_source ->> 'booking_id' IS DISTINCT FROM v_booking.id::text
     OR v_source ->> 'trainer_id' IS DISTINCT FROM v_booking.trainer_id::text
     OR v_source ->> 'payment_intent_id'
          IS DISTINCT FROM v_booking.stripe_payment_intent_id
     OR v_source -> 'trainer_net_amount_cents'
          IS DISTINCT FROM to_jsonb(v_booking.trainer_net_amount_cents)
     OR v_source -> 'allocation_consistent'
          IS DISTINCT FROM 'true'::jsonb
     OR v_source -> 'stripe_verification_required'
          IS DISTINCT FROM 'true'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SOURCE_CONTEXT_NOT_CONFIRMED';
  END IF;

  /*
   * Eerste uitvoeringsscope: niet-geannuleerde lessen.
   *
   * Late spelersannuleringen kunnen een trainersverplichting
   * behouden, maar krijgen een afzonderlijk uitvoeringspad.
   * Hier geen annulering verwijderen of status corrigeren.
   */
  IF v_booking.status NOT IN ('confirmed', 'completed')
     OR v_booking.cancelled_at IS NOT NULL
     OR v_booking.cancelled_by IS NOT NULL
     OR v_booking.cancellation_policy IS NOT NULL
     OR v_slot.status IS DISTINCT FROM 'booked'
     OR v_slot.package_id IS NOT NULL
     OR v_slot.trainer_id IS DISTINCT FROM v_booking.trainer_id
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_STATE_UNSUPPORTED';
  END IF;

  IF v_booking.cancellation_rules_version
       IS DISTINCT FROM 'single_24h_v1'
     OR v_booking.original_starts_at IS NULL
     OR v_booking.player_free_cancellation_deadline IS DISTINCT FROM
          v_booking.original_starts_at - interval '24 hours'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_TERMS_INVALID';
  END IF;

  v_now := clock_timestamp();

  IF v_booking.trainer_payout_eligible_at IS NULL
     OR NOT isfinite(v_booking.trainer_payout_eligible_at)
     OR v_booking.trainer_payout_eligible_at > v_now
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_NOT_YET_ELIGIBLE';
  END IF;

  IF (
       CASE
         WHEN p_request_id IS NULL THEN
           v_booking.trainer_payout_status NOT IN ('pending', 'eligible')
         ELSE
           v_booking.trainer_payout_status IS DISTINCT FROM 'processing'
       END
     )
     OR v_booking.stripe_transfer_id IS NOT NULL
     OR v_booking.trainer_paid_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PAYOUT_STATE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_issues AS i
    WHERE i.booking_id = v_booking.id
      AND i.status IN ('open', 'in_review')
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_OPEN_BOOKING_ISSUE';
  END IF;

  /*
   * Geen eis dat het trainerprofiel momenteel zichtbaar of
   * goedgekeurd is: bestaande verplichtingen vervallen niet
   * door het verbergen van het profiel.
   */
  IF v_trainer.stripe_account_id IS NULL
     OR v_trainer.stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     OR length(v_trainer.stripe_account_id) > 255
     OR v_trainer.stripe_account_api IS DISTINCT FROM 'accounts_v2'
     OR v_trainer.stripe_account_livemode IS DISTINCT FROM false
     OR v_trainer.stripe_account_closed IS DISTINCT FROM false
     OR v_trainer.stripe_transfers_status IS DISTINCT FROM 'active'
     OR v_trainer.stripe_account_checked_at IS NULL
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_DESTINATION_NOT_READY';
  END IF;

  IF NOT isfinite(v_trainer.stripe_account_checked_at)
     OR v_trainer.stripe_account_checked_at >
          v_now + interval '2 minutes'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_DESTINATION_CHECK_DATE_INVALID';
  END IF;

  /*
   * Geen aanmaakpoging reconstrueren of account opnieuw koppelen.
   * Alleen de bestaande gekoppelde v2-poging accepteren.
   *
   * Meerdere passende pogingen leveren een fout op, geen
   * willekeurig gekozen eerste rij.
   */
  BEGIN
    SELECT a.*
    INTO STRICT v_connect_attempt
    FROM public.trainer_connect_attempts AS a
    WHERE a.trainer_id = v_trainer.id
      AND a.status = 'linked'
      AND a.account_api = 'accounts_v2'
      AND a.stripe_account_id = v_trainer.stripe_account_id;
  EXCEPTION
    WHEN no_data_found OR too_many_rows THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_CONNECT_ATTEMPT_NOT_UNIQUE';
  END;

  IF v_connect_attempt.trainer_user_id
       IS DISTINCT FROM v_trainer.user_id
     OR v_connect_attempt.stripe_livemode IS DISTINCT FROM false
     OR v_connect_attempt.first_stripe_request_at IS NULL
     OR v_connect_attempt.linked_at IS NULL
     OR v_connect_attempt.stripe_request_payload
          #>> '{metadata,gowtrain_trainer_id}'
          IS DISTINCT FROM v_trainer.id::text
     OR v_connect_attempt.stripe_request_payload
          #>> '{metadata,gowtrain_connect_attempt_id}'
          IS DISTINCT FROM v_connect_attempt.id::text
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CONNECT_LINK_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.connect_attention_incidents AS i
    WHERE i.stripe_account_id = v_trainer.stripe_account_id
      AND i.stripe_livemode = false
      AND i.status = 'open'
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_OPEN_CONNECT_INCIDENT';
  END IF;

  IF p_request_id IS NOT NULL THEN
    IF v_request.trainer_id IS DISTINCT FROM v_booking.trainer_id
       OR v_request.amount_cents
            IS DISTINCT FROM v_booking.trainer_net_amount_cents
       OR v_request.currency IS DISTINCT FROM v_booking.currency
       OR v_request.destination_account_id
            IS DISTINCT FROM v_trainer.stripe_account_id
       OR v_request.stripe_payment_intent_id
            IS DISTINCT FROM v_booking.stripe_payment_intent_id
       OR v_request.eligible_at
            IS DISTINCT FROM v_booking.trainer_payout_eligible_at
       OR (
         v_request.stripe_source_charge_id IS NOT NULL
         AND v_booking.stripe_charge_id IS NOT NULL
         AND v_request.stripe_source_charge_id
               IS DISTINCT FROM v_booking.stripe_charge_id
       )
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_CONTEXT_MISMATCH';
    END IF;

    IF v_request.locked_until <= clock_timestamp() THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_EXPIRED';
    END IF;
  END IF;

  RETURN v_source || jsonb_build_object(
    'source_package_purchase_id', NULL,
    'amount_cents', v_booking.trainer_net_amount_cents,
    'destination_account_id', v_trainer.stripe_account_id,
    'connect_attempt_id', v_connect_attempt.id,
    'validated_at', clock_timestamp()
  );
END;
$function$;

/*
 * Interne functie: geen vrij aanroepbare browser- of
 * service-role-ingang. Gebruik via de nog te bouwen
 * gecontroleerde SECURITY DEFINER-keten.
 */
REVOKE ALL
ON FUNCTION public.validate_sandbox_single_transfer_booking_internal(
  uuid, uuid, uuid
)
FROM PUBLIC, anon, authenticated, service_role;


-- MIGRATIE: register-sandbox-single-trainer-transfer.sql
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


-- MIGRATIE: claim-sandbox-single-trainer-transfer.sql
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


-- MIGRATIE: register-and-claim-sandbox-single-transfer-candidate.sql
CREATE FUNCTION public.register_and_claim_sandbox_single_transfer_candidate(
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_existing public.trainer_transfer_requests%rowtype;
  v_request public.trainer_transfer_requests%rowtype;
  v_request_id uuid;
  v_claim jsonb;
  v_no_claim boolean := false;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_REQUIRED';
  END IF;

  /*
   * Goedkope voorcontrole. Na de registratie controleren we
   * de planning opnieuw onder de verkregen boekingslock.
   */
  IF EXISTS (
    SELECT 1
    FROM public.trainer_transfer_execution_schedule AS s
    WHERE s.booking_id = p_booking_id
      AND s.next_check_at > clock_timestamp()
  ) THEN
    RETURN NULL;
  END IF;

  /*
   * Subtransactie:
   * registratie en claim slagen samen, of alle wijzigingen
   * binnen dit blok worden teruggedraaid.
   */
  BEGIN
    /*
     * Bestaande opdracht eerst locken.
     * Geen opdrachtlock toevoegen na betaalpoging/boeking,
     * behalve voor onze eigen nieuw ingevoegde opdracht.
     */
    SELECT r.*
    INTO v_existing
    FROM public.trainer_transfer_requests AS r
    WHERE r.booking_id = p_booking_id
    FOR UPDATE NOWAIT;

    IF FOUND THEN
      IF v_existing.source_package_purchase_id IS NOT NULL
         OR v_existing.stripe_livemode IS DISTINCT FROM false
         OR v_existing.funds_flow IS DISTINCT FROM
              'separate_transfers_v1'
      THEN
        RAISE EXCEPTION 'TRANSFER_SINGLE_CANDIDATE_CONTEXT_INVALID';
      END IF;

      /*
       * Geen herclaim, ook niet bij een verlopen lease.
       * Niet-queued opdrachten worden ongemoeid gelaten.
       */
      IF v_existing.status IS DISTINCT FROM 'queued' THEN
        RETURN NULL;
      END IF;
    END IF;

    /*
     * Hergebruikt uitsluitend een passende queued-opdracht
     * zonder eerdere verwerking, of registreert een nieuwe.
     *
     * De registratie controleert na lockverwerving opnieuw
     * of een andere sessie ondertussen een opdracht maakte.
     *
     * Locks: bestaande opdracht -> betaalpoging -> boeking
     * -> slot -> trainer.
     */
    v_request_id :=
      public.register_sandbox_single_trainer_transfer(
        p_booking_id
      );

    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTRATION_NOT_CONFIRMED';
    END IF;

    /*
     * De boekingslock is nu verkregen.
     * Een ondertussen verschoven selectieplanning respecteren.
     */
    IF EXISTS (
      SELECT 1
      FROM public.trainer_transfer_execution_schedule AS s
      WHERE s.booking_id = p_booking_id
        AND s.next_check_at > clock_timestamp()
    ) THEN
      v_no_claim := true;

      RAISE EXCEPTION USING
        ERRCODE = 'ZT003',
        MESSAGE = 'Selectieplanning nog niet verschuldigd.';
    END IF;

    SELECT r.*
    INTO v_request
    FROM public.trainer_transfer_requests AS r
    WHERE r.id = v_request_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTERED_REQUEST_MISSING';
    END IF;

    IF v_request.booking_id IS DISTINCT FROM p_booking_id
       OR v_request.source_package_purchase_id IS NOT NULL
       OR v_request.stripe_livemode IS DISTINCT FROM false
       OR v_request.funds_flow IS DISTINCT FROM
            'separate_transfers_v1'
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTERED_CONTEXT_INVALID';
    END IF;

    /*
     * De opdracht is al door deze transactie gelockt,
     * of door deze transactie aangemaakt.
     *
     * De claimfunctie hercontroleert de databasegeschiktheid
     * en staat uitsluitend de eerste claim toe.
     */
    v_claim := public.claim_sandbox_single_trainer_transfer(
      v_request_id,
      300
    );

    IF v_claim IS NULL THEN
      v_no_claim := true;

      RAISE EXCEPTION USING
        ERRCODE = 'ZT003',
        MESSAGE = 'Geen uitvoeringsclaim verkregen.';
    END IF;

    /*
     * Controleer de claim tegen de zojuist geregistreerde
     * opdracht, niet tegen vrij aangeleverde trainer/bedraginput.
     */
    IF jsonb_typeof(v_claim) IS DISTINCT FROM 'object'
       OR v_claim ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
       OR v_claim ->> 'request_id'
            IS DISTINCT FROM v_request.id::text
       OR v_claim ->> 'booking_id'
            IS DISTINCT FROM p_booking_id::text
       OR v_claim ->> 'trainer_id'
            IS DISTINCT FROM v_request.trainer_id::text
       OR v_claim -> 'source_package_purchase_id'
            IS DISTINCT FROM 'null'::jsonb
       OR v_claim -> 'amount_cents'
            IS DISTINCT FROM to_jsonb(v_request.amount_cents)
       OR v_claim ->> 'currency'
            IS DISTINCT FROM v_request.currency
       OR v_claim ->> 'destination_account_id'
            IS DISTINCT FROM v_request.destination_account_id
       OR v_claim ->> 'stripe_payment_intent_id'
            IS DISTINCT FROM v_request.stripe_payment_intent_id
       OR v_claim -> 'stripe_livemode'
            IS DISTINCT FROM 'false'::jsonb
       OR v_claim ->> 'funds_flow'
            IS DISTINCT FROM 'separate_transfers_v1'
       OR v_claim ->> 'stripe_idempotency_key'
            IS DISTINCT FROM v_request.stripe_idempotency_key
       OR v_claim -> 'attempts' IS DISTINCT FROM '1'::jsonb
       OR (v_claim ->> 'lock_token') IS NULL
       OR (v_claim ->> 'locked_until') IS NULL
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_RESPONSE_INVALID';
    END IF;

    /*
     * Bevestig ook dat de teruggegeven lease daadwerkelijk
     * op deze opdracht is opgeslagen.
     */
    IF NOT EXISTS (
      SELECT 1
      FROM public.trainer_transfer_requests AS r
      WHERE r.id = v_request_id
        AND r.booking_id = p_booking_id
        AND r.status = 'processing'
        AND r.attempts = 1
        AND r.lock_token::text = v_claim ->> 'lock_token'
        AND r.locked_until =
              (v_claim ->> 'locked_until')::timestamptz
        AND isfinite(r.locked_until)
        AND r.locked_until > clock_timestamp()
        AND r.first_stripe_request_at IS NULL
        AND r.stripe_request_payload IS NULL
        AND r.stripe_transfer_id IS NULL
        AND r.succeeded_at IS NULL
        AND r.applied_at IS NULL
    ) THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_STORED_CLAIM_NOT_CONFIRMED';
    END IF;

    RETURN v_claim;

  EXCEPTION
    WHEN SQLSTATE 'ZT003' THEN
      /*
       * Alleen onze expliciete geen-claimuitkomsten afhandelen.
       * Alle writes uit het binnenste blok zijn teruggedraaid.
       */
      IF v_no_claim IS DISTINCT FROM true THEN
        RAISE;
      END IF;

      RETURN NULL;
  END;
END;
$function$;

/*
 * Voorlopig alleen intern beschikbaar.
 * Geen browser- of service-role-ingang tijdens de bouw.
 *
 * De uiteindelijke selector gaat deze functie aanroepen.
 */
REVOKE ALL
ON FUNCTION public.register_and_claim_sandbox_single_transfer_candidate(uuid)
FROM PUBLIC, anon, authenticated, service_role;


-- MIGRATIE: read-claimed-sandbox-single-transfer-history.sql
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


-- MIGRATIE: validate-claimed-sandbox-single-transfer-history.sql
CREATE FUNCTION public.validate_claimed_sandbox_single_transfer_history(
  p_request_id uuid,
  p_lock_token uuid,
  p_source_charge_id text,
  p_scan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_claimed jsonb;
  v_history jsonb;
  v_entry jsonb;
  v_request jsonb;
  v_transfer jsonb;
  v_expected_payload jsonb;

  v_booking_id text;
  v_payment_id text;
  v_destination text;

  v_request_id text;
  v_entry_booking_id text;
  v_transfer_id text;

  v_own_amount bigint;
  v_source_total bigint;
  v_amount bigint;
  v_destination_total bigint := 0;

  v_scan_count integer;
  v_completed_count integer := 0;
  v_own_count integer := 0;
  v_match_count integer;
  v_scanned_count numeric;

  v_seen_requests text[] := ARRAY[]::text[];
  v_seen_bookings text[] := ARRAY[]::text[];
  v_seen_transfers text[] := ARRAY[]::text[];

  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_succeeded_at timestamptz;
  v_now timestamptz;
BEGIN
  IF jsonb_typeof(p_scan) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_scan -> 'relevantTransfers')
          IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_INVALID';
  END IF;

  /*
   * Bevestigt de eigen, nog onvoorbereide claim.
   *
   * Houdt opdracht -> betaalpoging -> boeking -> slot -> trainer
   * gelockt tot het einde van de aanroepende transactie.
   *
   * De loader bevat alle relevante historie en weigert
   * onverklaarde processing/paid-boekingen zonder opdracht.
   */
  v_claimed :=
    public.read_claimed_sandbox_single_transfer_history(
      p_request_id,
      p_lock_token,
      p_source_charge_id
    );

  IF jsonb_typeof(v_claimed) IS DISTINCT FROM 'object'
     OR v_claimed -> 'claim_verified' IS DISTINCT FROM 'true'::jsonb
     OR v_claimed ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_claimed ->> 'request_id' IS DISTINCT FROM p_request_id::text
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_CLAIM_NOT_CONFIRMED';
  END IF;

  v_history := v_claimed -> 'history';
  v_booking_id := v_claimed ->> 'booking_id';
  v_payment_id := v_history ->> 'payment_intent_id';
  v_destination := v_claimed ->> 'destination_account_id';

  IF jsonb_typeof(v_history -> 'requests') IS DISTINCT FROM 'array'
     OR v_history -> 'orphan_bookings' IS DISTINCT FROM '[]'::jsonb
     OR v_history -> 'request_count' IS DISTINCT FROM
          to_jsonb(jsonb_array_length(v_history -> 'requests'))
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_HISTORY_INVALID';
  END IF;

  IF p_scan -> 'scanCompleted' IS DISTINCT FROM 'true'::jsonb
     OR p_scan ->> 'sourceChargeId' IS DISTINCT FROM p_source_charge_id
     OR p_scan ->> 'destinationAccountId' IS DISTINCT FROM v_destination
     OR jsonb_typeof(p_scan -> 'scannedTransferCount')
          IS DISTINCT FROM 'number'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_CONTEXT_MISMATCH';
  END IF;

  v_started_at := (p_scan ->> 'checkedAt')::timestamptz;
  v_finished_at := (p_scan ->> 'finishedAt')::timestamptz;
  v_now := clock_timestamp();

  IF v_started_at IS NULL
     OR v_finished_at IS NULL
     OR NOT isfinite(v_started_at)
     OR NOT isfinite(v_finished_at)
     OR v_started_at < v_now - interval '2 minutes'
     OR v_finished_at < v_started_at
     OR v_started_at > v_now + interval '5 seconds'
     OR v_finished_at > v_now + interval '5 seconds'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_TIMES_INVALID';
  END IF;

  v_scan_count := jsonb_array_length(p_scan -> 'relevantTransfers');
  v_scanned_count := (p_scan ->> 'scannedTransferCount')::numeric;

  IF v_scanned_count < 0
     OR v_scanned_count > 2000
     OR trunc(v_scanned_count) IS DISTINCT FROM v_scanned_count
     OR v_scanned_count < v_scan_count
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_COUNT_INVALID';
  END IF;

  v_own_amount :=
    (v_history ->> 'source_trainer_net_amount_cents')::bigint;
  v_source_total :=
    (v_history ->> 'source_total_amount_cents')::bigint;

  IF v_own_amount IS NULL
     OR v_own_amount <= 0
     OR v_source_total IS NULL
     OR v_source_total < v_own_amount
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_SOURCE_AMOUNTS_INVALID';
  END IF;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(v_history -> 'requests')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry -> 'request') IS DISTINCT FROM 'object'
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_ENTRY_INVALID';
    END IF;

    v_request := v_entry -> 'request';
    v_request_id := v_request ->> 'id';
    v_entry_booking_id := v_request ->> 'booking_id';

    IF v_request_id IS NULL
       OR v_entry_booking_id IS NULL
       OR v_request_id = ANY(v_seen_requests)
       OR v_entry_booking_id = ANY(v_seen_bookings)
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_DUPLICATE_HISTORY';
    END IF;

    v_seen_requests := array_append(v_seen_requests, v_request_id);
    v_seen_bookings := array_append(v_seen_bookings, v_entry_booking_id);

    /*
     * Alleen de door de claimreader gecontroleerde eigen opdracht
     * apart behandelen. Geen andere onafgeronde opdracht overslaan.
     */
    IF v_request_id = p_request_id::text THEN
      v_own_count := v_own_count + 1;

      IF v_entry_booking_id IS DISTINCT FROM v_booking_id
         OR v_request -> 'amount_cents'
              IS DISTINCT FROM to_jsonb(v_own_amount)
         OR v_request -> 'stripe_source_charge_id'
              IS DISTINCT FROM 'null'::jsonb
         OR v_request -> 'source_verified_at'
              IS DISTINCT FROM 'null'::jsonb
      THEN
        RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_OWN_CLAIM_INVALID';
      END IF;

      CONTINUE;
    END IF;

    /*
     * Beide rijvalidators eisen een volledig toegepaste opdracht,
     * consistente boeking/broncontext en exact opgeslagen payload.
     *
     * Ontbrekend source_package_purchase_id is niet hetzelfde
     * als expliciet JSON-null; de pakketvalidator weigert dat.
     */
    IF v_request -> 'source_package_purchase_id' = 'null'::jsonb THEN
      v_expected_payload :=
        public.validate_completed_single_transfer_history_entry(
          v_entry
        );
    ELSE
      v_expected_payload :=
        public.validate_completed_package_transfer_history_entry(
          v_entry
        );
    END IF;

    /*
     * Eén losse-lesbetaling, één eerste transfer.
     * Iedere eerdere opdracht met dezelfde PI of broncharge
     * blokkeert, ook als die naar een andere bestemming ging.
     */
    IF v_request ->> 'stripe_payment_intent_id' = v_payment_id
       OR v_request ->> 'stripe_source_charge_id' = p_source_charge_id
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_SOURCE_ALREADY_USED';
    END IF;

    /*
     * Na uitsluiting van dezelfde bron moeten overige entries
     * in de huidige bestemmingsscan vallen.
     */
    IF v_request ->> 'destination_account_id'
         IS DISTINCT FROM v_destination
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_OUTSIDE_SCAN_SCOPE';
    END IF;

    v_transfer_id := v_request ->> 'stripe_transfer_id';
    v_amount := (v_request ->> 'amount_cents')::bigint;
    v_succeeded_at := (v_request ->> 'succeeded_at')::timestamptz;

    IF v_transfer_id = ANY(v_seen_transfers) THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_DUPLICATE_TRANSFER';
    END IF;

    v_seen_transfers := array_append(v_seen_transfers, v_transfer_id);

    SELECT count(*)::integer
    INTO v_match_count
    FROM jsonb_array_elements(p_scan -> 'relevantTransfers') AS item(value)
    WHERE item.value ->> 'transferId' = v_transfer_id;

    IF v_match_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_TRANSFER_MATCH_NOT_UNIQUE';
    END IF;

    SELECT item.value
    INTO v_transfer
    FROM jsonb_array_elements(p_scan -> 'relevantTransfers') AS item(value)
    WHERE item.value ->> 'transferId' = v_transfer_id;

    IF jsonb_typeof(v_transfer) IS DISTINCT FROM 'object'
       OR v_transfer -> 'livemode' IS DISTINCT FROM 'false'::jsonb
       OR v_transfer ->> 'destinationAccountId'
            IS DISTINCT FROM v_request ->> 'destination_account_id'
       OR v_transfer ->> 'sourceChargeId'
            IS DISTINCT FROM v_request ->> 'stripe_source_charge_id'
       OR v_transfer -> 'amountCents' IS DISTINCT FROM to_jsonb(v_amount)
       OR v_transfer ->> 'currency' IS DISTINCT FROM 'eur'
       OR v_transfer -> 'amountReversedCents' IS DISTINCT FROM '0'::jsonb
       OR v_transfer -> 'fullyReversed' IS DISTINCT FROM 'false'::jsonb
       OR v_transfer -> 'hasReversalRecords' IS DISTINCT FROM 'false'::jsonb
       OR v_transfer ->> 'transferGroup'
            IS DISTINCT FROM v_expected_payload ->> 'transfer_group'
       OR v_transfer -> 'metadata'
            IS DISTINCT FROM v_expected_payload -> 'metadata'
       OR v_transfer -> 'created'
            IS DISTINCT FROM to_jsonb(extract(epoch FROM v_succeeded_at))
       OR v_transfer -> 'matchesSourceCharge'
            IS DISTINCT FROM 'false'::jsonb
       OR v_transfer -> 'matchesDestination'
            IS DISTINCT FROM 'true'::jsonb
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_STRIPE_HISTORY_MISMATCH';
    END IF;

    v_completed_count := v_completed_count + 1;
    v_destination_total := v_destination_total + v_amount;
  END LOOP;

  IF v_own_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_OWN_CLAIM_NOT_UNIQUE';
  END IF;

  /*
   * Omgekeerde vergelijking:
   * iedere Stripe-scanrij moet hierboven exact verklaard zijn.
   *
   * Daarmee blokkeert ook een extra transfer voor de eigen
   * nog onvoorbereide claim of een onbekende brontransfer.
   */
  IF v_completed_count IS DISTINCT FROM v_scan_count
     OR p_scan -> 'sourceTransferCount' IS DISTINCT FROM '0'::jsonb
     OR p_scan -> 'destinationTransferCount'
          IS DISTINCT FROM to_jsonb(v_completed_count)
     OR p_scan -> 'destinationTransfersWithoutSourceCount'
          IS DISTINCT FROM '0'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_UNEXPLAINED_TRANSFERS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_scan -> 'relevantTransfers') AS item(value)
    WHERE item.value #>> '{metadata,gowtrain_transfer_request_id}'
            = p_request_id::text
       OR item.value #>> '{metadata,gowtrain_booking_id}' = v_booking_id
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_OWN_CLAIM_ALREADY_AT_STRIPE';
  END IF;

  IF (v_claimed ->> 'locked_until')::timestamptz <= clock_timestamp() THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_EXPIRED';
  END IF;

  RETURN jsonb_build_object(
    'history_verified', true,
    'source_kind', 'single_lesson',
    'request_id', p_request_id,
    'completed_transfer_count', v_completed_count,
    'source_transferred_cents', 0,
    'destination_transferred_cents', v_destination_total,
    'current_amount_cents', v_own_amount,
    'source_total_including_current_cents', v_own_amount
  );
END;
$function$;

/*
 * Interne validator voor de nog aan te sluiten preparefunctie.
 * Geen zelfstandige browser- of service-role-ingang.
 */
REVOKE ALL
ON FUNCTION public.validate_claimed_sandbox_single_transfer_history(
  uuid, uuid, text, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;


-- MIGRATIE: prepare-sandbox-single-trainer-transfer.sql
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


-- MIGRATIE: guard-single-booking-financial-fields.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.guard_single_booking_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  /*
   * Beveilig bestaande boekingen zonder pakketaankoopkoppeling.
   *
   * Bewust op OLD beoordelen: een gelijktijdig toegevoegd
   * package_purchase_id mag geen ontsnappingsroute worden.
   *
   * Hieronder vallen ook oude pakketboekingen zonder moderne
   * aankoopkoppeling. Hun vastgelegde bedragen mogen evenmin
   * stilzwijgend worden veranderd.
   *
   * Moderne pakketboekingen behouden hun bestaande gedrag.
   */
  IF OLD.package_purchase_id IS NULL THEN
    IF NEW.total_price_cents IS DISTINCT FROM OLD.total_price_cents
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.commission_rate_bps IS DISTINCT FROM OLD.commission_rate_bps
       OR NEW.commission_amount_cents
            IS DISTINCT FROM OLD.commission_amount_cents
       OR NEW.trainer_net_amount_cents
            IS DISTINCT FROM OLD.trainer_net_amount_cents
    THEN
      RAISE EXCEPTION 'SINGLE_BOOKING_FINANCIAL_FIELDS_IMMUTABLE'
        USING ERRCODE = '23514';
    END IF;

    /*
     * De oorspronkelijke financiële boeking niet aan een
     * andere trainer of een pakketaankoop toewijzen.
     *
     * Geen player_id-beperking toevoegen: bestaande privacy-
     * en accountverwijderingsprocessen blijven buiten deze wijziging.
     */
    IF NEW.trainer_id IS DISTINCT FROM OLD.trainer_id
       OR NEW.package_purchase_id IS DISTINCT FROM OLD.package_purchase_id
    THEN
      RAISE EXCEPTION 'SINGLE_BOOKING_FINANCIAL_IDENTITY_IMMUTABLE'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.guard_single_booking_financial_fields()
FROM PUBLIC, anon, authenticated, service_role;

/*
 * Alle UPDATEs beoordelen, niet uitsluitend UPDATE OF:
 * ook wijzigingen door andere BEFORE-triggers moeten niet
 * onbedoeld buiten de controle vallen.
 *
 * De bestaande triggers hebben eerder sorterende namen.
 * Bij toekomstige nieuwe triggers moet de volgorde opnieuw
 * worden beoordeeld.
 */
CREATE TRIGGER zz_guard_single_booking_financial_fields
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.guard_single_booking_financial_fields();


-- MIGRATIE: register-single-transfer-admissions.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Toelating is geen transferopdracht en geen betaalbewijs.
 *
 * reservation_recorded:
 *   waarden vastgelegd bij INSERT van een nieuwe losse boeking.
 *
 * existing_booking_reviewed:
 *   bestaande waarden expliciet beoordeeld bij deze migratie.
 *   Geen verklaring van historische onveranderbaarheid.
 *
 * Nieuwe transfers moeten deze waarden opnieuw vergelijken
 * met de boeking, naast alle betaal-/refund-/claimcontroles.
 */
CREATE TABLE public.single_transfer_admissions (
  booking_id uuid PRIMARY KEY
    REFERENCES public.bookings(id) ON DELETE RESTRICT,

  trainer_id uuid NOT NULL,
  slot_id uuid NOT NULL,

  total_price_cents integer NOT NULL CHECK (total_price_cents > 0),
  currency text NOT NULL CHECK (currency = 'eur'),
  commission_rate_bps integer NOT NULL
    CHECK (commission_rate_bps BETWEEN 0 AND 3000),
  commission_amount_cents integer NOT NULL
    CHECK (commission_amount_cents >= 0),
  trainer_net_amount_cents integer NOT NULL
    CHECK (trainer_net_amount_cents > 0),

  evidence_kind text NOT NULL CHECK (
    evidence_kind IN (
      'reservation_recorded',
      'existing_booking_reviewed'
    )
  ),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
    CHECK (isfinite(recorded_at)),

  CONSTRAINT single_transfer_admission_amounts_match CHECK (
    total_price_cents::bigint =
      commission_amount_cents::bigint + trainer_net_amount_cents::bigint
  ),
  CONSTRAINT single_transfer_admission_commission_matches CHECK (
    commission_amount_cents =
      round(
        total_price_cents::numeric * commission_rate_bps::numeric / 10000
      )
  )
);

ALTER TABLE public.single_transfer_admissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.single_transfer_admissions
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.single_transfer_admissions
TO service_role;

/*
 * Geen browserpolicies.
 * Schrijven uitsluitend via de eigenaar/migratie en onderstaande
 * SECURITY DEFINER-trigger, niet rechtstreeks via service_role.
 */
CREATE FUNCTION public.record_single_transfer_admission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  /*
   * Alleen nieuwe losse reserveringen.
   * Oude pakketflow kan boekingen zonder package_purchase_id
   * invoegen; daarom ook het tijdslot controleren.
   *
   * Geen betaalpoging eisen: die wordt pas na de boeking
   * aangemaakt binnen de bestaande reserveringstransactie.
   */
  IF NEW.package_purchase_id IS NOT NULL
     OR NEW.status IS DISTINCT FROM 'payment_pending'
     OR NEW.paid_at IS NOT NULL
     OR NEW.currency IS DISTINCT FROM 'eur'
     OR NOT EXISTS (
       SELECT 1
       FROM public.availability_slots AS s
       WHERE s.id = NEW.slot_id
         AND s.package_id IS NULL
         AND s.trainer_id = NEW.trainer_id
     )
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.single_transfer_admissions (
    booking_id,
    trainer_id,
    slot_id,
    total_price_cents,
    currency,
    commission_rate_bps,
    commission_amount_cents,
    trainer_net_amount_cents,
    evidence_kind
  )
  VALUES (
    NEW.id,
    NEW.trainer_id,
    NEW.slot_id,
    NEW.total_price_cents,
    NEW.currency,
    NEW.commission_rate_bps,
    NEW.commission_amount_cents,
    NEW.trainer_net_amount_cents,
    'reservation_recorded'
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.record_single_transfer_admission()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER record_single_transfer_admission
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.record_single_transfer_admission();

/*
 * Geen automatische mutatie of verwijdering van de vastlegging.
 * Een correctie vereist afzonderlijk beoordeeld onderhoud.
 */
CREATE FUNCTION public.guard_single_transfer_admission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'TRANSFER_SINGLE_ADMISSION_IMMUTABLE'
    USING ERRCODE = '23514';
END;
$function$;

REVOKE ALL
ON FUNCTION public.guard_single_transfer_admission()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_single_transfer_admission
BEFORE UPDATE OR DELETE ON public.single_transfer_admissions
FOR EACH ROW
EXECUTE FUNCTION public.guard_single_transfer_admission();

/*
 * Eenmalige, expliciet beoordeelde bestaande boekingen.
 *
 * Gebruiker heeft voor beide bevestigd:
 * €80 totaal, 5% commissie = €4, trainersdeel €76.
 *
 * Niet toepassen op andere boekingen en nooit bestaande
 * boekingsbedragen wijzigen om ze passend te maken.
 */
DO $reviewed$
DECLARE
  v_booking_id uuid;
  v_inserted integer;
BEGIN
  FOREACH v_booking_id IN ARRAY ARRAY[
    'f0696131-6f54-4226-b4d6-6fe819f4a9cc'::uuid,
    'd534e4ef-de33-4a4b-9ad8-4dfcc8f067f2'::uuid
  ]
  LOOP
    /*
     * Boekingslock voor een consistente vastlegging.
     * Geen betaalpoginglock ná de boekingslock toevoegen.
     */
    PERFORM b.id
    FROM public.bookings AS b
    WHERE b.id = v_booking_id
    FOR UPDATE NOWAIT;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REVIEWED_BOOKING_MISSING';
    END IF;

    INSERT INTO public.single_transfer_admissions (
      booking_id,
      trainer_id,
      slot_id,
      total_price_cents,
      currency,
      commission_rate_bps,
      commission_amount_cents,
      trainer_net_amount_cents,
      evidence_kind
    )
    SELECT
      b.id,
      b.trainer_id,
      b.slot_id,
      b.total_price_cents,
      b.currency,
      b.commission_rate_bps,
      b.commission_amount_cents,
      b.trainer_net_amount_cents,
      'existing_booking_reviewed'
    FROM public.bookings AS b
    JOIN public.availability_slots AS s ON s.id = b.slot_id
    JOIN public.single_lesson_payment_attempts AS a
      ON a.booking_id = b.id
    WHERE b.id = v_booking_id
      AND b.trainer_id = '4c4a5ffc-7584-4ffb-9678-95d3a311c50e'::uuid
      AND b.package_purchase_id IS NULL
      AND s.package_id IS NULL
      AND s.trainer_id = b.trainer_id
      AND b.status IN ('confirmed', 'completed')
      AND b.paid_at IS NOT NULL
      AND b.trainer_payout_status = 'pending'
      AND b.stripe_transfer_id IS NULL
      AND b.trainer_paid_at IS NULL
      AND b.cancelled_at IS NULL
      AND b.stripe_refund_id IS NULL
      AND b.refunded_at IS NULL
      AND b.total_price_cents = 8000
      AND b.currency = 'eur'
      AND b.commission_rate_bps = 500
      AND b.commission_amount_cents = 400
      AND b.trainer_net_amount_cents = 7600
      AND a.channel = 'paymentsheet'
      AND a.status = 'succeeded'
      AND a.stripe_livemode = false
      AND a.funds_flow = 'separate_transfers_v1'
      AND a.trainer_id = b.trainer_id
      AND a.player_id = b.player_id
      AND a.slot_id = b.slot_id
      AND a.amount_cents = b.total_price_cents
      AND a.currency = b.currency
      AND a.stripe_payment_intent_id = b.stripe_payment_intent_id
      AND a.stripe_charge_id = b.stripe_charge_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.trainer_transfer_requests AS r
        WHERE r.booking_id = b.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.refund_requests AS r
        WHERE r.source_booking_id = b.id
           OR r.stripe_payment_intent_id = b.stripe_payment_intent_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.refund_request_items AS i
        WHERE i.booking_id = b.id
      );

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REVIEWED_CONTEXT_CHANGED';
    END IF;
  END LOOP;
END;
$reviewed$;


-- MIGRATIE: enforce-single-transfer-admission.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Verplicht toelatingsbewijs in de bestaande losse-lesbronreader.
 *
 * Alle aanroepers van die reader krijgen dezelfde controle:
 * broninspectie, registratie, claim, historie en prepare.
 *
 * Geen boekingsgegevens wijzigen of ontbrekende toelating
 * automatisch aanmaken.
 */
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
BEGIN
  IF to_regclass('public.single_transfer_admissions') IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ADMISSIONS_TABLE_MISSING';
  END IF;

  v_function_oid := to_regprocedure(
    'public.read_sandbox_single_transfer_source_context(uuid)'
  )::oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SOURCE_READER_MISSING';
  END IF;

  v_definition := replace(
    pg_get_functiondef(v_function_oid),
    chr(13),
    ''
  );

  v_old := $old$  IF v_booking.package_purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PACKAGE_NOT_ALLOWED';
  END IF;$old$;

  v_new := $new$  IF v_booking.package_purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_PACKAGE_NOT_ALLOWED';
  END IF;

  /*
   * Toelating moet vooraf bestaan.
   * reservation_recorded = vastlegging bij reservering.
   * existing_booking_reviewed = expliciete beoordeling van
   * bestaande gegevens, geen bewijs van historische onveranderbaarheid.
   *
   * Beide vereisen exact dezelfde financiële context als
   * de huidige boeking.
   */
  IF NOT EXISTS (
    SELECT 1
    FROM public.single_transfer_admissions AS a
    WHERE a.booking_id = v_booking.id
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ADMISSION_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.single_transfer_admissions AS a
    WHERE a.booking_id = v_booking.id
      AND a.trainer_id = v_booking.trainer_id
      AND a.slot_id = v_booking.slot_id
      AND a.total_price_cents = v_booking.total_price_cents
      AND a.currency = v_booking.currency
      AND a.commission_rate_bps = v_booking.commission_rate_bps
      AND a.commission_amount_cents = v_booking.commission_amount_cents
      AND a.trainer_net_amount_cents = v_booking.trainer_net_amount_cents
      AND a.evidence_kind IN (
        'reservation_recorded',
        'existing_booking_reviewed'
      )
      AND isfinite(a.recorded_at)
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ADMISSION_CONTEXT_MISMATCH';
  END IF;$new$;

  v_occurrences := (
    length(v_definition)
    - length(replace(v_definition, v_old, ''))
  ) / length(v_old);

  IF v_occurrences IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_ADMISSION_PATCH_MISMATCH';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);

  /*
   * CREATE OR REPLACE behoudt eigenaar en bestaande uitvoerrechten.
   * Deze migratie roept de bronreader niet aan.
   */
  EXECUTE v_definition;
END;
$migration$;


-- MIGRATIE: extend-sandbox-transfer-selector-single-lessons.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.claim_next_sandbox_trainer_transfer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_candidate record;
  v_claim jsonb;
  v_error_message text;
  v_error_code text;
  v_now timestamptz;
  v_considered integer := 0;
  v_deferred integer := 0;
  v_busy integer := 0;
BEGIN
  /*
   * Voorselectie geeft geen uitvoeringsautorisatie.
   *
   * Pakket:
   *   bestaande betaalde sandboxpakketcontext.
   *
   * Losse les:
   *   geen pakketaankoop en een vooraf geregistreerde toelating.
   *   De toelating is geen Stripe-betaalbewijs.
   *
   * De kandidaatfuncties hercontroleren de actuele context.
   * Maximaal tien kandidaten beoordelen, maximaal één claim.
   */
  FOR v_candidate IN
    SELECT
      b.id AS booking_id,
      b.trainer_id,
      b.package_purchase_id
    FROM public.bookings AS b
    LEFT JOIN public.package_purchases AS p
      ON p.id = b.package_purchase_id
    LEFT JOIN public.trainer_transfer_requests AS r
      ON r.booking_id = b.id
    LEFT JOIN public.trainer_transfer_execution_schedule AS s
      ON s.booking_id = b.id
    WHERE (
      (
        b.package_purchase_id IS NOT NULL
        AND p.trainer_id = b.trainer_id
        AND p.stripe_livemode = false
        AND p.funds_flow = 'separate_transfers_v1'
      )
      OR (
        b.package_purchase_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.single_transfer_admissions AS a
          WHERE a.booking_id = b.id
        )
      )
    )
      AND b.status IN ('confirmed', 'completed')
      AND b.paid_at IS NOT NULL
      AND b.trainer_payout_status IN ('pending', 'eligible')
      AND b.trainer_net_amount_cents > 0
      AND b.stripe_transfer_id IS NULL
      AND b.trainer_paid_at IS NULL
      AND isfinite(b.trainer_payout_eligible_at)
      AND b.trainer_payout_eligible_at <= clock_timestamp()
      AND (
        s.booking_id IS NULL
        OR s.next_check_at <= clock_timestamp()
      )
      AND (
        r.id IS NULL
        OR (
          r.status = 'queued'
          AND r.attempts = 0
          AND r.first_stripe_request_at IS NULL
          AND r.stripe_request_payload IS NULL
          AND r.stripe_transfer_id IS NULL
          AND r.succeeded_at IS NULL
          AND r.applied_at IS NULL
          AND r.lock_token IS NULL
          AND r.locked_until IS NULL
          AND isfinite(r.available_at)
          AND r.available_at <= clock_timestamp()
          AND isfinite(r.eligible_at)
          AND r.eligible_at <= clock_timestamp()
          AND r.stripe_livemode = false
          AND r.funds_flow = 'separate_transfers_v1'
        )
      )
    ORDER BY
      COALESCE(s.next_check_at, b.trainer_payout_eligible_at),
      b.id
    LIMIT 10
  LOOP
    v_considered := v_considered + 1;
    v_error_code := NULL;
    v_claim := NULL;

    BEGIN
      IF v_candidate.package_purchase_id IS NULL THEN
        v_claim :=
          public.register_and_claim_sandbox_single_transfer_candidate(
            v_candidate.booking_id
          );
      ELSE
        v_claim :=
          public.register_and_claim_sandbox_transfer_candidate(
            v_candidate.booking_id
          );
      END IF;

      IF v_claim IS NOT NULL THEN
        /*
         * De kandidaatfunctie heeft registratie en claim
         * transactioneel uitgevoerd en houdt de locks vast.
         */
        v_now := clock_timestamp();

        INSERT INTO public.trainer_transfer_execution_schedule (
          booking_id,
          next_check_at,
          last_checked_at,
          last_error_code,
          consecutive_failures,
          created_at,
          updated_at
        )
        VALUES (
          v_candidate.booking_id,
          v_now + interval '15 minutes',
          v_now,
          NULL,
          0,
          v_now,
          v_now
        )
        ON CONFLICT (booking_id) DO UPDATE
        SET
          next_check_at = EXCLUDED.next_check_at,
          last_checked_at = EXCLUDED.last_checked_at,
          last_error_code = NULL,
          consecutive_failures = 0,
          updated_at = EXCLUDED.updated_at;

        RETURN jsonb_build_object(
          'result', 'claimed',
          'claim', v_claim,
          'considered', v_considered,
          'deferred', v_deferred,
          'busy', v_busy
        );
      END IF;

    EXCEPTION
      WHEN lock_not_available THEN
        v_busy := v_busy + 1;

      WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS
          v_error_message = MESSAGE_TEXT;

        /*
         * Alleen exact bekende blokkades duurzaam uitstellen.
         * Geen vrije fouttekst opslaan.
         * Onbekende fouten blijven de gehele aanroep afbreken.
         */
        v_error_code := CASE v_error_message
          -- Bestaande pakketblokkades.
          WHEN 'TRANSFER_PURCHASE_REFUND_REQUIRES_REVIEW'
            THEN 'TRANSFER_PURCHASE_REFUND_REQUIRES_REVIEW'
          WHEN 'Een open probleemmelding blokkeert deze trainertransfer.'
            THEN 'TRANSFER_AUTO_OPEN_BOOKING_ISSUE'
          WHEN 'Een open Connect-probleem blokkeert deze trainertransfer.'
            THEN 'TRANSFER_AUTO_OPEN_CONNECT_INCIDENT'
          WHEN 'Geen open v2-testkoppeling met bevestigde actieve transfercapability.'
            THEN 'TRANSFER_AUTO_DESTINATION_NOT_READY'
          WHEN 'Voor deze les bestaat een refundregistratie. Geen transfer toegestaan.'
            THEN 'TRANSFER_AUTO_BOOKING_REFUND_PRESENT'

          -- Expliciete blokkades voor losse lessen.
          WHEN 'TRANSFER_SINGLE_REFUND_REQUIRES_REVIEW'
            THEN 'TRANSFER_SINGLE_REFUND_REQUIRES_REVIEW'
          WHEN 'TRANSFER_SINGLE_OPEN_BOOKING_ISSUE'
            THEN 'TRANSFER_SINGLE_OPEN_BOOKING_ISSUE'
          WHEN 'TRANSFER_SINGLE_OPEN_CONNECT_INCIDENT'
            THEN 'TRANSFER_SINGLE_OPEN_CONNECT_INCIDENT'
          WHEN 'TRANSFER_SINGLE_DESTINATION_NOT_READY'
            THEN 'TRANSFER_SINGLE_DESTINATION_NOT_READY'
          WHEN 'TRANSFER_SINGLE_ADMISSION_REQUIRED'
            THEN 'TRANSFER_SINGLE_ADMISSION_REQUIRED'
          WHEN 'TRANSFER_SINGLE_ADMISSION_CONTEXT_MISMATCH'
            THEN 'TRANSFER_SINGLE_ADMISSION_CONTEXT_MISMATCH'
          ELSE NULL
        END;

        IF v_error_code IS NULL THEN
          RAISE;
        END IF;
    END;

    IF v_error_code IS NOT NULL THEN
      /*
       * De mislukte kandidaat-aanroep is teruggedraaid.
       * Alleen selectieplanning schrijven, geen financiële opdracht.
       *
       * Pakket: aankoop -> boeking.
       * Losse les: boeking.
       *
       * Geen betaalpoging of refundopdracht ná de boeking locken.
       */
      BEGIN
        IF v_candidate.package_purchase_id IS NOT NULL THEN
          PERFORM p.id
          FROM public.package_purchases AS p
          WHERE p.id = v_candidate.package_purchase_id
            AND p.trainer_id = v_candidate.trainer_id
            AND p.stripe_livemode = false
            AND p.funds_flow = 'separate_transfers_v1'
          FOR UPDATE NOWAIT;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'TRANSFER_AUTO_SCHEDULE_CONTEXT_CHANGED';
          END IF;
        END IF;

        PERFORM b.id
        FROM public.bookings AS b
        WHERE b.id = v_candidate.booking_id
          AND b.package_purchase_id
                IS NOT DISTINCT FROM v_candidate.package_purchase_id
          AND b.trainer_id = v_candidate.trainer_id
        FOR UPDATE NOWAIT;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'TRANSFER_AUTO_SCHEDULE_CONTEXT_CHANGED';
        END IF;

        /*
         * Geen oude afwijzing opslaan als een andere sessie
         * ondertussen verwerking heeft gestart.
         */
        IF EXISTS (
          SELECT 1
          FROM public.bookings AS b
          WHERE b.id = v_candidate.booking_id
            AND b.trainer_payout_status IN ('pending', 'eligible')
            AND b.stripe_transfer_id IS NULL
            AND b.trainer_paid_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.trainer_transfer_requests AS r
          WHERE r.booking_id = v_candidate.booking_id
            AND (
              r.status IS DISTINCT FROM 'queued'
              OR r.attempts IS DISTINCT FROM 0
              OR r.first_stripe_request_at IS NOT NULL
              OR r.stripe_request_payload IS NOT NULL
              OR r.stripe_transfer_id IS NOT NULL
              OR r.succeeded_at IS NOT NULL
              OR r.applied_at IS NOT NULL
              OR r.lock_token IS NOT NULL
              OR r.locked_until IS NOT NULL
            )
        ) THEN
          v_now := clock_timestamp();

          INSERT INTO public.trainer_transfer_execution_schedule (
            booking_id,
            next_check_at,
            last_checked_at,
            last_error_code,
            consecutive_failures,
            created_at,
            updated_at
          )
          VALUES (
            v_candidate.booking_id,
            v_now + interval '15 minutes',
            v_now,
            v_error_code,
            1,
            v_now,
            v_now
          )
          ON CONFLICT (booking_id) DO UPDATE
          SET
            next_check_at = greatest(
              public.trainer_transfer_execution_schedule.next_check_at,
              EXCLUDED.next_check_at
            ),
            last_checked_at = EXCLUDED.last_checked_at,
            last_error_code = EXCLUDED.last_error_code,
            consecutive_failures = (
              least(
                public.trainer_transfer_execution_schedule
                  .consecutive_failures::bigint + 1,
                2147483647::bigint
              )
            )::integer,
            updated_at = EXCLUDED.updated_at
          WHERE
            public.trainer_transfer_execution_schedule.next_check_at
              <= v_now;

          IF FOUND THEN
            v_deferred := v_deferred + 1;
          END IF;
        END IF;

      EXCEPTION
        WHEN lock_not_available THEN
          v_busy := v_busy + 1;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'result', 'not_claimed',
    'considered', v_considered,
    'deferred', v_deferred,
    'busy', v_busy
  );
END;
$function$;

/*
 * De bestaande selector behoudt bij CREATE OR REPLACE zijn ACL.
 *
 * De uitvoerder heeft voor losse lessen alleen nog EXECUTE
 * op de nieuwe preparefunctie nodig. Registratie en claim
 * blijven intern en worden via de selector aangeroepen.
 */
REVOKE ALL
ON FUNCTION public.prepare_sandbox_single_trainer_transfer(
  uuid, uuid, jsonb, jsonb, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.prepare_sandbox_single_trainer_transfer(
  uuid, uuid, jsonb, jsonb, jsonb
)
TO service_role;


COMMIT;
