-- One started, open session per plate per listing (migration 0062). Rolls back.
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
  OTHER uuid;
  r jsonb; a uuid; b uuid; res uuid;
BEGIN
  PERFORM pg_temp.act('+639170000002'); -- Juan (owner)
  SELECT id INTO OTHER FROM locations
   WHERE id <> SR AND operator_id = (SELECT operator_id FROM locations WHERE id = SR)
     AND deleted_at IS NULL LIMIT 1;

  r := start_walk_in(SR, 'car', 'QZ 7001', NULL, NULL, now() - interval '10 minutes');
  ASSERT r->>'success' = 'true', 'first: ' || r::text;
  a := (r->>'session_id')::uuid;

  -- Same plate (case / spaces differ) at the same listing: refused, names the session
  r := start_walk_in(SR, 'car', ' qz7001 ');
  ASSERT r->>'error' = 'plate_active', 'dup refused: ' || r::text;
  ASSERT (r->>'session_id')::uuid = a AND r->>'plate' = 'QZ 7001', 'names existing: ' || r::text;
  ASSERT (SELECT COUNT(*) FROM parking_sessions WHERE location_id = SR AND plate_key(plate) = 'QZ7001') = 1, 'no second row';

  -- A future reservation for the same plate is allowed
  r := start_walk_in(SR, 'car', 'QZ 7001', NULL, NULL, now() + interval '1 day');
  ASSERT r->>'success' = 'true', 'reservation ok: ' || r::text;
  res := (r->>'session_id')::uuid;
  -- ...but moving it to start now is refused (edit and override)
  r := update_walk_in_session(res, now() - interval '1 minute', NULL, 'car', 'QZ 7001', NULL);
  ASSERT r->>'error' = 'plate_active' AND (r->>'session_id')::uuid = a, 'edit start refused: ' || r::text;
  r := override_session_start(res, now() - interval '1 minute', 'arrived early');
  ASSERT r->>'error' = 'plate_active', 'override refused: ' || r::text;
  ASSERT (SELECT started_at > now() FROM parking_sessions WHERE id = res), 'reservation untouched';

  -- Another listing: allowed
  IF OTHER IS NOT NULL THEN
    r := start_walk_in(OTHER, 'car', 'QZ 7001');
    ASSERT r->>'success' = 'true' OR r->>'error' <> 'plate_active', 'other listing not blocked: ' || r::text;
  END IF;

  -- Editing a started session onto an active plate is refused; other edits are fine
  r := start_walk_in(SR, 'car', 'QZ 7002');
  b := (r->>'session_id')::uuid;
  r := update_walk_in_session(b, now() - interval '5 minutes', NULL, 'car', 'qz 7001', NULL);
  ASSERT r->>'error' = 'plate_active', 'edit plate refused: ' || r::text;
  r := update_walk_in_session(a, now() - interval '20 minutes', now() + interval '2 hours', 'suv', 'QZ 7001', NULL);
  ASSERT r->>'success' = 'true', 'same-plate edit ok: ' || r::text;

  -- Once the first session ends the plate is free again
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id = a;
  r := update_walk_in_session(b, now() - interval '5 minutes', NULL, 'car', 'QZ 7001', NULL);
  ASSERT r->>'success' = 'true', 'after end ok: ' || r::text;
  r := start_walk_in(SR, 'car', 'QZ7001');
  ASSERT r->>'error' = 'plate_active' AND (r->>'session_id')::uuid = b, 'b now holds it: ' || r::text;

  -- Helper is not callable by clients
  ASSERT NOT has_function_privilege('authenticated', 'active_plate_conflict(uuid, text, uuid)', 'EXECUTE'), 'helper private';
END $$;
ROLLBACK;
