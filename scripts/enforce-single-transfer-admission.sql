BEGIN;

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

COMMIT;