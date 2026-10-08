BEGIN;

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

COMMIT;