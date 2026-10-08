BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

/*
 * Verrijkt de bestaande historieloader.
 *
 * Geen verandering aan:
 * - selectiebereik;
 * - status- of omgevingsfilters;
 * - limiet van 2000 opdrachten;
 * - detectie van boekingen met onverklaarde transferhistorie.
 *
 * Geen volledige betaalpayload, client secret of persoonsgegevens
 * toevoegen aan de projectie.
 */
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_patch record;
  v_occurrences integer;
BEGIN
  v_function_oid := to_regprocedure(
    'public.read_sandbox_trainer_transfer_history(uuid,text)'
  )::oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_HISTORY_PROJECTION_FUNCTION_MISSING';
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
        'booking_source_fields',
        $old$            'total_price_cents', b.total_price_cents,
            'commission_amount_cents', b.commission_amount_cents,$old$,
        $new$            'total_price_cents', b.total_price_cents,
            'commission_rate_bps', b.commission_rate_bps,
            'stripe_checkout_session_id', b.stripe_checkout_session_id,
            'stripe_payment_intent_id', b.stripe_payment_intent_id,
            'stripe_charge_id', b.stripe_charge_id,
            'slot_id', b.slot_id,
            'participant_count', b.participant_count,
            'original_starts_at', b.original_starts_at,
            'commission_amount_cents', b.commission_amount_cents,$new$
      ),
      (
        2,
        'payment_attempt_projection',
        $old$        'purchase', CASE WHEN original.id IS NULL THEN NULL ELSE$old$,
        $new$        /*
         * Bij een legacy Checkout-boeking bestaat geen nieuwe
         * betaalpoging. NULL is daar een expliciete bronvariant,
         * geen reden om betalingscontroles over te slaan.
         *
         * Een aanwezige afwijkende poging blijft zichtbaar.
         * Niet filteren op succeeded, paymentsheet of testmode.
         *
         * De bestaande unieke booking_id-constraint maakt
         * deze scalaire subquery eenduidig.
         */
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
        'purchase', CASE WHEN original.id IS NULL THEN NULL ELSE$new$
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
        'TRANSFER_HISTORY_PROJECTION_BLOCK_MISMATCH: %',
        v_patch.label;
    END IF;

    v_definition := replace(
      v_definition,
      v_patch.old_text,
      v_patch.new_text
    );
  END LOOP;

  /*
   * Behoudt de bestaande functie-eigenaar en uitvoerrechten.
   * Alleen de definitie aanpassen; geen historie-inspectie uitvoeren.
   */
  EXECUTE v_definition;
END;
$migration$;

COMMIT;