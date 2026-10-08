BEGIN;

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

COMMIT;