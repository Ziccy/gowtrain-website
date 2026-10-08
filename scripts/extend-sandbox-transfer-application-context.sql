BEGIN;

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

COMMIT;