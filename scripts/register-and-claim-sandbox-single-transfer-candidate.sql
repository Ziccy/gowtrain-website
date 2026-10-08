BEGIN;

CREATE FUNCTION public.register_and_claim_sandbox_single_transfer_candidate(
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_existing public.trainer_transfer_requests%rowtype;
  v_request public.trainer_transfer_requests%rowtype;
  v_request_id uuid;
  v_claim jsonb;
  v_no_claim boolean := false;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_BOOKING_REQUIRED';
  END IF;

  /*
   * Goedkope voorcontrole. Na de registratie controleren we
   * de planning opnieuw onder de verkregen boekingslock.
   */
  IF EXISTS (
    SELECT 1
    FROM public.trainer_transfer_execution_schedule AS s
    WHERE s.booking_id = p_booking_id
      AND s.next_check_at > clock_timestamp()
  ) THEN
    RETURN NULL;
  END IF;

  /*
   * Subtransactie:
   * registratie en claim slagen samen, of alle wijzigingen
   * binnen dit blok worden teruggedraaid.
   */
  BEGIN
    /*
     * Bestaande opdracht eerst locken.
     * Geen opdrachtlock toevoegen na betaalpoging/boeking,
     * behalve voor onze eigen nieuw ingevoegde opdracht.
     */
    SELECT r.*
    INTO v_existing
    FROM public.trainer_transfer_requests AS r
    WHERE r.booking_id = p_booking_id
    FOR UPDATE NOWAIT;

    IF FOUND THEN
      IF v_existing.source_package_purchase_id IS NOT NULL
         OR v_existing.stripe_livemode IS DISTINCT FROM false
         OR v_existing.funds_flow IS DISTINCT FROM
              'separate_transfers_v1'
      THEN
        RAISE EXCEPTION 'TRANSFER_SINGLE_CANDIDATE_CONTEXT_INVALID';
      END IF;

      /*
       * Geen herclaim, ook niet bij een verlopen lease.
       * Niet-queued opdrachten worden ongemoeid gelaten.
       */
      IF v_existing.status IS DISTINCT FROM 'queued' THEN
        RETURN NULL;
      END IF;
    END IF;

    /*
     * Hergebruikt uitsluitend een passende queued-opdracht
     * zonder eerdere verwerking, of registreert een nieuwe.
     *
     * De registratie controleert na lockverwerving opnieuw
     * of een andere sessie ondertussen een opdracht maakte.
     *
     * Locks: bestaande opdracht -> betaalpoging -> boeking
     * -> slot -> trainer.
     */
    v_request_id :=
      public.register_sandbox_single_trainer_transfer(
        p_booking_id
      );

    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTRATION_NOT_CONFIRMED';
    END IF;

    /*
     * De boekingslock is nu verkregen.
     * Een ondertussen verschoven selectieplanning respecteren.
     */
    IF EXISTS (
      SELECT 1
      FROM public.trainer_transfer_execution_schedule AS s
      WHERE s.booking_id = p_booking_id
        AND s.next_check_at > clock_timestamp()
    ) THEN
      v_no_claim := true;

      RAISE EXCEPTION USING
        ERRCODE = 'ZT003',
        MESSAGE = 'Selectieplanning nog niet verschuldigd.';
    END IF;

    SELECT r.*
    INTO v_request
    FROM public.trainer_transfer_requests AS r
    WHERE r.id = v_request_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTERED_REQUEST_MISSING';
    END IF;

    IF v_request.booking_id IS DISTINCT FROM p_booking_id
       OR v_request.source_package_purchase_id IS NOT NULL
       OR v_request.stripe_livemode IS DISTINCT FROM false
       OR v_request.funds_flow IS DISTINCT FROM
            'separate_transfers_v1'
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_REGISTERED_CONTEXT_INVALID';
    END IF;

    /*
     * De opdracht is al door deze transactie gelockt,
     * of door deze transactie aangemaakt.
     *
     * De claimfunctie hercontroleert de databasegeschiktheid
     * en staat uitsluitend de eerste claim toe.
     */
    v_claim := public.claim_sandbox_single_trainer_transfer(
      v_request_id,
      300
    );

    IF v_claim IS NULL THEN
      v_no_claim := true;

      RAISE EXCEPTION USING
        ERRCODE = 'ZT003',
        MESSAGE = 'Geen uitvoeringsclaim verkregen.';
    END IF;

    /*
     * Controleer de claim tegen de zojuist geregistreerde
     * opdracht, niet tegen vrij aangeleverde trainer/bedraginput.
     */
    IF jsonb_typeof(v_claim) IS DISTINCT FROM 'object'
       OR v_claim ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
       OR v_claim ->> 'request_id'
            IS DISTINCT FROM v_request.id::text
       OR v_claim ->> 'booking_id'
            IS DISTINCT FROM p_booking_id::text
       OR v_claim ->> 'trainer_id'
            IS DISTINCT FROM v_request.trainer_id::text
       OR v_claim -> 'source_package_purchase_id'
            IS DISTINCT FROM 'null'::jsonb
       OR v_claim -> 'amount_cents'
            IS DISTINCT FROM to_jsonb(v_request.amount_cents)
       OR v_claim ->> 'currency'
            IS DISTINCT FROM v_request.currency
       OR v_claim ->> 'destination_account_id'
            IS DISTINCT FROM v_request.destination_account_id
       OR v_claim ->> 'stripe_payment_intent_id'
            IS DISTINCT FROM v_request.stripe_payment_intent_id
       OR v_claim -> 'stripe_livemode'
            IS DISTINCT FROM 'false'::jsonb
       OR v_claim ->> 'funds_flow'
            IS DISTINCT FROM 'separate_transfers_v1'
       OR v_claim ->> 'stripe_idempotency_key'
            IS DISTINCT FROM v_request.stripe_idempotency_key
       OR v_claim -> 'attempts' IS DISTINCT FROM '1'::jsonb
       OR (v_claim ->> 'lock_token') IS NULL
       OR (v_claim ->> 'locked_until') IS NULL
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_RESPONSE_INVALID';
    END IF;

    /*
     * Bevestig ook dat de teruggegeven lease daadwerkelijk
     * op deze opdracht is opgeslagen.
     */
    IF NOT EXISTS (
      SELECT 1
      FROM public.trainer_transfer_requests AS r
      WHERE r.id = v_request_id
        AND r.booking_id = p_booking_id
        AND r.status = 'processing'
        AND r.attempts = 1
        AND r.lock_token::text = v_claim ->> 'lock_token'
        AND r.locked_until =
              (v_claim ->> 'locked_until')::timestamptz
        AND isfinite(r.locked_until)
        AND r.locked_until > clock_timestamp()
        AND r.first_stripe_request_at IS NULL
        AND r.stripe_request_payload IS NULL
        AND r.stripe_transfer_id IS NULL
        AND r.succeeded_at IS NULL
        AND r.applied_at IS NULL
    ) THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_STORED_CLAIM_NOT_CONFIRMED';
    END IF;

    RETURN v_claim;

  EXCEPTION
    WHEN SQLSTATE 'ZT003' THEN
      /*
       * Alleen onze expliciete geen-claimuitkomsten afhandelen.
       * Alle writes uit het binnenste blok zijn teruggedraaid.
       */
      IF v_no_claim IS DISTINCT FROM true THEN
        RAISE;
      END IF;

      RETURN NULL;
  END;
END;
$function$;

/*
 * Voorlopig alleen intern beschikbaar.
 * Geen browser- of service-role-ingang tijdens de bouw.
 *
 * De uiteindelijke selector gaat deze functie aanroepen.
 */
REVOKE ALL
ON FUNCTION public.register_and_claim_sandbox_single_transfer_candidate(uuid)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;