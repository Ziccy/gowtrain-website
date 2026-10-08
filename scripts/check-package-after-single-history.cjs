const assert = require("node:assert/strict");

const BOOKING = "d21a4fa7-806d-44e8-9a96-6b4702242e9b";
const PURCHASE = "c02e8212-9379-4f3f-8edd-023dea74910a";
const TRAINER = "4c4a5ffc-7584-4ffb-9678-95d3a311c50e";
const DESTINATION = "acct_1UHJRCBAMjpV6Qwm";

async function snapshot(client) {
  const { rows } = await client.query(
    `
      SELECT
        (
          SELECT md5(to_jsonb(p)::text)
          FROM public.package_purchases p
          WHERE p.id = $1::uuid
        ) AS purchase_hash,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'hash', md5(to_jsonb(b)::text)
              ) ORDER BY b.id
            ),
            '[]'::jsonb
          )
          FROM public.bookings b
          WHERE b.package_purchase_id = $1::uuid
        ) AS bookings,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'hash', md5(to_jsonb(r)::text)
              ) ORDER BY r.id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_requests r
          WHERE r.source_package_purchase_id = $1::uuid
             OR r.booking_id IN (
               SELECT b.id
               FROM public.bookings b
               WHERE b.package_purchase_id = $1::uuid
             )
        ) AS requests,
        (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', s.booking_id,
                'hash', md5(to_jsonb(s)::text)
              ) ORDER BY s.booking_id
            ),
            '[]'::jsonb
          )
          FROM public.trainer_transfer_execution_schedule s
          JOIN public.bookings b ON b.id = s.booking_id
          WHERE b.package_purchase_id = $1::uuid
        ) AS schedules
    `,
    [PURCHASE],
  );

  return rows[0];
}

