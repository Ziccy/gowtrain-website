BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.claim_next_sandbox_trainer_transfer()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_candidate record;
  v_claim jsonb;
  v_error_message text;
  v_error_code text;
  v_now timestamptz;
  v_considered integer := 0;
  v_deferred integer := 0;
  v_busy integer := 0;
BEGIN
  /*
   * Voorselectie geeft geen uitvoeringsautorisatie.
   *
   * Pakket:
   *   bestaande betaalde sandboxpakketcontext.
   *
   * Losse les:
   *   geen pakketaankoop en een vooraf geregistreerde toelating.
   *   De toelating is geen Stripe-betaalbewijs.
   *
   * De kandidaatfuncties hercontroleren de actuele context.
   * Maximaal tien kandidaten beoordelen, maximaal één claim.
   */
  FOR v_candidate IN
    SELECT
      b.id AS booking_id,
      b.trainer_id,
      b.package_purchase_id
    FROM public.bookings AS b
    LEFT JOIN public.package_purchases AS p
      ON p.id = b.package_purchase_id
    LEFT JOIN public.trainer_transfer_requests AS r
      ON r.booking_id = b.id
    LEFT JOIN public.trainer_transfer_execution_schedule AS s
      ON s.booking_id = b.id
    WHERE (
      (
        b.package_purchase_id IS NOT NULL
        AND p.trainer_id = b.trainer_id
        AND p.stripe_livemode = false
        AND p.funds_flow = 'separate_transfers_v1'
      )
      OR (
        b.package_purchase_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.single_transfer_admissions AS a
          WHERE a.booking_id = b.id
        )
      )
    )
      AND b.status IN ('confirmed', 'completed')
      AND b.paid_at IS NOT NULL
      AND b.trainer_payout_status IN ('pending', 'eligible')
      AND b.trainer_net_amount_cents > 0
      AND b.stripe_transfer_id IS NULL
      AND b.trainer_paid_at IS NULL
      AND isfinite(b.trainer_payout_eligible_at)
      AND b.trainer_payout_eligible_at <= clock_timestamp()
      AND (
        s.booking_id IS NULL
        OR s.next_check_at <= clock_timestamp()
      )
      AND (
        r.id IS NULL
        OR (
          r.status = 'queued'
          AND r.attempts = 0
          AND r.first_stripe_request_at IS NULL
          AND r.stripe_request_payload IS NULL
          AND r.stripe_transfer_id IS NULL
          AND r.succeeded_at IS NULL
          AND r.applied_at IS NULL
          AND r.lock_token IS NULL
          AND r.locked_until IS NULL
          AND isfinite(r.available_at)
          AND r.available_at <= clock_timestamp()
          AND isfinite(r.eligible_at)
          AND r.eligible_at <= clock_timestamp()
          AND r.stripe_livemode = false
          AND r.funds_flow = 'separate_transfers_v1'
        )
      )
    ORDER BY
      COALESCE(s.next_check_at, b.trainer_payout_eligible_at),
      b.id
    LIMIT 10
  LOOP
    v_considered := v_considered + 1;
    v_error_code := NULL;
    v_claim := NULL;

    BEGIN
      IF v_candidate.package_purchase_id IS NULL THEN
        v_claim :=
          public.register_and_claim_sandbox_single_transfer_candidate(
            v_candidate.booking_id
          );
      ELSE
        v_claim :=
          public.register_and_claim_sandbox_transfer_candidate(
            v_candidate.booking_id
          );
      END IF;

      IF v_claim IS NOT NULL THEN
        /*
         * De kandidaatfunctie heeft registratie en claim
         * transactioneel uitgevoerd en houdt de locks vast.
         */
        v_now := clock_timestamp();

        INSERT INTO public.trainer_transfer_execution_schedule (
          booking_id,
          next_check_at,
          last_checked_at,
          last_error_code,
          consecutive_failures,
          created_at,
          updated_at
        )
        VALUES (
          v_candidate.booking_id,
          v_now + interval '15 minutes',
          v_now,
          NULL,
          0,
          v_now,
          v_now
        )
        ON CONFLICT (booking_id) DO UPDATE
        SET
          next_check_at = EXCLUDED.next_check_at,
          last_checked_at = EXCLUDED.last_checked_at,
          last_error_code = NULL,
          consecutive_failures = 0,
          updated_at = EXCLUDED.updated_at;

        RETURN jsonb_build_object(
          'result', 'claimed',
          'claim', v_claim,
          'considered', v_considered,
          'deferred', v_deferred,
          'busy', v_busy
        );
      END IF;

    EXCEPTION
      WHEN lock_not_available THEN
        v_busy := v_busy + 1;

      WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS
          v_error_message = MESSAGE_TEXT;

        /*
         * Alleen exact bekende blokkades duurzaam uitstellen.
         * Geen vrije fouttekst opslaan.
         * Onbekende fouten blijven de gehele aanroep afbreken.
         */
        v_error_code := CASE v_error_message
          -- Bestaande pakketblokkades.
          WHEN 'TRANSFER_PURCHASE_REFUND_REQUIRES_REVIEW'
            THEN 'TRANSFER_PURCHASE_REFUND_REQUIRES_REVIEW'
          WHEN 'Een open probleemmelding blokkeert deze trainertransfer.'
            THEN 'TRANSFER_AUTO_OPEN_BOOKING_ISSUE'
          WHEN 'Een open Connect-probleem blokkeert deze trainertransfer.'
            THEN 'TRANSFER_AUTO_OPEN_CONNECT_INCIDENT'
          WHEN 'Geen open v2-testkoppeling met bevestigde actieve transfercapability.'
            THEN 'TRANSFER_AUTO_DESTINATION_NOT_READY'
          WHEN 'Voor deze les bestaat een refundregistratie. Geen transfer toegestaan.'
            THEN 'TRANSFER_AUTO_BOOKING_REFUND_PRESENT'

          -- Expliciete blokkades voor losse lessen.
          WHEN 'TRANSFER_SINGLE_REFUND_REQUIRES_REVIEW'
            THEN 'TRANSFER_SINGLE_REFUND_REQUIRES_REVIEW'
          WHEN 'TRANSFER_SINGLE_OPEN_BOOKING_ISSUE'
            THEN 'TRANSFER_SINGLE_OPEN_BOOKING_ISSUE'
          WHEN 'TRANSFER_SINGLE_OPEN_CONNECT_INCIDENT'
            THEN 'TRANSFER_SINGLE_OPEN_CONNECT_INCIDENT'
          WHEN 'TRANSFER_SINGLE_DESTINATION_NOT_READY'
            THEN 'TRANSFER_SINGLE_DESTINATION_NOT_READY'
          WHEN 'TRANSFER_SINGLE_ADMISSION_REQUIRED'
            THEN 'TRANSFER_SINGLE_ADMISSION_REQUIRED'
          WHEN 'TRANSFER_SINGLE_ADMISSION_CONTEXT_MISMATCH'
            THEN 'TRANSFER_SINGLE_ADMISSION_CONTEXT_MISMATCH'
          ELSE NULL
        END;

        IF v_error_code IS NULL THEN
          RAISE;
        END IF;
    END;

    IF v_error_code IS NOT NULL THEN
      /*
       * De mislukte kandidaat-aanroep is teruggedraaid.
       * Alleen selectieplanning schrijven, geen financiële opdracht.
       *
       * Pakket: aankoop -> boeking.
       * Losse les: boeking.
       *
       * Geen betaalpoging of refundopdracht ná de boeking locken.
       */
      BEGIN
        IF v_candidate.package_purchase_id IS NOT NULL THEN
          PERFORM p.id
          FROM public.package_purchases AS p
          WHERE p.id = v_candidate.package_purchase_id
            AND p.trainer_id = v_candidate.trainer_id
            AND p.stripe_livemode = false
            AND p.funds_flow = 'separate_transfers_v1'
          FOR UPDATE NOWAIT;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'TRANSFER_AUTO_SCHEDULE_CONTEXT_CHANGED';
          END IF;
        END IF;

        PERFORM b.id
        FROM public.bookings AS b
        WHERE b.id = v_candidate.booking_id
          AND b.package_purchase_id
                IS NOT DISTINCT FROM v_candidate.package_purchase_id
          AND b.trainer_id = v_candidate.trainer_id
        FOR UPDATE NOWAIT;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'TRANSFER_AUTO_SCHEDULE_CONTEXT_CHANGED';
        END IF;

        /*
         * Geen oude afwijzing opslaan als een andere sessie
         * ondertussen verwerking heeft gestart.
         */
        IF EXISTS (
          SELECT 1
          FROM public.bookings AS b
          WHERE b.id = v_candidate.booking_id
            AND b.trainer_payout_status IN ('pending', 'eligible')
            AND b.stripe_transfer_id IS NULL
            AND b.trainer_paid_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.trainer_transfer_requests AS r
          WHERE r.booking_id = v_candidate.booking_id
            AND (
              r.status IS DISTINCT FROM 'queued'
              OR r.attempts IS DISTINCT FROM 0
              OR r.first_stripe_request_at IS NOT NULL
              OR r.stripe_request_payload IS NOT NULL
              OR r.stripe_transfer_id IS NOT NULL
              OR r.succeeded_at IS NOT NULL
              OR r.applied_at IS NOT NULL
              OR r.lock_token IS NOT NULL
              OR r.locked_until IS NOT NULL
            )
        ) THEN
          v_now := clock_timestamp();

          INSERT INTO public.trainer_transfer_execution_schedule (
            booking_id,
            next_check_at,
            last_checked_at,
            last_error_code,
            consecutive_failures,
            created_at,
            updated_at
          )
          VALUES (
            v_candidate.booking_id,
            v_now + interval '15 minutes',
            v_now,
            v_error_code,
            1,
            v_now,
            v_now
          )
          ON CONFLICT (booking_id) DO UPDATE
          SET
            next_check_at = greatest(
              public.trainer_transfer_execution_schedule.next_check_at,
              EXCLUDED.next_check_at
            ),
            last_checked_at = EXCLUDED.last_checked_at,
            last_error_code = EXCLUDED.last_error_code,
            consecutive_failures = (
              least(
                public.trainer_transfer_execution_schedule
                  .consecutive_failures::bigint + 1,
                2147483647::bigint
              )
            )::integer,
            updated_at = EXCLUDED.updated_at
          WHERE
            public.trainer_transfer_execution_schedule.next_check_at
              <= v_now;

          IF FOUND THEN
            v_deferred := v_deferred + 1;
          END IF;
        END IF;

      EXCEPTION
        WHEN lock_not_available THEN
          v_busy := v_busy + 1;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'result', 'not_claimed',
    'considered', v_considered,
    'deferred', v_deferred,
    'busy', v_busy
  );
END;
$function$;

/*
 * De bestaande selector behoudt bij CREATE OR REPLACE zijn ACL.
 *
 * De uitvoerder heeft voor losse lessen alleen nog EXECUTE
 * op de nieuwe preparefunctie nodig. Registratie en claim
 * blijven intern en worden via de selector aangeroepen.
 */
REVOKE ALL
ON FUNCTION public.prepare_sandbox_single_trainer_transfer(
  uuid, uuid, jsonb, jsonb, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.prepare_sandbox_single_trainer_transfer(
  uuid, uuid, jsonb, jsonb, jsonb
)
TO service_role;

COMMIT;