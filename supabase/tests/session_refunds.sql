-- Refunds on ended sessions (migration 0052). Rolls back.
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
  dflt uuid := (SELECT id FROM rates WHERE location_id = '30000000-0000-0000-0000-000000000002' AND is_default);
  r jsonb; sid uuid; d jsonb; st timestamptz := now() - interval '150 minutes';
BEGIN
  PERFORM pg_temp.act('+639170000003');
  -- Cancelled reservation with a ₱30 deposit
  r := start_walk_in(SR, 'car', 'ZZF 0001', NULL, NULL, now() + interval '1 day');
  sid := (r->>'session_id')::uuid;
  ASSERT record_session_payment(sid, 30, 'cash')->>'success' = 'true', 'deposit';
  ASSERT record_session_refund(sid, 10)->>'error' = 'refund_needs_ended', 'open: no refund';
  ASSERT cancel_reservation_session(sid)->>'success' = 'true', 'cancel';
  ASSERT (session_details(sid)->>'refundable')::numeric = 30, 'refundable 30';
  r := record_session_refund(sid, 31, 'cash');
  ASSERT r->>'error' = 'refund_exceeds_refundable' AND (r->>'refundable')::numeric = 30, 'too much: ' || r::text;
  ASSERT record_session_refund(sid, 0)->>'error' = 'amount_required', 'zero';
  ASSERT record_session_refund(sid, 20, 'gcash', 'ref 9')->>'success' = 'true', 'refund 20';
  d := session_details(sid);
  ASSERT (d->>'paid')::numeric = 10 AND (d->>'refunded')::numeric = 20 AND (d->>'refundable')::numeric = 10, 'net: ' || d::text;
  ASSERT EXISTS (SELECT 1 FROM payments WHERE folio_id = (SELECT id FROM folios WHERE session_id = sid)
            AND direction = 'refund' AND amount = 20 AND method = 'gcash' AND note = 'ref 9'
            AND recorded_by IS NOT NULL AND received_at IS NOT NULL), 'row';
  ASSERT record_session_refund(sid, 10)->>'success' = 'true', 'rest';
  ASSERT (session_details(sid)->>'refundable')::numeric = 0, 'nothing left';
  -- Other listing's people can't refund
  PERFORM pg_temp.act('+639170000001');
  ASSERT record_session_refund(sid, 1)->>'error' = 'Permission denied', 'perm';
  -- Overpaid ended session: paid 3h, end moved to 1h, ended -> credit = 2h
  PERFORM pg_temp.act('+639170000003');
  r := start_walk_in(SR, 'car', 'ZZF 0002', NULL, NULL, st, dflt);
  sid := (r->>'session_id')::uuid;
  d := session_details(sid);
  ASSERT record_session_payment(sid, (d->>'balance')::numeric, 'cash')->>'success' = 'true', 'paid in full';
  ASSERT update_walk_in_session(sid, st, st + interval '1 hour', 'car', 'ZZF 0002', dflt)->>'success' = 'true', 'end earlier';
  ASSERT (session_details(sid)->>'refundable')::numeric = 0, 'not refundable while open';
  ASSERT end_session(sid)->>'success' = 'true', 'end with credit';
  d := session_details(sid);
  ASSERT (d->>'balance')::numeric < 0 AND (d->>'refundable')::numeric = -(d->>'balance')::numeric, 'credit: ' || d::text;
  ASSERT record_session_refund(sid, (d->>'refundable')::numeric)->>'success' = 'true', 'refund credit';
  ASSERT (session_details(sid)->>'balance')::numeric = 0, 'settled';
  RAISE NOTICE 'refunds: ok';
END $$;

ROLLBACK;
