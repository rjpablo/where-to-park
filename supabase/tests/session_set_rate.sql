-- A session keeps one set rate; Automatic resolves at check-in/edit (migration 0054). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;
INSERT INTO rates (location_id, name, rate_type, hourly_amount, days_of_week, vehicle_type, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000002', 'T SUV Sat', 'hourly', 80, '{6}', 'suv', true, false);

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  dflt uuid := (SELECT id FROM rates WHERE location_id = '30000000-0000-0000-0000-000000000002' AND is_default);
  sat uuid := (SELECT id FROM rates WHERE name = 'T SUV Sat');
  r jsonb; sid uuid; d jsonb; b_sat int; b_dflt int;
BEGIN
  -- No open session stores rate_id NULL (backfilled; the trigger fills new ones)
  ASSERT NOT EXISTS (SELECT 1 FROM parking_sessions WHERE status IN ('active', 'overdue') AND rate_id IS NULL), 'backfilled';
  b_sat := rate_open_session_count(sat);
  b_dflt := rate_open_session_count(dflt);
  PERFORM pg_temp.act('+639170000003');
  -- Dropdown: Automatic says which rate it resolves to
  ASSERT walk_in_rate_options(SR, 'suv', '2026-11-07 10:00+08')->'auto'->>'rate_name' = 'T SUV Sat', 'auto Sat';
  ASSERT walk_in_rate_options(SR, 'suv', '2026-11-06 10:00+08')->'auto'->>'rate_name' = 'Standard Rate', 'auto Fri';
  -- Automatic check-in Fri 22:00 -> Sat 02:00: stores the default; priced all at it (no split)
  r := start_walk_in(SR, 'suv', 'ZZS 0001', NULL, '2026-11-07 02:00+08', '2026-11-06 22:00+08');
  ASSERT r->>'success' = 'true', 'start: ' || r::text;
  sid := (r->>'session_id')::uuid;
  ASSERT (SELECT rate_id FROM parking_sessions WHERE id = sid) = dflt, 'stored default';
  d := session_details(sid);
  ASSERT d->'price'->>'rate_name' = 'Standard Rate' AND jsonb_array_length(d->'price'->'breakdown') = 1, 'one rate: ' || d::text;
  -- Only the stored rate is blocked by it
  ASSERT rate_open_session_count(sat) = b_sat, 'Sat rate not used';
  ASSERT rate_open_session_count(dflt) = b_dflt + 1, 'default used';
  PERFORM pg_temp.act('+639170000002');
  ASSERT set_rate_active(sat, false)->>'success' = 'true', 'Sat rate can be deactivated';
  ASSERT set_rate_active(sat, true)->>'success' = 'true', 'reactivate';
  -- Edit back to Automatic with a Saturday start: re-resolves and stores the Sat rate
  PERFORM pg_temp.act('+639170000003');
  r := update_walk_in_session(sid, '2026-11-07 10:00+08', '2026-11-07 12:00+08', 'suv', 'ZZS 0001', NULL);
  ASSERT r->>'success' = 'true', 'edit: ' || r::text;
  ASSERT (SELECT rate_id FROM parking_sessions WHERE id = sid) = sat, 're-resolved to Sat';
  ASSERT (session_details(sid)->>'parking')::numeric = 160, '2h x 80';
  PERFORM pg_temp.act('+639170000002');
  r := set_rate_active(sat, false);
  ASSERT r->>'error' = 'rate_in_use' AND (r->>'sessions')::int = b_sat + 1, 'now blocked: ' || r::text;
  -- Editing other fields keeps the stored rate (no silent re-resolve)
  PERFORM pg_temp.act('+639170000003');
  r := update_walk_in_session(sid, '2026-11-07 10:00+08', '2026-11-07 13:00+08', 'suv', 'ZZS 0001', sat);
  ASSERT (SELECT rate_id FROM parking_sessions WHERE id = sid) = sat, 'kept';
  -- 0055: an open-ended session on the Sat rate doesn't block; it keeps pricing at it
  r := start_walk_in(SR, 'suv', 'ZZS 0002', NULL, NULL, '2026-11-07 10:00+08');
  ASSERT (SELECT rate_id FROM parking_sessions WHERE id = (r->>'session_id')::uuid) = sat, 'open-ended on Sat';
  PERFORM pg_temp.act('+639170000002');
  ASSERT (set_rate_active(sat, false)->>'sessions')::int = b_sat + 1, 'open-ended not counted';
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id = sid;
  ASSERT set_rate_active(sat, false)->>'success' = 'true', 'deactivated with an open-ended session on it';
  PERFORM pg_temp.act('+639170000003');
  d := session_details((r->>'session_id')::uuid);
  ASSERT d->'session'->>'rate_active' = 'false' AND d->'price'->>'rate_name' = 'T SUV Sat', 'still priced, flagged: ' || d::text;
  RAISE NOTICE 'session set rate: ok';
END $$;
ROLLBACK;