module.exports = async function checkPackageAfterSingleHistory(
  client,
  syntheticSingleTransferId,
) {
  /*
   * Stop vóór claim als de echte pakketles nog niet verschuldigd
   * of inmiddels verwerkt is. Geen datum of status corrigeren.
   */
  const { rows: candidates } = await client.query(
    `
      SELECT
        b.package_purchase_id,
        b.trainer_id,
        b.trainer_net_amount_cents,
        b.trainer_payout_status,
        (
          isfinite(b.trainer_payout_eligible_at)
          AND b.trainer_payout_eligible_at <= clock_timestamp()
        ) AS eligible_now,
        b.stripe_transfer_id IS NULL AS no_transfer,
        b.trainer_paid_at IS NULL AS not_applied,
        EXISTS (
          SELECT 1
          FROM public.trainer_transfer_requests r
          WHERE r.booking_id = b.id
        ) AS has_request
      FROM public.bookings b
      WHERE b.id = $1::uuid
    `,
    [BOOKING],
  );

  assert.deepEqual(candidates, [{
    package_purchase_id: PURCHASE,
    trainer_id: TRAINER,
    trainer_net_amount_cents: 1900,
    trainer_payout_status: "pending",
    eligible_now: true,
    no_transfer: true,
    not_applied: true,
    has_request: false,
  }], "PACKAGE_FIXTURE_NOT_READY_OR_CHANGED");

  /*
   * Broncharge uit de bestaande toegepaste pakkethistorie.
   * Dit is databasebewijs voor een SQL-contracttest,
   * geen nieuwe onafhankelijke Stripe-verificatie.
   */
  const { rows: sources } = await client.query(
    `
      SELECT DISTINCT stripe_source_charge_id
      FROM public.trainer_transfer_requests
      WHERE source_package_purchase_id = $1::uuid
        AND status = 'succeeded'
        AND applied_at IS NOT NULL
    `,
    [PURCHASE],
  );

  assert.equal(sources.length, 1, "PACKAGE_SOURCE_NOT_UNIQUE");
  const chargeId = sources[0].stripe_source_charge_id;
  assert.match(chargeId, /^(ch|py)_[A-Za-z0-9]+$/);

  const before = await snapshot(client);
  assert.ok(before.purchase_hash);

  await client.query("SAVEPOINT package_after_single");

  try {
    const { rows: claims } = await client.query(
      `
        SELECT public.register_and_claim_sandbox_transfer_candidate(
          $1::uuid
        ) AS claim
      `,
      [BOOKING],
    );

    const claim = claims[0].claim;
    assert.ok(claim, "PACKAGE_CLAIM_NOT_OBTAINED");
    assert.equal(claim.booking_id, BOOKING);
    assert.equal(claim.source_package_purchase_id, PURCHASE);
    assert.equal(claim.trainer_id, TRAINER);
    assert.equal(claim.destination_account_id, DESTINATION);
    assert.equal(claim.amount_cents, 1900);
    assert.equal(claim.attempts, 1);

    const { rows: histories } = await client.query(
      `
        SELECT public.read_claimed_sandbox_transfer_history(
          $1::uuid, $2::uuid, $3::text
        ) AS result
      `,
      [claim.request_id, claim.lock_token, chargeId],
    );

    const history = histories[0].result.history;
    assert.deepEqual(history.orphan_bookings, []);

    const prior = history.requests.filter(
      (entry) => entry.request.id !== claim.request_id,
    );

    const singleEntries = prior.filter(
      (entry) =>
        entry.request.stripe_transfer_id === syntheticSingleTransferId,
    );

    assert.equal(singleEntries.length, 1);
    assert.equal(
      singleEntries[0].request.source_package_purchase_id,
      null,
    );
    assert.equal(singleEntries[0].purchase, null);
    assert.equal(singleEntries[0].request.amount_cents, 7600);

    /*
     * Expliciet synthetische scan van de databasehistorie.
     * Alle overige validatie gebeurt door de echte SQL-functies.
     */
    const transfers = prior.map((entry) => {
      const r = entry.request;

      assert.equal(r.status, "succeeded");
      assert.ok(r.applied_at);
      assert.ok(r.stripe_request_payload);

      return {
        transferId: r.stripe_transfer_id,
        destinationAccountId: r.destination_account_id,
        sourceChargeId: r.stripe_source_charge_id,
        amountCents: r.amount_cents,
        currency: r.currency,
        livemode: r.stripe_livemode,
        amountReversedCents: 0,
        fullyReversed: false,
        hasReversalRecords: false,
        transferGroup: r.stripe_request_payload.transfer_group,
        metadata: r.stripe_request_payload.metadata,
        created: Date.parse(r.succeeded_at) / 1000,
        matchesSourceCharge: r.stripe_source_charge_id === chargeId,
        matchesDestination: r.destination_account_id === DESTINATION,
      };
    });

    const { rows: clock } = await client.query(
      "SELECT clock_timestamp() AS now",
    );
    const checkedAt = clock[0].now.toISOString();

    const scan = {
      scanCompleted: true,
      sourceChargeId: chargeId,
      destinationAccountId: DESTINATION,
      scannedTransferCount: transfers.length,
      sourceTransferCount: transfers.filter(
        (t) => t.matchesSourceCharge,
      ).length,
      destinationTransferCount: transfers.filter(
        (t) => t.matchesDestination,
      ).length,
      destinationTransfersWithoutSourceCount: transfers.filter(
        (t) => t.matchesDestination && t.sourceChargeId === null,
      ).length,
      checkedAt,
      finishedAt: checkedAt,
      relevantTransfers: transfers,
    };

    const { rows: validated } = await client.query(
      `
        SELECT public.validate_claimed_sandbox_transfer_history(
          $1::uuid, $2::uuid, $3::text, $4::jsonb
        ) AS result
      `,
      [
        claim.request_id,
        claim.lock_token,
        chargeId,
        JSON.stringify(scan),
      ],
    );

    const result = validated[0].result;

    assert.equal(result.history_verified, true);
    assert.equal(result.request_id, claim.request_id);
    assert.equal(result.completed_transfer_count, prior.length);
    assert.equal(result.current_amount_cents, 1900);
    assert.equal(
      result.source_transferred_cents,
      transfers
        .filter((t) => t.matchesSourceCharge)
        .reduce((sum, t) => sum + t.amountCents, 0),
    );
    assert.equal(
      result.destination_transferred_cents,
      transfers
        .filter((t) => t.matchesDestination)
        .reduce((sum, t) => sum + t.amountCents, 0),
    );

    console.log(
      "FUNCTIONEEL OK: pakketclaim accepteert volledig toegepaste " +
      "losse-lestransfer in gemengde historie.",
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT package_after_single");
    await client.query("RELEASE SAVEPOINT package_after_single");

    assert.deepEqual(await snapshot(client), before);
  }

  console.log(
    "NACONTROLE OK: pakketclaim teruggedraaid; aankoop, boekingen, " +
    "opdrachten en selectieplanning gelijk aan de nulmeting.",
  );
};