-- Areas (migration 0067, rj t139u). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act_id(v uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN v IS NULL THEN '{}' ELSE json_build_object('sub', v, 'role', 'authenticated')::text END, true);
END $$;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.act_id((SELECT id FROM profiles WHERE phone = p_phone)); END $$;

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  main uuid; moto uuid; tmp uuid; newloc uuid; outsider uuid;
  r jsonb; main_free int; s1 uuid; s2 uuid; car_s uuid;
BEGIN
  -- Migration: one Main per listing, sessions all in an area, totals unchanged
  ASSERT NOT EXISTS (SELECT 1 FROM locations l WHERE (SELECT COUNT(*) FROM areas a WHERE a.location_id = l.id AND a.is_main) <> 1), 'one Main each';
  ASSERT NOT EXISTS (SELECT 1 FROM parking_sessions WHERE area_id IS NULL), 'sessions have an area';
  main := main_area_id(SR);
  ASSERT (SELECT name FROM areas WHERE id = main) = 'Main', 'named Main';
  ASSERT (SELECT capacity FROM areas WHERE id = main) = (SELECT capacity FROM locations WHERE id = SR), 'Main has the spots';
  main_free := location_free_spaces(SR);
  ASSERT main_free = area_free_spaces(main) AND main_free > 3, 'aggregate = Main';
  SELECT p.id INTO outsider FROM profiles p WHERE NOT can_work_location(SR, p.id) AND NOT is_admin(p.id) LIMIT 1;

  -- Main can't be deleted or renamed (RPCs and direct writes)
  PERFORM pg_temp.act('+639170000002');
  ASSERT delete_area(main)->>'error' = 'main_area_locked', 'no delete Main';
  ASSERT upsert_area(SR, 'Ground', main)->>'error' = 'main_area_locked', 'no rename Main';
  ASSERT upsert_area(SR, 'Main', main)->>'success' = 'true', 'saving Main unchanged is fine';
  BEGIN
    UPDATE areas SET name = 'X' WHERE id = main;
    ASSERT false, 'direct rename should fail';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    DELETE FROM areas WHERE id = main;
    ASSERT false, 'direct delete should fail';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  -- Staff and outsiders can't manage areas; anon can't set anything
  PERFORM pg_temp.act('+639170000003');
  ASSERT upsert_area(SR, 'QZ Staff')->>'error' = 'Permission denied', 'staff no create';
  ASSERT set_area_settings(main, 5, NULL, true)->>'error' = 'Permission denied', 'staff no settings';
  PERFORM pg_temp.act_id(NULL);
  ASSERT set_area_full(main, true)->>'error' = 'not_authenticated', 'anon no full';
  ASSERT NOT has_function_privilege('anon', 'set_area_full(uuid, boolean)', 'EXECUTE'), 'anon no grant';
  ASSERT NOT has_function_privilege('authenticated', 'refresh_location_availability(uuid[])', 'EXECUTE'), 'internal refresh';
  ASSERT NOT has_function_privilege('authenticated', 'claim_capacity(uuid, uuid, timestamptz, timestamptz, text, uuid)', 'EXECUTE'), 'internal claim';
  IF outsider IS NOT NULL THEN
    PERFORM pg_temp.act_id(outsider);
    ASSERT set_area_full(main, true)->>'error' = 'Permission denied', 'outsider no full';
    ASSERT set_area_counts(main, 1, 0)->>'error' = 'Permission denied', 'outsider no counts';
  END IF;

  -- Owner adds a motorcycle-only area with 2 spots
  PERFORM pg_temp.act('+639170000002');
  ASSERT upsert_area(SR, ' main ')->>'error' = 'area_name_taken', 'names unique';
  r := upsert_area(SR, 'QZ Moto');
  moto := (r->>'area_id')::uuid;
  ASSERT moto IS NOT NULL, 'created: ' || r::text;
  ASSERT set_area_settings(moto, -1, NULL, true)->>'error' = 'capacity_invalid', 'negative spots';
  r := set_area_settings(moto, 2, ARRAY['motorcycle']::vehicle_type[], true);
  ASSERT r->>'success' = 'true', 'settings: ' || r::text;
  ASSERT location_free_spaces(SR) = main_free + 2, 'total adds the area';
  ASSERT (SELECT capacity FROM locations WHERE id = SR) = (SELECT capacity FROM areas WHERE id = main) + 2, 'listing capacity cache';
  -- Search: a vehicle filter counts only areas that take it
  ASSERT (SELECT available_count FROM search_nearby(16.4023, 120.5960, 20000, 'car') WHERE id = SR) = main_free, 'car: Main only';
  ASSERT (SELECT available_count FROM search_nearby(16.4023, 120.5960, 20000, 'motorcycle') WHERE id = SR) = main_free + 2, 'moto: both';
  ASSERT (SELECT available_count FROM search_nearby(16.4023, 120.5960, 20000) WHERE id = SR) = main_free + 2, 'all: both';

  -- Check-in per area (staff): vehicle must fit, capacity per area
  PERFORM pg_temp.act('+639170000003');
  ASSERT start_walk_in(SR, 'car', 'QZ 7701', p_area_id => moto)->>'error' = 'vehicle_not_allowed', 'car not in moto area';
  r := start_walk_in(SR, 'motorcycle', 'QZ 7702', p_area_id => moto);
  ASSERT r->>'success' = 'true' AND (r->>'area_id')::uuid = moto, 'moto 1: ' || r::text;
  s1 := (r->>'session_id')::uuid;
  ASSERT (SELECT area_id FROM parking_sessions WHERE id = s1) = moto, 'session in area';
  ASSERT start_walk_in(SR, 'motorcycle', 'QZ 7703', p_area_id => moto)->>'success' = 'true', 'moto 2';
  r := start_walk_in(SR, 'motorcycle', 'QZ 7704', p_area_id => moto);
  ASSERT r->>'error' = 'no_longer_available', 'area full refuses: ' || r::text;
  ASSERT area_is_full(moto) AND NOT location_is_full(SR), 'area full, listing not';
  -- Plate rule stays per listing (not per area)
  ASSERT start_walk_in(SR, 'motorcycle', 'QZ 7702')->>'error' = 'plate_active', 'plate per listing';
  -- No area = Main
  r := start_walk_in(SR, 'car', 'QZ 7705');
  car_s := (r->>'session_id')::uuid;
  ASSERT (SELECT area_id FROM parking_sessions WHERE id = car_s) = main, 'default Main';
  ASSERT area_free_spaces(main) = main_free - 1, 'Main drops by one';
  -- Moving a session into a full area is refused; a disallowed vehicle too
  r := update_walk_in_session(car_s, (SELECT started_at FROM parking_sessions WHERE id = car_s), NULL, 'motorcycle', 'QZ 7705', NULL, moto);
  ASSERT r->>'error' = 'no_longer_available', 'move into full area: ' || r::text;
  ASSERT (session_details(s1)->'session'->>'area_name') = 'QZ Moto', 'details carry area';

  -- Reserved/Unavailable per area (staff)
  ASSERT set_area_counts(moto, 1, 0)->>'error' = 'no_longer_available', 'no room to hold';
  r := set_area_counts(main, 2, 1);
  ASSERT r->>'success' = 'true' AND area_counted_spaces(main) = main_free - 1 - 3, 'held: ' || r::text;

  -- Full switch per area: the listing is Full only when every area is
  r := set_area_full(main, true);
  ASSERT r->>'success' = 'true' AND (r->>'listing_full')::boolean, 'Main Full + moto full = listing Full: ' || r::text;
  ASSERT EXISTS (SELECT 1 FROM availability_events WHERE area_id = main AND change = 'marked_full'), 'logged with area';
  ASSERT (SELECT NOT open_status AND available_count = 0 FROM search_nearby(16.4023, 120.5960, 20000) WHERE id = SR), 'search Full';
  ASSERT NOT EXISTS (SELECT 1 FROM search_nearby(16.4023, 120.5960, 20000, NULL, false, true) WHERE id = SR), 'hide full';
  ASSERT (SELECT listing_full(l) FROM locations l WHERE id = SR), 'computed listing_full';
  -- Walk-in into Main still allowed while switched Full (manual override)
  ASSERT start_walk_in(SR, 'car', 'QZ 7706')->>'success' = 'true', 'walk-in while Full';

  -- Unmonitored areas: no number, Full only via the toggle, check-in not counted
  PERFORM pg_temp.act('+639170000002');
  ASSERT set_area_settings(moto, NULL, ARRAY['motorcycle']::vehicle_type[], false)->>'success' = 'true', 'unmonitor';
  ASSERT area_free_spaces(moto) IS NULL AND NOT area_is_full(moto), 'no number, available';
  ASSERT NOT location_is_full(SR), 'listing open again via the unmonitored area';
  ASSERT (SELECT open_status FROM search_nearby(16.4023, 120.5960, 20000, 'motorcycle') WHERE id = SR), 'moto search open';
  ASSERT (SELECT NOT open_status FROM search_nearby(16.4023, 120.5960, 20000, 'car') WHERE id = SR), 'car search still Full';
  PERFORM pg_temp.act('+639170000003');
  ASSERT set_area_counts(moto, 1, 0)->>'error' = 'area_not_monitored', 'no held counts when unmonitored';
  ASSERT start_walk_in(SR, 'motorcycle', 'QZ 7707', p_area_id => moto)->>'success' = 'true', 'recorded as normal';
  ASSERT set_area_full(moto, true)->>'success' = 'true', 'toggle Full';
  ASSERT location_is_full(SR), 'both Full = listing Full';
  -- Only unmonitored areas: no count at all
  PERFORM pg_temp.act('+639170000002');
  PERFORM set_area_full(main, false);
  PERFORM set_area_counts(main, 0, 0);
  ASSERT set_area_settings(main, NULL, NULL, false)->>'success' = 'true', 'unmonitor Main';
  ASSERT location_free_spaces(SR) IS NULL AND NOT location_is_full(SR), 'no count, Available';
  ASSERT (SELECT available_count IS NULL AND open_status FROM search_nearby(16.4023, 120.5960, 20000) WHERE id = SR), 'search: Available, no number';

  -- Lowering spots below what is in use is refused
  ASSERT set_area_settings(main, 0, NULL, true)->>'error' = 'capacity_below_in_use', 'below in use';

  -- Deleting: refused with open sessions; ended sessions move to Main
  ASSERT delete_area(moto)->>'error' = 'area_has_sessions', 'open sessions block delete';
  tmp := (upsert_area(SR, 'QZ Tmp')->>'area_id')::uuid;
  PERFORM set_area_settings(tmp, 1, NULL, true);
  s2 := (start_walk_in(SR, 'car', 'QZ 7708', p_area_id => tmp)->>'session_id')::uuid;
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id = s2;
  ASSERT delete_area(tmp)->>'success' = 'true', 'delete area';
  ASSERT (SELECT area_id FROM parking_sessions WHERE id = s2) = main, 'history to Main';

  -- Staff can read areas; a new listing gets Main with its spots
  ASSERT (SELECT COUNT(*) FROM areas WHERE location_id = SR) = 2, 'areas listed';
  r := create_location('QZ Areas Test', 'Somewhere', 16.41, 120.59, 7, 30);
  newloc := (r->>'location_id')::uuid;
  ASSERT newloc IS NOT NULL, 'created listing: ' || r::text;
  ASSERT (SELECT capacity FROM areas WHERE location_id = newloc AND is_main) = 7, 'new Main 7';
  ASSERT location_free_spaces(newloc) = 7, 'new free 7';
  ASSERT update_location(newloc, p_capacity => 9)->>'success' = 'true', 'edit listing';
  ASSERT location_free_spaces(newloc) = 9, 'edit listing spots = Main';
END $$;
ROLLBACK;
