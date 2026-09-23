BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $cleanup$
DECLARE
  v_booking_id CONSTANT uuid :=
    'a38c7201-6f4b-4d9e-8a21-470ef58d6301';

  v_request_id CONSTANT uuid :=
    'a38c7202-6f4b-4d9e-8a21-470ef58d6302';

  v_trainer_id CONSTANT uuid :=
    '4c4a5ffc-7584-4ffb-9678-95d3a311c50e';

  v_purchase_id CONSTANT uuid :=
    '0ceb3427-c520-4351-9cb4-e2fb9ea08069';

  v_request public.trainer_transfer_requests%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_has_request boolean;
  v_has_booking boolean;
BEGIN
  -- Vaste volgorde: opdracht -> onderzoeken -> fixtureboeking.
  SELECT r.*
  INTO v_request
  FROM public.trainer_transfer_requests AS r
  WHERE r.id = v_request_id
  FOR UPDATE;

  v_has_request := FOUND;

  PERFORM c.id
  FROM public.trainer_transfer_recovery_checks AS c
  WHERE c.request_id = v_request_id
  FOR UPDATE;

  SELECT b.*
  INTO v_booking
  FROM public.bookings AS b
  WHERE b.id = v_booking_id
  FOR UPDATE;

  v_has_booking := FOUND;

  IF v_has_request THEN
    IF NOT v_has_booking THEN
      RAISE EXCEPTION
        'OPRUIMING GESTOPT: fixtureopdracht zonder fixtureboeking.';
    END IF;

    IF v_request.booking_id IS DISTINCT FROM v_booking_id
       OR v_request.trainer_id IS DISTINCT FROM v_trainer_id
       OR v_request.source_package_purchase_id
            IS DISTINCT FROM v_purchase_id
       OR v_request.destination_account_id IS DISTINCT FROM
            'acct_RECOVERYCONCURRENCYTEST'
       OR v_request.stripe_payment_intent_id IS DISTINCT FROM
            'pi_RECOVERYCONCURRENCYTEST'
       OR v_request.stripe_idempotency_key IS DISTINCT FROM
            ('gowtrain-trainer-transfer/' || v_request_id::text)
       OR v_request.stripe_livemode IS DISTINCT FROM false
       OR v_request.funds_flow IS DISTINCT FROM 'separate_transfers_v1'
       OR v_request.status IS DISTINCT FROM 'review_required'
       OR v_request.amount_cents IS DISTINCT FROM 1900
       OR v_request.currency IS DISTINCT FROM 'eur'
       OR v_request.attempts IS DISTINCT FROM 0
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
      RAISE EXCEPTION
        'OPRUIMING GESTOPT: opdracht wijkt af van onvoorbereide testfixture.';
    END IF;
  END IF;

  IF v_has_booking THEN
    IF v_booking.trainer_id IS DISTINCT FROM v_trainer_id
       OR v_booking.package_purchase_id IS DISTINCT FROM v_purchase_id
       OR v_booking.player_name IS DISTINCT FROM
            'RECOVERY_CONCURRENCY_FIXTURE'
       OR v_booking.player_email IS DISTINCT FROM
            'recovery-concurrency@example.invalid'
       OR v_booking.status IS DISTINCT FROM 'payment_pending'
       OR v_booking.trainer_payout_status IS DISTINCT FROM 'processing'
       OR v_booking.participant_count IS DISTINCT FROM 1
       OR v_booking.total_price_cents IS DISTINCT FROM 2000
       OR v_booking.commission_rate_bps IS DISTINCT FROM 500
       OR v_booking.commission_amount_cents IS DISTINCT FROM 100
       OR v_booking.trainer_net_amount_cents IS DISTINCT FROM 1900
       OR v_booking.currency IS DISTINCT FROM 'eur'
       OR v_booking.slot_id IS NOT NULL
       OR v_booking.player_id IS NOT NULL
       OR v_booking.hold_expires_at IS NOT NULL
       OR v_booking.paid_at IS NOT NULL
       OR v_booking.trainer_paid_at IS NOT NULL
       OR v_booking.stripe_payment_intent_id IS NOT NULL
       OR v_booking.stripe_checkout_session_id IS NOT NULL
       OR v_booking.stripe_charge_id IS NOT NULL
       OR v_booking.stripe_transfer_id IS NOT NULL
       OR v_booking.stripe_refund_id IS NOT NULL
       OR v_booking.refunded_at IS NOT NULL
       OR v_booking.cancelled_at IS NOT NULL
       OR v_booking.completed_at IS NOT NULL
    THEN
      RAISE EXCEPTION
        'OPRUIMING GESTOPT: boeking wijkt af van onbetaalde testfixture.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.trainer_transfer_requests AS r
      WHERE r.booking_id = v_booking_id
        AND r.id <> v_request_id
    ) THEN
      RAISE EXCEPTION
        'OPRUIMING GESTOPT: andere opdracht verwijst naar fixtureboeking.';
    END IF;
  END IF;

  /*
   * Een onderzoek dat een werkelijk transferresultaat suggereert
   * niet via deze fixture-opruiming verwijderen.
   */
  IF EXISTS (
    SELECT 1
    FROM public.trainer_transfer_recovery_checks AS c
    WHERE c.request_id = v_request_id
      AND (
        c.stripe_transfer_id IS NOT NULL
        OR c.outcome IN ('applied', 'already_applied')
      )
  ) THEN
    RAISE EXCEPTION
      'OPRUIMING GESTOPT: onderzoek bevat een transferresultaat.';
  END IF;

  DELETE FROM public.trainer_transfer_recovery_checks
  WHERE request_id = v_request_id;

  DELETE FROM public.trainer_transfer_requests
  WHERE id = v_request_id;

  DELETE FROM public.bookings
  WHERE id = v_booking_id;

  /*
   * Geen CASCADE en geen uitschakeling van triggers of constraints.
   * Onverwachte verwijzingen laten de transactie dus mislukken.
   */
  IF EXISTS (
    SELECT 1 FROM public.trainer_transfer_recovery_checks
    WHERE request_id = v_request_id
  ) OR EXISTS (
    SELECT 1 FROM public.trainer_transfer_requests
    WHERE id = v_request_id
  ) OR EXISTS (
    SELECT 1 FROM public.bookings
    WHERE id = v_booking_id
  ) THEN
    RAISE EXCEPTION 'OPRUIMING MISLUKT: fixturegegevens bestaan nog.';
  END IF;
END;
$cleanup$;

COMMIT;

SELECT
  NOT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE id = 'a38c7201-6f4b-4d9e-8a21-470ef58d6301'::uuid
  ) AS fixture_booking_absent,
  NOT EXISTS (
    SELECT 1 FROM public.trainer_transfer_requests
    WHERE id = 'a38c7202-6f4b-4d9e-8a21-470ef58d6302'::uuid
  ) AS fixture_request_absent,
  NOT EXISTS (
    SELECT 1 FROM public.trainer_transfer_recovery_checks
    WHERE request_id =
      'a38c7202-6f4b-4d9e-8a21-470ef58d6302'::uuid
  ) AS fixture_checks_absent;