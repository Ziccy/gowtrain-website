const checkPackageAfterSingleHistory = require(
  "./check-package-after-single-history.cjs",
);
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

module.exports = async function checkSingleTransferPositiveFlow(client) {
  const bookingId = randomUUID();
  const slotId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  const paymentId = `pi_ROLLBACK${suffix}`;
  const chargeId = `py_ROLLBACK${suffix}`;
  const sessionId = `cs_test_ROLLBACK${suffix}`;

  const trainerId = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";
  const destination = "acct_1UHJRCBAMjpV6Qwm";
  const referenceBooking = "f0696131-6f54-4226-b4d6-6fe819f4a9cc";

  async function expectRejection(sql, args, expectedMessage) {
    await client.query("SAVEPOINT expected_single_rejection");

    let rejection = null;

    try {
      await client.query(sql, args);
    } catch (error) {
      rejection = {
        code: error.code,
        message: error.message,
      };
    } finally {
      await client.query(
        "ROLLBACK TO SAVEPOINT expected_single_rejection",
      );
      await client.query(
        "RELEASE SAVEPOINT expected_single_rejection",
      );
    }

    assert.deepEqual(rejection, {
      code: "P0001",
      message: expectedMessage,
    });
  }

  await client.query("SAVEPOINT positive_single_fixture");

  try {
    /*
     * Alleen locatie, sport en bestaand speler-ID lenen.
     * Geen bestaande boeking, slotdatum of betaling wijzigen.
     *
     * Zoek een vrij uur in het verleden voor een NIEUW testslot.
     * De exclusion constraint blijft daarnaast afdwingend.
     */
    const { rows: fixtureRows } = await client.query(
      `
        SELECT
          b.player_id,
          s.location_id,
          s.sport,
          gap.starts_at
        FROM public.bookings AS b
        JOIN public.availability_slots AS s ON s.id = b.slot_id
        CROSS JOIN LATERAL (
          SELECT candidate AS starts_at
          FROM generate_series(
            date_trunc('hour', clock_timestamp()) - interval '60 days',
            date_trunc('hour', clock_timestamp()) - interval '30 days',
            interval '1 hour'
          ) AS times(candidate)
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.availability_slots AS occupied
            WHERE occupied.trainer_id = b.trainer_id
              AND occupied.status IN (
                'available', 'held', 'booked', 'package'
              )
              AND tstzrange(
                occupied.starts_at, occupied.ends_at, '[)'
              ) && tstzrange(
                candidate, candidate + interval '1 hour', '[)'
              )
          )
          ORDER BY candidate
          LIMIT 1
        ) AS gap
        WHERE b.id = $1::uuid
          AND b.trainer_id = $2::uuid
          AND b.player_id IS NOT NULL
          AND b.package_purchase_id IS NULL
      `,
      [referenceBooking, trainerId],
    );

    assert.equal(fixtureRows.length, 1, "SINGLE_FIXTURE_CONTEXT_MISSING");
    const fixture = fixtureRows[0];

    await client.query(
      `
        INSERT INTO public.availability_slots (
          id, trainer_id, starts_at, ends_at, status,
          location_id, max_participants, price_cents,
          currency, booking_deadline_hours, sport
        )
        VALUES (
          $1::uuid, $2::uuid, $3::timestamptz,
          $3::timestamptz + interval '1 hour', 'held',
          $4::uuid, 1, 8000, 'eur', 2, $5
        )
      `,
      [
        slotId,
        trainerId,
        fixture.starts_at,
        fixture.location_id,
        fixture.sport,
      ],
    );

    /*
     * Rechtstreekse test-INSERT, geen echte reserverings-RPC.
     * Hiermee testen we de toelatingstrigger zelf.
     */
    await client.query(
      `
        INSERT INTO public.bookings (
          id, trainer_id, player_id, player_name, player_email,
          slot_id, participant_count, total_price_cents, currency,
          commission_rate_bps, commission_amount_cents,
          trainer_net_amount_cents, status, trainer_payout_status
        )
        VALUES (
          $1::uuid, $2::uuid, $3::uuid,
          'ROLLBACK TEST', 'rollback@example.invalid',
          $4::uuid, 1, 8000, 'eur', 500, 400, 7600,
          'payment_pending', 'pending'
        )
      `,
      [bookingId, trainerId, fixture.player_id, slotId],
    );

    const { rows: admissions } = await client.query(
      `
        SELECT evidence_kind, total_price_cents,
               commission_amount_cents, trainer_net_amount_cents
        FROM public.single_transfer_admissions
        WHERE booking_id = $1::uuid
      `,
      [bookingId],
    );

    assert.deepEqual(admissions, [{
      evidence_kind: "reservation_recorded",
      total_price_cents: 8000,
      commission_amount_cents: 400,
      trainer_net_amount_cents: 7600,
    }]);

    console.log("FUNCTIONEEL OK: nieuwe boekingsrij krijgt toelating.");

    /*
     * Expliciet synthetische betaaltoestand.
     * Geen Stripe-call en geen bewijs van een echte betaling.
     * Datum van het nieuwe testslot blijft ongewijzigd.
     */
    await client.query(
      `
        UPDATE public.availability_slots
        SET status = 'booked'
        WHERE id = $1::uuid
      `,
      [slotId],
    );

    await client.query(
      `
        UPDATE public.bookings
        SET
          status = 'completed',
          paid_at = original_starts_at - interval '2 days',
          stripe_checkout_session_id = $2,
          stripe_payment_intent_id = $3,
          stripe_charge_id = $4,
          trainer_payout_eligible_at =
            original_starts_at + interval '24 hours'
        WHERE id = $1::uuid
      `,
      [bookingId, sessionId, paymentId, chargeId],
    );

    const { rows: selections } = await client.query(`
      SELECT public.claim_next_sandbox_trainer_transfer() AS result
    `);

    const selection = selections[0].result;

    assert.equal(selection.result, "claimed");
    assert.ok(Number.isInteger(selection.considered));
    assert.ok(selection.considered >= 1 && selection.considered <= 10);

    const claim = selection.claim;

    /*
     * Alleen doorgaan als de echte selector onze tijdelijke
     * fixture heeft gekozen. Bij een andere kandidaat stopt
     * de proef en draait de transactie terug.
     */
    assert.equal(
      claim?.booking_id,
      bookingId,
      "SELECTOR_SELECTED_DIFFERENT_CANDIDATE",
    );

    assert.ok(claim);
    assert.equal(claim.source_kind, "single_lesson");
    assert.equal(claim.booking_id, bookingId);
    assert.equal(claim.trainer_id, trainerId);
    assert.equal(claim.destination_account_id, destination);
    assert.equal(claim.amount_cents, 7600);
    assert.equal(claim.attempts, 1);
    assert.equal(claim.source_package_purchase_id, null);

    console.log(
      "FUNCTIONEEL OK: brede selector heeft de synthetische losse les geclaimd.",
    );

    const { rows: histories } = await client.query(
      `
        SELECT public.read_claimed_sandbox_single_transfer_history(
          $1::uuid, $2::uuid, $3
        ) AS result
      `,
      [claim.request_id, claim.lock_token, chargeId],
    );

    const history = histories[0].result.history;
    const prior = history.requests.filter(
      (entry) => entry.request.id !== claim.request_id,
    );

    // De bekende eerdere pakkettransfers moeten aanwezig zijn.
    assert.ok(
      prior.some(
        (entry) => entry.request.source_package_purchase_id !== null,
      ),
      "PACKAGE_HISTORY_MISSING_FROM_SINGLE_INSPECTION",
    );

    /*
     * SQL-contractfixture: scan opbouwen uit bestaande administratie.
     * Dit is nadrukkelijk GEEN onafhankelijke Stripe-waarneming.
     */
    const relevantTransfers = prior.map((entry) => {
      const r = entry.request;
      assert.equal(r.status, "succeeded");
      assert.ok(r.applied_at);
      assert.equal(r.destination_account_id, destination);
      assert.notEqual(r.stripe_source_charge_id, chargeId);
      assert.notEqual(r.stripe_payment_intent_id, paymentId);

      return {
        transferId: r.stripe_transfer_id,
        destinationAccountId: r.destination_account_id,
        sourceChargeId: r.stripe_source_charge_id,
        amountCents: r.amount_cents,
        currency: r.currency,
        livemode: false,
        amountReversedCents: 0,
        fullyReversed: false,
        hasReversalRecords: false,
        transferGroup: r.stripe_request_payload.transfer_group,
        metadata: r.stripe_request_payload.metadata,
        created: Date.parse(r.succeeded_at) / 1000,
        matchesSourceCharge: false,
        matchesDestination: true,
      };
    });

    const { rows: clock } = await client.query(`
      SELECT clock_timestamp() AS now
    `);
    const checkedAt = clock[0].now.toISOString();

    const scan = {
      scanCompleted: true,
      sourceChargeId: chargeId,
      destinationAccountId: destination,
      scannedTransferCount: relevantTransfers.length,
      sourceTransferCount: 0,
      destinationTransferCount: relevantTransfers.length,
      destinationTransfersWithoutSourceCount: 0,
      checkedAt,
      finishedAt: checkedAt,
      relevantTransfers,
    };

    const { rows: contexts } = await client.query(
      `
        SELECT public.validate_sandbox_single_transfer_booking_internal(
          $1::uuid, $2::uuid, $3::uuid
        ) AS context
      `,
      [bookingId, claim.request_id, claim.lock_token],
    );

    const context = contexts[0].context;

    const source = {
      sourceKind: "single_lesson",
      bookingId,
      trainerId,
      paymentChannel: "legacy_checkout",
      paymentAttemptId: null,
      checkoutSessionId: sessionId,
      paymentIntentId: paymentId,
      chargeId,
      amountCents: 8000,
      currency: "eur",
      livemode: false,
      fundsFlow: "separate_transfers_v1",
      checkedAt,
      transferInspection: scan,
    };

    const destinationSnapshot = {
      accountId: destination,
      trainerId,
      attemptId: context.connect_attempt_id,
      livemode: false,
      closed: false,
      transfersStatus: "active",
      reviewReasons: [],
      checkedAt,
    };

    const payload = {
      amount: 7600,
      currency: "eur",
      destination,
      source_transaction: chargeId,
      transfer_group: `gowtrain-single/${bookingId}`,
      metadata: {
        gowtrain_transfer_request_id: claim.request_id,
        gowtrain_booking_id: bookingId,
        gowtrain_trainer_id: trainerId,
        gowtrain_payment_intent_id: paymentId,
        gowtrain_funds_flow: "separate_transfers_v1",
        gowtrain_booking_type: "single_lesson",
      },
    };

    const prepareSql = `
      SELECT public.prepare_sandbox_single_trainer_transfer(
        $1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb
      ) AS result
    `;

    const prepareArgs = [
      claim.request_id,
      claim.lock_token,
      JSON.stringify(source),
      JSON.stringify(destinationSnapshot),
      JSON.stringify(payload),
    ];

    const { rows: prepared } = await client.query(
      prepareSql,
      prepareArgs,
    );

    assert.equal(prepared[0].result.request_id, claim.request_id);
    assert.deepEqual(
      prepared[0].result.stripe_request_payload,
      payload,
    );

    await expectRejection(
      prepareSql,
      prepareArgs,
      "TRANSFER_SINGLE_ALREADY_PREPARED",
    );

    console.log(
      "FUNCTIONEEL OK: gemengde historie en prepare; tweede prepare geweigerd.",
    );

    const { rows: review } = await client.query(
      `
        SELECT public.mark_sandbox_trainer_transfer_for_review(
          $1::uuid, $2::uuid, 'TRANSFER_ROLLBACK_TEST_UNCERTAIN'
        ) AS recorded
      `,
      [claim.request_id, claim.lock_token],
    );

    assert.equal(review[0].recorded, true);

    const { rows: states } = await client.query(
      `
        SELECT
          r.status,
          r.attempts,
          r.lock_token IS NULL AS token_released,
          r.locked_until IS NULL AS lease_released,
          r.first_stripe_request_at IS NOT NULL AS prepared,
          r.stripe_transfer_id IS NULL AS no_transfer_result,
          b.trainer_payout_status
        FROM public.trainer_transfer_requests r
        JOIN public.bookings b ON b.id = r.booking_id
        WHERE r.id = $1::uuid
      `,
      [claim.request_id],
    );

    assert.deepEqual(states, [{
      status: "review_required",
      attempts: 1,
      token_released: true,
      lease_released: true,
      prepared: true,
      no_transfer_result: true,
      trainer_payout_status: "processing",
    }]);

    const { rows: again } = await client.query(
      `
        SELECT public.claim_sandbox_single_trainer_transfer(
          $1::uuid, 300
        ) AS claim
      `,
      [claim.request_id],
    );

    assert.equal(again[0].claim, null);

    console.log(
      "FUNCTIONEEL OK: review houdt boeking processing; geen herclaim.",
    );

    /*
     * Expliciet geregistreerd herstelonderzoek.
     * Dit test de SQL-herstelketen, niet de periodieke workerselectie.
     */
    const { rows: started } = await client.query(
      `
        SELECT public.start_sandbox_transfer_recovery_check(
          $1::uuid
        ) AS check_id
      `,
      [claim.request_id],
    );

    const checkId = started[0].check_id;
    assert.match(
      checkId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const { rows: duplicateStart } = await client.query(
      `
        SELECT public.start_sandbox_transfer_recovery_check(
          $1::uuid
        ) AS check_id
      `,
      [claim.request_id],
    );

    assert.equal(duplicateStart[0].check_id, null);

    /*
     * Uitsluitend synthetische resultaatwaarneming.
     * Geen Stripe-object aangemaakt, opgehaald of geverifieerd.
     */
    const syntheticTransferId = `tr_ROLLBACK${suffix}`;

    const { rows: resultClock } = await client.query(`
      SELECT
        clock_timestamp() AS checked_at,
        date_trunc('second', clock_timestamp()) AS created_at
    `);

    const resultCheckedAt = resultClock[0].checked_at.toISOString();
    const resultCreatedAt = resultClock[0].created_at.toISOString();

    /*
     * Eerst scan opslaan, daarna financiële toepassing.
     * Geen overige transfers uit de synthetische broncharge.
     */
    const { rows: recorded } = await client.query(
      `
        SELECT public.record_sandbox_transfer_recovery_scan(
          $1::uuid,
          $2::timestamptz,
          $2::timestamptz,
          1,
          'verified_match',
          $3::text,
          '[]'::jsonb
        ) AS recorded
      `,
      [checkId, resultCheckedAt, syntheticTransferId],
    );

    assert.equal(recorded[0].recorded, true);

    const { rows: scans } = await client.query(
      `
        SELECT
          search_outcome,
          own_transfer_id,
          history_approval_granted
        FROM public.trainer_transfer_recovery_scans
        WHERE check_id = $1::uuid
      `,
      [checkId],
    );

    assert.deepEqual(scans, [{
      search_outcome: "verified_match",
      own_transfer_id: syntheticTransferId,
      history_approval_granted: false,
    }]);

    const applySql = `
      SELECT public.apply_verified_sandbox_trainer_transfer(
        $1::uuid, $2::text, $3::text, $4::text,
        7600, 'eur', $5::timestamptz, $6::timestamptz
      ) AS result
    `;

    const applyArgs = [
      claim.request_id,
      syntheticTransferId,
      destination,
      chargeId,
      resultCreatedAt,
      resultCheckedAt,
    ];

    const { rows: applied } = await client.query(applySql, applyArgs);

    assert.equal(applied[0].result.result, "applied");
    assert.equal(applied[0].result.request_id, claim.request_id);
    assert.equal(applied[0].result.booking_id, bookingId);
    assert.equal(
      applied[0].result.stripe_transfer_id,
      syntheticTransferId,
    );

    async function appliedState() {
      const { rows } = await client.query(
        `
          SELECT
            r.status AS request_status,
            r.attempts,
            r.stripe_transfer_id AS request_transfer_id,
            r.applied_at IS NOT NULL AS applied,
            r.lock_token IS NULL AS token_released,
            r.locked_until IS NULL AS lease_released,
            b.trainer_payout_status,
            b.stripe_transfer_id AS booking_transfer_id,
            b.trainer_paid_at = r.succeeded_at AS success_time_matches,
            md5(to_jsonb(r)::text) AS request_hash,
            md5(to_jsonb(b)::text) AS booking_hash
          FROM public.trainer_transfer_requests AS r
          JOIN public.bookings AS b ON b.id = r.booking_id
          WHERE r.id = $1::uuid
        `,
        [claim.request_id],
      );

      assert.equal(rows.length, 1);
      return rows[0];
    }

    const firstAppliedState = await appliedState();

    assert.equal(firstAppliedState.request_status, "succeeded");
    assert.equal(firstAppliedState.attempts, 1);
    assert.equal(
      firstAppliedState.request_transfer_id,
      syntheticTransferId,
    );
    assert.equal(firstAppliedState.applied, true);
    assert.equal(firstAppliedState.token_released, true);
    assert.equal(firstAppliedState.lease_released, true);
    assert.equal(firstAppliedState.trainer_payout_status, "paid");
    assert.equal(
      firstAppliedState.booking_transfer_id,
      syntheticTransferId,
    );
    assert.equal(firstAppliedState.success_time_matches, true);

    const { rows: appliedAgain } = await client.query(
      applySql,
      applyArgs,
    );

    assert.equal(appliedAgain[0].result.result, "already_applied");
    assert.deepEqual(await appliedState(), firstAppliedState);

    const { rows: finished } = await client.query(
      `
        SELECT public.finish_and_schedule_sandbox_transfer_recovery_check(
          $1::uuid, 'applied', $2::text, NULL::text
        ) AS finished
      `,
      [checkId, syntheticTransferId],
    );

    assert.equal(finished[0].finished, true);

    /*
     * Afsluiting mag een volledig toegepaste opdracht niet
     * opnieuw plannen of de financiële gegevens veranderen.
     */
    assert.deepEqual(await appliedState(), firstAppliedState);

    const { rows: checks } = await client.query(
      `
        SELECT status, outcome, stripe_transfer_id
        FROM public.trainer_transfer_recovery_checks
        WHERE id = $1::uuid
      `,
      [checkId],
    );

    assert.deepEqual(checks, [{
      status: "finished",
      outcome: "applied",
      stripe_transfer_id: syntheticTransferId,
    }]);

    console.log(
      "FUNCTIONEEL OK: herstelonderzoek, scanopslag en synthetische " +
      "resultaattoepassing; herhaalde toepassing verandert niets.",
    );

    await checkPackageAfterSingleHistory(
      client,
      syntheticTransferId,
    );

    const { rows: emails } = await client.query(
      `
        SELECT count(*)::integer AS count
        FROM public.email_jobs
        WHERE payload ->> 'booking_id' = $1
      `,
      [bookingId],
    );

    assert.equal(emails[0].count, 0, "UNEXPECTED_FIXTURE_EMAIL_JOB");
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT positive_single_fixture");
    await client.query("RELEASE SAVEPOINT positive_single_fixture");
  }

  const { rows: remaining } = await client.query(
    `
      SELECT
        EXISTS (
          SELECT 1 FROM public.bookings WHERE id = $1::uuid
        ) AS booking,
        EXISTS (
          SELECT 1 FROM public.availability_slots WHERE id = $2::uuid
        ) AS slot,
        EXISTS (
          SELECT 1 FROM public.single_transfer_admissions
          WHERE booking_id = $1::uuid
        ) AS admission,
        EXISTS (
          SELECT 1 FROM public.trainer_transfer_requests
          WHERE booking_id = $1::uuid
        ) AS request,
        EXISTS (
          SELECT 1 FROM public.email_jobs
          WHERE payload ->> 'booking_id' = $1::text
        ) AS email,
        EXISTS (
          SELECT 1 FROM public.trainer_transfer_recovery_checks
          WHERE stripe_transfer_id = $3::text
        ) AS recovery_check,
        EXISTS (
          SELECT 1 FROM public.trainer_transfer_recovery_scans
          WHERE own_transfer_id = $3::text
        ) AS recovery_scan
    `,
    [bookingId, slotId, `tr_ROLLBACK${suffix}`],
  );

  assert.deepEqual(remaining, [{
    booking: false,
    slot: false,
    admission: false,
    request: false,
    email: false,
    recovery_check: false,
    recovery_scan: false,
  }]);

  console.log("NACONTROLE OK: alle positieve testfixtures teruggedraaid.");
};