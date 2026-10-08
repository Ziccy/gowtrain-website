BEGIN;

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

COMMIT;