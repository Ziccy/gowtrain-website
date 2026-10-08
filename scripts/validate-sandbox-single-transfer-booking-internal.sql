BEGIN;

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

COMMIT;