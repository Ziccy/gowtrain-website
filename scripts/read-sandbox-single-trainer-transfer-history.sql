BEGIN;

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

COMMIT;