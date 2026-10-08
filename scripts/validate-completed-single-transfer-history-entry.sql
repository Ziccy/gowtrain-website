BEGIN;

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

COMMIT;