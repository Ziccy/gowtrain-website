BEGIN;

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

COMMIT;