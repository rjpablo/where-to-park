-- Walk-in sessions (migration 0045): access, applicable rates, rate choice, monthly
-- pricing, edit, payments and settle-before-end. Runs in a transaction and rolls
-- back. Session Road (seed ...02, operator ...02): Standard Rate ₱50/h (default) and
-- Monthly Parking. Juan +639170000002 owns the operator; Ana +639170000003 is staff
-- at Session Road only; Sarah +639170000001 is not a member. auth.uid() comes from
-- the request.jwt.claims setting (set per step by pg_temp.act).
BEGIN;

CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  BP uuid := '30000000-0000-0000-0000-000000000005';
  monthly uuid := (SELECT id FROM rates WHERE location_id = '30000000-0000-0000-0000-000000000002' AND rate_type = 'monthly' LIMIT 1);
  r jsonb; sid uuid; n int;
BEGIN
  -- Access: staff of another listing / non-members can't start or read sessions
  PERFORM pg_temp.act('+639170000003');
  r := start_walk_in(BP, 'car', 'ZZW 0001');
  ASSERT r->>'error' = 'Permission denied', 'Ana at Burnham: ' || r::text;
  PERFORM pg_temp.act('+639170000001');
  r := start_walk_in(SR, 'car', 'ZZW 0001');
  ASSERT r->>'error' = 'Permission denied', 'Sarah: ' || r::text;
  r := walk_in_rate_options(SR, 'car', now());
  ASSERT r->>'error' = 'Permission denied', 'Sarah options: ' || r::text;

  -- Options: hourly default applies, so the monthly rate is left out; Automatic = split
  PERFORM pg_temp.act('+639170000003');
  r := walk_in_rate_options(SR, 'car', now());
  ASSERT r->'auto'->>'mode' = 'split', 'auto split: ' || r::text;
  ASSERT NOT (r->'rates' @> jsonb_build_array(jsonb_build_object('id', monthly))), 'monthly hidden: ' || r::text;
  ASSERT r->'rates' @> '[{"name":"Standard Rate"}]', 'standard listed: ' || r::text;

  -- Validation
  ASSERT start_walk_in(SR, 'car', '  ')->>'error' = 'plate_required', 'plate';
  ASSERT start_walk_in(SR, 'car', 'ZZW 0001', NULL, now() - interval '3 hours', now() - interval '2 hours')->>'error' = 'end_before_start', 'end<start';
  ASSERT start_walk_in(SR, 'car', 'ZZW 0001', NULL, NULL, now() + interval '1 hour')->>'error' = 'start_in_future', 'future';
  ASSERT start_walk_in(SR, 'car', 'ZZW 0001', NULL, NULL, NULL, monthly)->>'error' = 'rate_not_applicable', 'monthly n/a';

  -- Start 2h30m ago, no end, Automatic: 3 started hours × ₱50 = ₱150 so far
  r := start_walk_in(SR, 'car', 'zzw 0001', 'test', NULL, now() - interval '150 minutes');
  ASSERT r->>'success' = 'true', 'start: ' || r::text;
  sid := (r->>'session_id')::uuid;
  ASSERT (SELECT plate FROM parking_sessions WHERE id = sid) = 'ZZW 0001', 'plate upper';
  r := session_details(sid);
  ASSERT (r->>'parking')::numeric = 150 AND (r->>'balance')::numeric = 150, 'details: ' || r::text;
  ASSERT (r->'price'->>'until_now')::boolean, 'until now';

  -- Edit: end 1h after start -> ₱50; plate and vehicle change; bad edits refused
  r := update_walk_in_session(sid, now() - interval '150 minutes', now() - interval '90 minutes', 'suv', 'zzw 0002', NULL);
  ASSERT r->>'success' = 'true' AND (r->>'parking')::numeric = 50, 'edit end: ' || r::text;
  ASSERT (SELECT plate || vehicle_type::text FROM parking_sessions WHERE id = sid) = 'ZZW 0002suv', 'edit plate/vehicle';
  ASSERT update_walk_in_session(sid, NULL, NULL, 'car', 'ZZW 0002', NULL)->>'error' = 'start_required', 'start required';
  ASSERT update_walk_in_session(sid, now() - interval '1 hour', now() - interval '2 hours', 'car', 'ZZW 0002', NULL)->>'error' = 'end_before_start', 'edit end<start';
  -- Clearing the end bills up to now again (₱150), and a future end bills to that end
  r := update_walk_in_session(sid, now() - interval '150 minutes', NULL, 'car', 'ZZW 0002', NULL);
  ASSERT (r->>'parking')::numeric = 150, 'cleared end: ' || r::text;
  r := update_walk_in_session(sid, now() - interval '150 minutes', now() + interval '90 minutes', 'car', 'ZZW 0002', NULL);
  ASSERT (r->>'parking')::numeric = 200, 'future end 4h: ' || r::text;
  ASSERT (SELECT status FROM parking_sessions WHERE id = sid) = 'active', 'active';
  r := update_walk_in_session(sid, now() - interval '150 minutes', now() - interval '30 minutes', 'car', 'ZZW 0002', NULL);
  ASSERT (r->>'parking')::numeric = 100, 'end 2h: ' || r::text;

  -- Payments: several, capped at the balance; end refused while a balance remains (no writes)
  r := record_session_payment(sid, 60, 'gcash', 'first');
  ASSERT (r->>'balance')::numeric = 40, 'pay 60: ' || r::text;
  ASSERT record_session_payment(sid, 50)->>'error' = 'payment_exceeds_balance', 'over balance';
  ASSERT record_session_payment(sid, 0)->>'error' = 'amount_required', 'zero';
  r := end_session(sid);
  ASSERT r->>'error' = 'balance_due' AND (r->>'balance')::numeric = 40, 'end refused: ' || r::text;
  SELECT count(*) INTO n FROM folio_charges c JOIN folios f ON f.id = c.folio_id WHERE f.session_id = sid AND c.type = 'parking_fee';
  ASSERT n = 0, 'no parking fee written on refusal';
  ASSERT (SELECT status FROM parking_sessions WHERE id = sid) <> 'ended', 'still open';
  -- Extra fee counts toward the balance
  r := apply_fee_preset(sid, (SELECT id FROM fee_presets WHERE operator_id = '10000000-0000-0000-0000-000000000002' AND name = 'Lost Ticket' AND active LIMIT 1));
  ASSERT r->>'success' = 'true', 'fee: ' || r::text;
  r := session_details(sid);
  ASSERT (r->>'balance')::numeric = 40 + (r->>'extra_fees')::numeric, 'fee in balance: ' || r::text;
  ASSERT jsonb_array_length(r->'payments') = 1 AND r->'payments'->0->>'method' = 'gcash', 'payment list: ' || r::text;
  r := record_session_payment(sid, (session_details(sid)->>'balance')::numeric, 'cash', NULL);
  ASSERT (r->>'balance')::numeric = 0, 'settle: ' || r::text;
  -- Sarah can't end it; Ana can now that it is settled
  PERFORM pg_temp.act('+639170000001');
  ASSERT end_session(sid)->>'error' = 'Permission denied', 'Sarah end';
  PERFORM pg_temp.act('+639170000003');
  r := end_session(sid);
  ASSERT r->>'success' = 'true', 'end: ' || r::text;
  ASSERT (SELECT status FROM parking_sessions WHERE id = sid) = 'ended', 'ended';
  ASSERT (SELECT status FROM folios WHERE session_id = sid) = 'settled', 'settled';
  ASSERT record_session_payment(sid, 1)->>'error' = 'folio_not_open', 'no pay after end';
  ASSERT update_walk_in_session(sid, now() - interval '1 hour', NULL, 'car', 'ZZW 0002', NULL)->>'error' = 'session_not_active', 'no edit after end';
