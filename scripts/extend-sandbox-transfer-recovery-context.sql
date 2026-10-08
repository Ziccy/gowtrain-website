BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Alleen structurele herkenning voor herstelonderzoek.
 *
 * GEEN toestemming voor registratie, claim, prepare of verzending.
 * GEEN nieuwe beoordeling van refundrecht of Connect-geschiktheid.
 *
 * Een latere refund, annulering of gewijzigde bestemming mag
 * onderzoek naar een mogelijk uitgevoerde transfer niet op zichzelf
 * onmogelijk maken.
 *
 * De opgeslagen bestemming en payload worden verderop door
 * de bestaande zoek- en synchronisatieketen gecontroleerd.
 */
CREATE FUNCTION public.is_sandbox_single_transfer_recovery_context(
  p_request_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.trainer_transfer_requests AS r
    JOIN public.bookings AS b
      ON b.id = r.booking_id
    JOIN public.availability_slots AS s
      ON s.id = b.slot_id
    WHERE r.id = p_request_id
      AND r.source_package_purchase_id IS NULL
      AND b.package_purchase_id IS NULL
      AND s.package_id IS NULL
      AND s.trainer_id = b.trainer_id
      AND b.trainer_id = r.trainer_id
      AND b.paid_at IS NOT NULL
      AND isfinite(b.paid_at)
      AND b.stripe_payment_intent_id = r.stripe_payment_intent_id
      AND r.stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
      AND r.amount_cents > 0
      AND b.trainer_net_amount_cents = r.amount_cents
      AND b.currency = r.currency
      AND r.currency = 'eur'
      AND r.stripe_livemode = false
      AND r.funds_flow = 'separate_transfers_v1'
      AND r.stripe_idempotency_key =
        'gowtrain-trainer-transfer/' || r.id::text
  );
$function$;

REVOKE ALL
ON FUNCTION public.is_sandbox_single_transfer_recovery_context(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.is_sandbox_single_transfer_recovery_context(uuid)
TO service_role;

/*
 * Exacte, gecontroleerde vervangingen in bestaande definities.
 *
 * Geen globale vervanging van pakketvoorwaarden.
 * Alleen onderstaande zes functies en de opgegeven fragmenten.
 *
 * De overige functiebody, SECURITY DEFINER, search_path,
 * eigenaar en bestaande uitvoerrechten blijven behouden.
 *
 * Dit script is bewust niet herhaalbaar:
 * bij een al toegepaste of afwijkende definitie stopt het.
 */
DO $migration$
DECLARE
  v_patch record;
  v_function_oid oid;
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
BEGIN
  FOR v_patch IN
    SELECT *
    FROM (
      VALUES
        (
          'public.start_sandbox_transfer_recovery_check(uuid)',
          true,
          false
        ),
        (
          'public.start_next_sandbox_transfer_recovery_check()',
          true,
          true
        ),
        (
          'public.expire_next_sandbox_transfer_recovery_check()',
          false,
          true
        ),
        (
          'public.expire_sandbox_transfer_recovery_check(uuid)',
          true,
          false
        ),
        (
          'public.finish_sandbox_transfer_recovery_check(uuid,text,text,text)',
          true,
          false
        ),
        (
          'public.record_sandbox_transfer_recovery_scan(uuid,timestamp with time zone,timestamp with time zone,integer,text,text,jsonb)',
          true,
          false
        )
    ) AS patches(
      function_signature,
      replace_request_guard,
      replace_selector_filter
    )
  LOOP
    v_function_oid :=
      to_regprocedure(v_patch.function_signature)::oid;

    IF v_function_oid IS NULL THEN
      RAISE EXCEPTION
        'RECOVERY_CONTEXT_MIGRATION_FUNCTION_MISSING: %',
        v_patch.function_signature;
    END IF;

    v_definition := pg_get_functiondef(v_function_oid);

    IF v_patch.replace_request_guard THEN
      v_old :=
        'OR v_request.source_package_purchase_id IS NULL';

      v_new :=
        'OR (
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
          'RECOVERY_CONTEXT_MIGRATION_GUARD_MISMATCH: %',
          v_patch.function_signature;
      END IF;

      v_definition := replace(v_definition, v_old, v_new);
    END IF;

    IF v_patch.replace_selector_filter THEN
      v_old :=
        'AND r.source_package_purchase_id IS NOT NULL';

      v_new :=
        'AND (
      r.source_package_purchase_id IS NOT NULL
      OR public.is_sandbox_single_transfer_recovery_context(r.id)
    )';

      v_occurrences := (
        length(v_definition)
        - length(replace(v_definition, v_old, ''))
      ) / length(v_old);

      IF v_occurrences IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION
          'RECOVERY_CONTEXT_MIGRATION_SELECTOR_MISMATCH: %',
          v_patch.function_signature;
      END IF;

      v_definition := replace(v_definition, v_old, v_new);
    END IF;

    /*
     * De afwijzing betreft na uitbreiding beide bronsoorten.
     * Functies met een vaste diagnostische code behouden die code.
     */
    v_definition := replace(
      v_definition,
      'Geen ondersteunde pakkettesttransfer.',
      'Geen ondersteunde sandboxtransfercontext.'
    );

    EXECUTE v_definition;
  END LOOP;
END;
$migration$;

COMMIT;