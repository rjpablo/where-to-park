-- Full switch (migration 0066; per area since 0067: here on Main, the only area). Rolls back.
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
  outsider uuid;
  r jsonb; counted int;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM locations WHERE tracking_mode = 'open_full'), 'no Open/Full listings left';
  SELECT p.id INTO outsider FROM profiles p WHERE NOT can_work_location(SR, p.id) AND NOT is_admin(p.id) LIMIT 1;
  counted := location_counted_spaces(SR);
  ASSERT counted > 0 AND location_free_spaces(SR) = counted, 'not full: free = counted';

  -- Anonymous and outsiders refused
  PERFORM pg_temp.act_id(NULL);
  ASSERT set_area_full(main_area_id(SR), true)->>'error' = 'not_authenticated', 'anon refused';
  ASSERT NOT has_function_privilege('anon', 'set_area_full(uuid, boolean)', 'EXECUTE'), 'anon no grant';
  IF outsider IS NOT NULL THEN
    PERFORM pg_temp.act_id(outsider);
    ASSERT set_area_full(main_area_id(SR), true)->>'error' = 'Permission denied', 'outsider refused';
  END IF;
  ASSERT NOT (SELECT marked_full FROM areas WHERE id = main_area_id(SR)), 'still not full';

  -- Staff (Ana) marks it Full: free 0 everywhere, counted unchanged, logged
  PERFORM pg_temp.act('+639170000003');
  r := set_area_full(main_area_id(SR), true);
  ASSERT r->>'success' = 'true' AND (r->>'free_spaces')::int = 0 AND (r->>'counted_spaces')::int = counted, 'full: ' || r::text;
  ASSERT location_free_spaces(SR) = 0, 'free 0';
  ASSERT (SELECT free_spaces(l) FROM locations l WHERE l.id = SR) = 0, 'computed field 0';
  ASSERT (SELECT counted_spaces(l) FROM locations l WHERE l.id = SR) = counted, 'counted field';
  ASSERT (SELECT s.available_count FROM search_nearby(16.4023, 120.5960, 20000) s WHERE s.id = SR) = 0, 'search 0';
  ASSERT NOT EXISTS (SELECT 1 FROM search_nearby(16.4023, 120.5960, 20000, NULL, false, true) s WHERE s.id = SR), 'hide full hides it';
  ASSERT (SELECT available_count FROM locations WHERE id = SR) = 0, 'cache 0';
  ASSERT EXISTS (SELECT 1 FROM availability_events WHERE location_id = SR AND change = 'marked_full' AND actor = auth.uid()), 'logged';

  -- Walk-in still allowed while Full (manual override); says so
  r := start_walk_in(SR, 'car', 'QZ 6601');
  ASSERT r->>'success' = 'true', 'walk-in while full: ' || r::text;
  ASSERT location_counted_spaces(SR) = counted - 1 AND location_free_spaces(SR) = 0, 'counted drops, free stays 0';

  -- Owner (Juan) turns it off: back to the count
  PERFORM pg_temp.act('+639170000002');
  r := set_area_full(main_area_id(SR), false);
  ASSERT r->>'success' = 'true' AND location_free_spaces(SR) = counted - 1, 'unfull: ' || r::text;
  ASSERT EXISTS (SELECT 1 FROM availability_events WHERE location_id = SR AND change = 'unmarked_full'), 'logged off';

  -- Open/Full can't be chosen any more
  ASSERT set_tracking_mode(SR, 'open_full')->>'error' = 'mode_removed', 'open_full removed';
  ASSERT to_regprocedure('public.set_open_status(uuid, boolean)') IS NULL, 'set_open_status dropped';
END $$;
ROLLBACK;