END $$;

-- Only monthly applies: Automatic = the monthly rate, priced per started month
-- (the default must stay active and unlimited, 0047, so the monthly rate becomes the default)
UPDATE rates SET is_default = false WHERE location_id = '30000000-0000-0000-0000-000000000002' AND is_default;
UPDATE rates SET is_default = true WHERE location_id = '30000000-0000-0000-0000-000000000002' AND rate_type = 'monthly';
UPDATE rates SET active = false WHERE location_id = '30000000-0000-0000-0000-000000000002' AND rate_type <> 'monthly';
DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  monthly rates%ROWTYPE;
  r jsonb; sid uuid;
BEGIN
  SELECT * INTO monthly FROM rates WHERE location_id = SR AND rate_type = 'monthly' LIMIT 1;
  PERFORM pg_temp.act('+639170000002');
  r := walk_in_rate_options(SR, 'car', now());
  ASSERT r->'auto'->>'mode' = 'monthly' AND jsonb_array_length(r->'rates') = 1, 'monthly only: ' || r::text;
  ASSERT started_months('2026-01-01 10:00+08', '2026-02-01 10:00+08') = 1, '1 month';
  ASSERT started_months('2026-01-01 10:00+08', '2026-02-01 10:01+08') = 2, 'started 2nd month';
  ASSERT started_months('2026-01-01 10:00+08', '2026-01-01 11:00+08') = 1, 'min 1';
  ASSERT started_months('2026-01-31 10:00+08', '2026-02-28 10:00+08') = 1, 'Jan 31 + 1 month';
  ASSERT started_months('2026-01-15 00:00+08', '2026-04-15 00:00+08') = 3, '3 months';
  r := start_walk_in(SR, 'car', 'ZZW 0003', NULL, now() + interval '40 days', now() - interval '1 hour');
  ASSERT r->>'success' = 'true', 'monthly start: ' || r::text;
  sid := (r->>'session_id')::uuid;
  r := session_details(sid);
  ASSERT (r->>'parking')::numeric = 2 * monthly.monthly_amount, '41 days = 2 months: ' || r::text;
  ASSERT r->'price'->>'rate_type' = 'monthly', 'monthly type';
END $$;

-- Day-limited rate: a Saturday-only rate applies to a Saturday start, not a Monday one
INSERT INTO rates (location_id, name, rate_type, hourly_amount, days_of_week, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000002', 'ZZ Sat', 'hourly', 70, '{6}', true, false);
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM walk_in_rates('30000000-0000-0000-0000-000000000002', 'car', '2026-11-07 10:00+08') WHERE name = 'ZZ Sat'), 'Sat applies';
  ASSERT NOT EXISTS (SELECT 1 FROM walk_in_rates('30000000-0000-0000-0000-000000000002', 'car', '2026-11-09 10:00+08') WHERE name = 'ZZ Sat'), 'Mon not';
  -- Chosen rate prices the whole stay at that rate: Sat 22:00 for 4 h at ₱70 = ₱280
  ASSERT (session_price('30000000-0000-0000-0000-000000000002', 'car', '2026-11-07 22:00+08', '2026-11-08 02:00+08',
          (SELECT id FROM rates WHERE name = 'ZZ Sat' AND location_id = '30000000-0000-0000-0000-000000000002'))->>'amount')::numeric = 280, 'chosen rate whole stay';
END $$;

ROLLBACK;
