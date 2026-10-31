-- Future-start sessions are reservations (migration 0049). Rolls back.
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
  r jsonb; sid uuid; sid2 uuid; d jsonb;
BEGIN
  PERFORM pg_temp.act('+639170000003');
  -- Tomorrow 10:00-13:00 with no limit on how far ahead
  r := walk_in_quote(SR, 'car', now() + interval '1 day', now() + interval '1 day 3 hours');
  ASSERT r->>'reservation' = 'true' AND r->>'until_now' = 'false', 'quote flags: ' || r::text;
  ASSERT (r->>'billed_hours')::int = 3, 'planned 3h: ' || r::text;
  r := start_walk_in(SR, 'car', 'ZZR 0001', NULL, now() + interval '1 day 3 hours', now() + interval '1 day');
  ASSERT r->>'success' = 'true', 'reserve: ' || r::text;
  sid := (r->>'session_id')::uuid;
  d := session_details(sid);
  ASSERT d->'session'->>'reservation' = 'true', 'details reservation';
  ASSERT (d->>'parking')::numeric = (d->'price'->>'amount')::numeric AND (d->>'parking')::numeric > 0, 'planned amount: ' || d::text;
  -- Deposit
  ASSERT record_session_payment(sid, 20, 'cash')->>'success' = 'true', 'deposit';
  ASSERT (session_details(sid)->>'paid')::numeric = 20, 'paid 20';
  -- Can't end before the start; cancel instead
  ASSERT end_session(sid)->>'error' = 'not_started', 'end refused';
  r := cancel_reservation_session(sid, 'Driver called');
  ASSERT r->>'success' = 'true', 'cancel: ' || r::text;
  ASSERT (SELECT status = 'ended' AND cancelled_at IS NOT NULL FROM parking_sessions WHERE id = sid), 'cancelled';
  ASSERT cancel_reservation_session(sid)->>'error' = 'session_not_active', 'twice';
  ASSERT (session_details(sid)->>'parking')::numeric = 0, 'no parking fee when cancelled';
  -- A started session can't be cancelled as a reservation; no-end reservation = minimum unit
  r := start_walk_in(SR, 'car', 'ZZR 0002', NULL, NULL, now() + interval '2 days');
  sid2 := (r->>'session_id')::uuid;
  ASSERT (session_details(sid2)->'price'->>'billed_hours')::int = 1, 'min unit';
  UPDATE parking_sessions SET started_at = now() - interval '1 hour' WHERE id = sid2;
  ASSERT cancel_reservation_session(sid2)->>'error' = 'already_started', 'started';
  -- Other listing's staff can't cancel
  PERFORM pg_temp.act('+639170000001');
  ASSERT cancel_reservation_session(sid2)->>'error' = 'Permission denied', 'perm';
  RAISE NOTICE 'reservations: ok';
END $$;

ROLLBACK;
