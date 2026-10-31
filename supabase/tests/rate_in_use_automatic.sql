-- Automatic sessions that could use a rate block deactivating it (0050). Rolls back.
BEGIN;
INSERT INTO rates (location_id, name, rate_type, hourly_amount, days_of_week, vehicle_type, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000002', 'T SUV Sat', 'hourly', 80, '{6}', 'suv', true, false);
INSERT INTO rates (location_id, name, rate_type, hourly_amount, effective_from, effective_to, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000002', 'T Xmas', 'hourly', 90, '2026-12-24 00:00+08', '2026-12-25 23:59+08', true, false);

CREATE FUNCTION pg_temp.sess(p_v vehicle_type, p_start timestamptz, p_end timestamptz, p_rate uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO parking_sessions (location_id, plate, vehicle_type, started_at, scheduled_end_at, status, rate_id)
  VALUES ('30000000-0000-0000-0000-000000000002', 'ZZU ' || floor(random() * 9999)::text, p_v, p_start, p_end, 'active', p_rate)
  RETURNING id;
$$;

DO $$
DECLARE
  sat uuid := (SELECT id FROM rates WHERE name = 'T SUV Sat');
  xm uuid := (SELECT id FROM rates WHERE name = 'T Xmas');
  b_sat int := rate_open_session_count((SELECT id FROM rates WHERE name = 'T SUV Sat'));
  b_xm int := rate_open_session_count((SELECT id FROM rates WHERE name = 'T Xmas'));
  x uuid;
BEGIN
  -- Not used: wrong vehicle; SUV but Mon only; chosen another rate
  PERFORM pg_temp.sess('car', '2026-11-07 10:00+08', NULL);
  PERFORM pg_temp.sess('suv', '2026-11-09 10:00+08', '2026-11-09 12:00+08');
  PERFORM pg_temp.sess('suv', '2026-11-07 10:00+08', '2026-11-07 12:00+08', xm);
  ASSERT rate_open_session_count(sat) = b_sat, 'nothing uses Sat yet';
  -- Used: Fri 22:00 -> Sat 02:00 crosses into Saturday
  x := pg_temp.sess('suv', '2026-11-06 22:00+08', '2026-11-07 02:00+08');
  ASSERT rate_open_session_count(sat) = b_sat + 1, 'crosses into Sat';
  -- Used: SUV on Monday with no end (open-ended reaches a Saturday)
  PERFORM pg_temp.sess('suv', '2026-11-09 10:00+08', NULL);
  ASSERT rate_open_session_count(sat) = b_sat + 2, 'open-ended';
  -- Dates: Nov 2-3 doesn't reach Christmas; no end does; chosen rate counts
  -- chosen + the two open-ended sessions above (they reach Christmas)
  ASSERT rate_open_session_count(xm) = b_xm + 3, 'chosen + open-ended: ' || rate_open_session_count(xm);
  PERFORM pg_temp.sess('car', '2026-11-02 10:00+08', '2026-11-03 10:00+08');
  ASSERT rate_open_session_count(xm) = b_xm + 3, 'Nov stay';
  PERFORM pg_temp.sess('car', '2026-12-25 10:00+08', '2026-12-25 12:00+08');
  ASSERT rate_open_session_count(xm) = b_xm + 4, 'Xmas stay';
  -- Ended sessions never count
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id = x;
  ASSERT rate_open_session_count(sat) = b_sat + 1, 'ended ignored';
  -- set_rate_active reports the count
  PERFORM set_config('request.jwt.claim.sub', (SELECT id FROM profiles WHERE phone = '+639170000002')::text, true);
  ASSERT (set_rate_active(sat, false)->>'sessions')::int = b_sat + 1, 'rpc count';
END $$;

ROLLBACK;
