-- Rate deactivate / activate / archive (migration 0048). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;

INSERT INTO rates (location_id, name, rate_type, hourly_amount, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000002', 'T Promo', 'hourly', 10, true, false);

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  dflt uuid := (SELECT id FROM rates WHERE location_id = '30000000-0000-0000-0000-000000000002' AND is_default);
  promo uuid := (SELECT id FROM rates WHERE name = 'T Promo');
  r jsonb; sid uuid; fut uuid;
BEGIN
  -- 0050: other open Automatic sessions could use an all-vehicle rate; end them first.
  UPDATE parking_sessions SET status = 'ended', ended_at = now()
   WHERE location_id = SR AND status IN ('active', 'overdue');
  -- Staff can't deactivate (admins only)
  PERFORM pg_temp.act('+639170000003');
  ASSERT set_rate_active(promo, false)->>'error' = 'Permission denied', 'staff';
  PERFORM pg_temp.act('+639170000002');
  -- The default can't be deactivated, archived or deleted
  ASSERT set_rate_active(dflt, false)->>'error' = 'cannot_deactivate_default', 'dflt deact';
  ASSERT archive_rate(dflt)->>'error' = 'cannot_archive_default', 'dflt archive';
  ASSERT delete_rate(dflt)->>'error' = 'cannot_delete_default', 'dflt delete';
  -- Archive needs inactive
  ASSERT archive_rate(promo)->>'error' = 'archive_needs_inactive', 'archive active';
  -- In use by a started session and a future-start one: blocked with the count
  r := start_walk_in(SR, 'car', 'ZZD 0001', NULL, NULL, now() - interval '1 hour', promo);
  ASSERT r->>'success' = 'true', 'start: ' || r::text;
  sid := (r->>'session_id')::uuid;
  r := set_rate_active(promo, false);
  ASSERT r->>'error' = 'rate_in_use' AND (r->>'sessions')::int = 1, 'in use: ' || r::text;
  BEGIN
    UPDATE rates SET active = false WHERE id = promo;
    ASSERT false, 'trigger should block';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id = sid;
  -- Free now: deactivate
  r := set_rate_active(promo, false);
  ASSERT r->>'success' = 'true', 'deactivate: ' || r::text;
  -- Inactive: never applicable, refused for new sessions and edits, not in quotes
  ASSERT NOT EXISTS (SELECT 1 FROM walk_in_rates(SR, 'car', now()) WHERE id = promo), 'not applicable';
  r := start_walk_in(SR, 'car', 'ZZD 0002', NULL, NULL, NULL, promo);
  ASSERT r->>'error' = 'rate_not_applicable', 'start refused: ' || r::text;
  ASSERT NOT (walk_in_rate_options(SR, 'car', now())::text LIKE '%' || promo::text || '%'), 'not in dropdown';
  ASSERT NOT (quote_price(SR, 'car', now(), 3)::text LIKE '%T Promo%'), 'not in preview';
  -- History keeps the rate; delete is refused because a session references it
  ASSERT delete_rate(promo)->>'error' = 'rate_has_sessions', 'delete refused';
  -- Re-activate and deactivate again, then archive
  ASSERT set_rate_active(promo, true)->>'success' = 'true', 'reactivate';
  ASSERT set_rate_active(promo, false)->>'success' = 'true', 'deactivate again';
  ASSERT archive_rate(promo)->>'success' = 'true', 'archive';
  ASSERT (SELECT archived_at IS NOT NULL FROM rates WHERE id = promo), 'archived_at';
  ASSERT set_rate_active(promo, true)->>'error' = 'rate_archived', 'no un-archive';
  ASSERT (SELECT rate_id FROM parking_sessions WHERE id = sid) = promo, 'past session keeps rate';
  RAISE NOTICE 'rate deactivate/archive: ok';
END $$;

ROLLBACK;
