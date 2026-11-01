-- Sessions split per started hour over ACTIVE rates only (migration 0057). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;
INSERT INTO rates (location_id, name, rate_type, hourly_amount, days_of_week, vehicle_type, active, is_default, priority)
VALUES ('30000000-0000-0000-0000-000000000002', 'T SUV Sat', 'hourly', 80, '{6}', 'suv', true, false, 10),
       ('30000000-0000-0000-0000-000000000002', 'T SUV Any', 'hourly', 65, NULL, 'suv', true, false, 0);

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  dflt uuid := (SELECT id FROM rates WHERE location_id = '30000000-0000-0000-0000-000000000002' AND is_default);
  sat uuid := (SELECT id FROM rates WHERE name = 'T SUV Sat');
  anyr uuid := (SELECT id FROM rates WHERE name = 'T SUV Any');
  fri timestamptz := '2026-11-06 22:00+08';
  sat2 timestamptz := '2026-11-07 02:00+08';
  r jsonb; a uuid; p uuid; q jsonb; d jsonb;
BEGIN
  PERFORM set_config('test.sat', sat::text, true);
  PERFORM pg_temp.act('+639170000003');
  -- Automatic: every hour by priority (Fri 2h T SUV Any ₱65 + Sat 2h T SUV Sat ₱80), like the preview
  r := start_walk_in(SR, 'suv', 'ZZP 0001', NULL, sat2, fri);
  a := (r->>'session_id')::uuid;
  ASSERT (SELECT rate_auto FROM parking_sessions WHERE id = a), 'auto flag set';
  d := session_details(a);
  ASSERT (d->>'parking')::numeric = 290 AND jsonb_array_length(d->'price'->'breakdown') = 2, 'auto split: ' || d::text;
  q := quote_price(SR, 'suv', fri, 4);
  ASSERT (q->>'amount')::numeric = 290, 'preview agrees: ' || q::text;
  -- Picked rate: priced at it for every hour it applies to (T SUV Any applies all 4 h = ₱260)
  r := start_walk_in(SR, 'suv', 'ZZP 0002', NULL, sat2, fri, anyr);
  p := (r->>'session_id')::uuid;
  ASSERT NOT (SELECT rate_auto FROM parking_sessions WHERE id = p), 'picked flag';
  ASSERT (session_details(p)->>'parking')::numeric = 260, 'picked wins where it applies';
  -- Picked day-limited rate: Sat 22:00 -> Sun 02:00: Sat hours at it, Sun hours fall back
  -- to priority (T SUV Any): 2 × ₱80 + 2 × ₱65
  r := update_walk_in_session(p, '2026-11-07 22:00+08', '2026-11-08 02:00+08', 'suv', 'ZZP 0002', sat);
  ASSERT r->>'success' = 'true', 'edit: ' || r::text;
  ASSERT (session_details(p)->>'parking')::numeric = 160 + 130, 'picked Sat + fallback Sun';
  -- Picking the default overrides higher-priority rates where it applies: 4h × ₱50
  r := update_walk_in_session(p, fri, sat2, 'suv', 'ZZP 0002', dflt);
  ASSERT (session_details(p)->>'parking')::numeric = 200, 'picked default all hours';
  -- Re-picking Automatic flips back to priority split
  r := update_walk_in_session(p, fri, sat2, 'suv', 'ZZP 0002', NULL);
  ASSERT (SELECT rate_auto FROM parking_sessions WHERE id = p) AND (session_details(p)->>'parking')::numeric = 290, 'back to auto';
  -- Inactive rates never price any hour (Sat rate isn't any session's stored rate, so it can go)
  PERFORM pg_temp.act('+639170000002');
  ASSERT set_rate_active(sat, false)->>'success' = 'true', 'deactivate Sat';
  PERFORM pg_temp.act('+639170000003');
  ASSERT (session_details(a)->>'parking')::numeric = 260, 'Sat hours fall back to T SUV Any';
  ASSERT NOT (quote_price(SR, 'suv', fri, 4)->'breakdown' @> jsonb_build_array(jsonb_build_object('rate_id', sat))), 'preview skips inactive';
  ASSERT (session_price(SR, 'suv', fri, sat2, sat)->>'amount')::numeric = 260, 'picked inactive rate prices nothing';
  ASSERT NOT (session_price(SR, 'suv', fri, sat2, sat)->'breakdown' @> jsonb_build_array(jsonb_build_object('rate_id', sat))), 'no hour at inactive';
  -- Default fallback when nothing else applies: deactivate T SUV Any too
  PERFORM pg_temp.act('+639170000002');
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id IN (a, p);
  ASSERT set_rate_active(anyr, false)->>'success' = 'true', 'deactivate Any';
  ASSERT (session_price(SR, 'suv', fri, sat2, anyr)->>'amount')::numeric = 200, 'default fallback';
  RAISE NOTICE 'session split active rates: ok';
END $$;
ROLLBACK;
