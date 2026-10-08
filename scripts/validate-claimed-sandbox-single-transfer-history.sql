BEGIN;

CREATE FUNCTION public.validate_claimed_sandbox_single_transfer_history(
  p_request_id uuid,
  p_lock_token uuid,
  p_source_charge_id text,
  p_scan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_claimed jsonb;
  v_history jsonb;
  v_entry jsonb;
  v_request jsonb;
  v_transfer jsonb;
  v_expected_payload jsonb;

  v_booking_id text;
  v_payment_id text;
  v_destination text;

  v_request_id text;
  v_entry_booking_id text;
  v_transfer_id text;

  v_own_amount bigint;
  v_source_total bigint;
  v_amount bigint;
  v_destination_total bigint := 0;

  v_scan_count integer;
  v_completed_count integer := 0;
  v_own_count integer := 0;
  v_match_count integer;
  v_scanned_count numeric;

  v_seen_requests text[] := ARRAY[]::text[];
  v_seen_bookings text[] := ARRAY[]::text[];
  v_seen_transfers text[] := ARRAY[]::text[];

  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_succeeded_at timestamptz;
  v_now timestamptz;
BEGIN
  IF jsonb_typeof(p_scan) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_scan -> 'relevantTransfers')
          IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_INVALID';
  END IF;

  /*
   * Bevestigt de eigen, nog onvoorbereide claim.
   *
   * Houdt opdracht -> betaalpoging -> boeking -> slot -> trainer
   * gelockt tot het einde van de aanroepende transactie.
   *
   * De loader bevat alle relevante historie en weigert
   * onverklaarde processing/paid-boekingen zonder opdracht.
   */
  v_claimed :=
    public.read_claimed_sandbox_single_transfer_history(
      p_request_id,
      p_lock_token,
      p_source_charge_id
    );

  IF jsonb_typeof(v_claimed) IS DISTINCT FROM 'object'
     OR v_claimed -> 'claim_verified' IS DISTINCT FROM 'true'::jsonb
     OR v_claimed ->> 'source_kind' IS DISTINCT FROM 'single_lesson'
     OR v_claimed ->> 'request_id' IS DISTINCT FROM p_request_id::text
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_CLAIM_NOT_CONFIRMED';
  END IF;

  v_history := v_claimed -> 'history';
  v_booking_id := v_claimed ->> 'booking_id';
  v_payment_id := v_history ->> 'payment_intent_id';
  v_destination := v_claimed ->> 'destination_account_id';

  IF jsonb_typeof(v_history -> 'requests') IS DISTINCT FROM 'array'
     OR v_history -> 'orphan_bookings' IS DISTINCT FROM '[]'::jsonb
     OR v_history -> 'request_count' IS DISTINCT FROM
          to_jsonb(jsonb_array_length(v_history -> 'requests'))
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_HISTORY_INVALID';
  END IF;

  IF p_scan -> 'scanCompleted' IS DISTINCT FROM 'true'::jsonb
     OR p_scan ->> 'sourceChargeId' IS DISTINCT FROM p_source_charge_id
     OR p_scan ->> 'destinationAccountId' IS DISTINCT FROM v_destination
     OR jsonb_typeof(p_scan -> 'scannedTransferCount')
          IS DISTINCT FROM 'number'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_CONTEXT_MISMATCH';
  END IF;

  v_started_at := (p_scan ->> 'checkedAt')::timestamptz;
  v_finished_at := (p_scan ->> 'finishedAt')::timestamptz;
  v_now := clock_timestamp();

  IF v_started_at IS NULL
     OR v_finished_at IS NULL
     OR NOT isfinite(v_started_at)
     OR NOT isfinite(v_finished_at)
     OR v_started_at < v_now - interval '2 minutes'
     OR v_finished_at < v_started_at
     OR v_started_at > v_now + interval '5 seconds'
     OR v_finished_at > v_now + interval '5 seconds'
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_TIMES_INVALID';
  END IF;

  v_scan_count := jsonb_array_length(p_scan -> 'relevantTransfers');
  v_scanned_count := (p_scan ->> 'scannedTransferCount')::numeric;

  IF v_scanned_count < 0
     OR v_scanned_count > 2000
     OR trunc(v_scanned_count) IS DISTINCT FROM v_scanned_count
     OR v_scanned_count < v_scan_count
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_COUNT_INVALID';
  END IF;

  v_own_amount :=
    (v_history ->> 'source_trainer_net_amount_cents')::bigint;
  v_source_total :=
    (v_history ->> 'source_total_amount_cents')::bigint;

  IF v_own_amount IS NULL
     OR v_own_amount <= 0
     OR v_source_total IS NULL
     OR v_source_total < v_own_amount
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_SOURCE_AMOUNTS_INVALID';
  END IF;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(v_history -> 'requests')
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry -> 'request') IS DISTINCT FROM 'object'
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_ENTRY_INVALID';
    END IF;

    v_request := v_entry -> 'request';
    v_request_id := v_request ->> 'id';
    v_entry_booking_id := v_request ->> 'booking_id';

    IF v_request_id IS NULL
       OR v_entry_booking_id IS NULL
       OR v_request_id = ANY(v_seen_requests)
       OR v_entry_booking_id = ANY(v_seen_bookings)
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_DUPLICATE_HISTORY';
    END IF;

    v_seen_requests := array_append(v_seen_requests, v_request_id);
    v_seen_bookings := array_append(v_seen_bookings, v_entry_booking_id);

    /*
     * Alleen de door de claimreader gecontroleerde eigen opdracht
     * apart behandelen. Geen andere onafgeronde opdracht overslaan.
     */
    IF v_request_id = p_request_id::text THEN
      v_own_count := v_own_count + 1;

      IF v_entry_booking_id IS DISTINCT FROM v_booking_id
         OR v_request -> 'amount_cents'
              IS DISTINCT FROM to_jsonb(v_own_amount)
         OR v_request -> 'stripe_source_charge_id'
              IS DISTINCT FROM 'null'::jsonb
         OR v_request -> 'source_verified_at'
              IS DISTINCT FROM 'null'::jsonb
      THEN
        RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_OWN_CLAIM_INVALID';
      END IF;

      CONTINUE;
    END IF;

    /*
     * Beide rijvalidators eisen een volledig toegepaste opdracht,
     * consistente boeking/broncontext en exact opgeslagen payload.
     *
     * Ontbrekend source_package_purchase_id is niet hetzelfde
     * als expliciet JSON-null; de pakketvalidator weigert dat.
     */
    IF v_request -> 'source_package_purchase_id' = 'null'::jsonb THEN
      v_expected_payload :=
        public.validate_completed_single_transfer_history_entry(
          v_entry
        );
    ELSE
      v_expected_payload :=
        public.validate_completed_package_transfer_history_entry(
          v_entry
        );
    END IF;

    /*
     * Eén losse-lesbetaling, één eerste transfer.
     * Iedere eerdere opdracht met dezelfde PI of broncharge
     * blokkeert, ook als die naar een andere bestemming ging.
     */
    IF v_request ->> 'stripe_payment_intent_id' = v_payment_id
       OR v_request ->> 'stripe_source_charge_id' = p_source_charge_id
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_SOURCE_ALREADY_USED';
    END IF;

    /*
     * Na uitsluiting van dezelfde bron moeten overige entries
     * in de huidige bestemmingsscan vallen.
     */
    IF v_request ->> 'destination_account_id'
         IS DISTINCT FROM v_destination
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_HISTORY_OUTSIDE_SCAN_SCOPE';
    END IF;

    v_transfer_id := v_request ->> 'stripe_transfer_id';
    v_amount := (v_request ->> 'amount_cents')::bigint;
    v_succeeded_at := (v_request ->> 'succeeded_at')::timestamptz;

    IF v_transfer_id = ANY(v_seen_transfers) THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_DUPLICATE_TRANSFER';
    END IF;

    v_seen_transfers := array_append(v_seen_transfers, v_transfer_id);

    SELECT count(*)::integer
    INTO v_match_count
    FROM jsonb_array_elements(p_scan -> 'relevantTransfers') AS item(value)
    WHERE item.value ->> 'transferId' = v_transfer_id;

    IF v_match_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_TRANSFER_MATCH_NOT_UNIQUE';
    END IF;

    SELECT item.value
    INTO v_transfer
    FROM jsonb_array_elements(p_scan -> 'relevantTransfers') AS item(value)
    WHERE item.value ->> 'transferId' = v_transfer_id;

    IF jsonb_typeof(v_transfer) IS DISTINCT FROM 'object'
       OR v_transfer -> 'livemode' IS DISTINCT FROM 'false'::jsonb
       OR v_transfer ->> 'destinationAccountId'
            IS DISTINCT FROM v_request ->> 'destination_account_id'
       OR v_transfer ->> 'sourceChargeId'
            IS DISTINCT FROM v_request ->> 'stripe_source_charge_id'
       OR v_transfer -> 'amountCents' IS DISTINCT FROM to_jsonb(v_amount)
       OR v_transfer ->> 'currency' IS DISTINCT FROM 'eur'
       OR v_transfer -> 'amountReversedCents' IS DISTINCT FROM '0'::jsonb
       OR v_transfer -> 'fullyReversed' IS DISTINCT FROM 'false'::jsonb
       OR v_transfer -> 'hasReversalRecords' IS DISTINCT FROM 'false'::jsonb
       OR v_transfer ->> 'transferGroup'
            IS DISTINCT FROM v_expected_payload ->> 'transfer_group'
       OR v_transfer -> 'metadata'
            IS DISTINCT FROM v_expected_payload -> 'metadata'
       OR v_transfer -> 'created'
            IS DISTINCT FROM to_jsonb(extract(epoch FROM v_succeeded_at))
       OR v_transfer -> 'matchesSourceCharge'
            IS DISTINCT FROM 'false'::jsonb
       OR v_transfer -> 'matchesDestination'
            IS DISTINCT FROM 'true'::jsonb
    THEN
      RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_STRIPE_HISTORY_MISMATCH';
    END IF;

    v_completed_count := v_completed_count + 1;
    v_destination_total := v_destination_total + v_amount;
  END LOOP;

  IF v_own_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_OWN_CLAIM_NOT_UNIQUE';
  END IF;

  /*
   * Omgekeerde vergelijking:
   * iedere Stripe-scanrij moet hierboven exact verklaard zijn.
   *
   * Daarmee blokkeert ook een extra transfer voor de eigen
   * nog onvoorbereide claim of een onbekende brontransfer.
   */
  IF v_completed_count IS DISTINCT FROM v_scan_count
     OR p_scan -> 'sourceTransferCount' IS DISTINCT FROM '0'::jsonb
     OR p_scan -> 'destinationTransferCount'
          IS DISTINCT FROM to_jsonb(v_completed_count)
     OR p_scan -> 'destinationTransfersWithoutSourceCount'
          IS DISTINCT FROM '0'::jsonb
  THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_SCAN_UNEXPLAINED_TRANSFERS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_scan -> 'relevantTransfers') AS item(value)
    WHERE item.value #>> '{metadata,gowtrain_transfer_request_id}'
            = p_request_id::text
       OR item.value #>> '{metadata,gowtrain_booking_id}' = v_booking_id
  ) THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_OWN_CLAIM_ALREADY_AT_STRIPE';
  END IF;

  IF (v_claimed ->> 'locked_until')::timestamptz <= clock_timestamp() THEN
    RAISE EXCEPTION 'TRANSFER_SINGLE_CLAIM_EXPIRED';
  END IF;

  RETURN jsonb_build_object(
    'history_verified', true,
    'source_kind', 'single_lesson',
    'request_id', p_request_id,
    'completed_transfer_count', v_completed_count,
    'source_transferred_cents', 0,
    'destination_transferred_cents', v_destination_total,
    'current_amount_cents', v_own_amount,
    'source_total_including_current_cents', v_own_amount
  );
END;
$function$;

/*
 * Interne validator voor de nog aan te sluiten preparefunctie.
 * Geen zelfstandige browser- of service-role-ingang.
 */
REVOKE ALL
ON FUNCTION public.validate_claimed_sandbox_single_transfer_history(
  uuid, uuid, text, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;