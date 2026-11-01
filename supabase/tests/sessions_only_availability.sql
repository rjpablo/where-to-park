-- Sessions-only availability (migration 0064). Rolls back.
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
  TL uuid := (SELECT id FROM locations WHERE name = 'Test List' AND deleted_at IS NULL LIMIT 1);
  cap int; started int; r jsonb; a uuid; res uuid; f0 int; row_free int;
BEGIN
  PERFORM pg_temp.act('+639170000002'); -- Juan (owner)
  -- Test List: 1 parked car, no Reserved/Unavailable, counted by sessions -> 9 of 10
  IF TL IS NOT NULL THEN
    UPDATE locations SET tracking_mode = 'count', manual_reserved_count = 0, unavailable_count = 0, capacity = 10 WHERE id = TL;
    started := (SELECT COUNT(*) FROM parking_sessions WHERE location_id = TL AND status IN ('active','overdue') AND started_at <= now());
    ASSERT location_free_spaces(TL) = 10 - started, 'Test List free: ' || location_free_spaces(TL);
  END IF;

  UPDATE locations SET manual_reserved_count = 0, unavailable_count = 0 WHERE id = SR;
  SELECT capacity INTO cap FROM locations WHERE id = SR;
  f0 := location_free_spaces(SR);
  started := (SELECT COUNT(*) FROM parking_sessions WHERE location_id = SR AND status IN ('active','overdue') AND started_at <= now());
  ASSERT f0 = cap - started, 'formula: ' || f0;

  -- A walk-in takes one; cache, search and computed field agree
  r := start_walk_in(SR, 'car', 'QZ 6401');
  ASSERT r->>'success' = 'true', 'walk-in: ' || r::text;
  a := (r->>'session_id')::uuid;
  ASSERT location_free_spaces(SR) = f0 - 1, 'walk-in deducted';
  ASSERT (SELECT available_count FROM locations WHERE id = SR) = f0 - 1, 'cache synced by trigger';
  SELECT free_spaces(l) INTO row_free FROM locations l WHERE l.id = SR;
  ASSERT row_free = f0 - 1, 'computed field';
  ASSERT (SELECT s.available_count FROM search_nearby(16.4023, 120.5960, 20000) s WHERE s.id = SR) = f0 - 1, 'search agrees';

  -- A future reservation doesn't take a space before it starts (bug fix)
  r := start_walk_in(SR, 'car', 'QZ 6402', NULL, NULL, now() + interval '1 day');
  ASSERT r->>'success' = 'true', 'reservation: ' || r::text;
  res := (r->>'session_id')::uuid;
  ASSERT location_free_spaces(SR) = f0 - 1, 'reservation not deducted yet';

  -- Reserved / Unavailable come off; never below 0
  r := set_manual_counts(SR, 2, 1);
  ASSERT r->>'success' = 'true' AND (r->>'available_count')::int = f0 - 4, 'manual: ' || r::text;
  ASSERT location_free_spaces(SR) = f0 - 4, 'manual deducted';

  -- Full listing: walk-in refused even with a future reservation around; reservation alone doesn't fill it
  UPDATE locations SET manual_reserved_count = 0, unavailable_count = cap - started - 2 WHERE id = SR;
  ASSERT location_free_spaces(SR) = 1, 'one left';
  r := start_walk_in(SR, 'car', 'QZ 6403');
  ASSERT r->>'success' = 'true', 'last space ok despite a future reservation: ' || r::text;
  ASSERT location_free_spaces(SR) = 0, 'now full';
  r := start_walk_in(SR, 'car', 'QZ 6404');
  ASSERT r->>'error' = 'no_longer_available', 'full refused: ' || r::text;

  -- Ending frees it
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id = a;
  ASSERT location_free_spaces(SR) = 1, 'end frees';
  ASSERT (SELECT available_count FROM locations WHERE id = SR) = 1, 'cache after end';

  -- Public can read the number
  ASSERT has_function_privilege('anon', 'location_free_spaces(uuid)', 'EXECUTE'), 'anon reads free';
END $$;
ROLLBACK;
