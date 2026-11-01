-- search_nearby.starting_rate_info (migration 0061). Read-only checks; rolls back.
BEGIN;
DO $$
DECLARE r record; n int;
BEGIN
  -- Casa Vallejo (seed): only a flat-then-hourly default rate -> no starting_rate, info set
  SELECT * INTO r FROM search_nearby(16.4023, 120.5960, 5000, 'car')
   WHERE id = '30000000-0000-0000-0000-000000000003';
  ASSERT FOUND, 'Casa Vallejo in results';
  ASSERT r.starting_rate IS NULL, 'no hourly rate';
  ASSERT r.starting_rate_info->>'rate_type' = 'flat_then_hourly', 'info type: ' || COALESCE(r.starting_rate_info::text, 'null');
  ASSERT (r.starting_rate_info->>'first_hours')::int = 3
     AND (r.starting_rate_info->>'first_amount')::numeric = 100
     AND (r.starting_rate_info->>'succeeding_hourly_amount')::numeric = 40, 'info amounts';
  -- Listings with an hourly rate still report starting_rate as before
  SELECT COUNT(*) INTO n FROM search_nearby(16.4023, 120.5960, 5000, 'car') WHERE starting_rate IS NOT NULL;
  ASSERT n > 0, 'hourly starting rates still there';
  -- An inactive hourly rate is not used; an active one becomes the starting rate (as before)
  INSERT INTO rates (location_id, is_default, name, rate_type, hourly_amount, active)
  VALUES ('30000000-0000-0000-0000-000000000003', false, 'QA hourly', 'hourly', 30, false);
  SELECT * INTO r FROM search_nearby(16.4023, 120.5960, 5000, 'car')
   WHERE id = '30000000-0000-0000-0000-000000000003';
  ASSERT r.starting_rate IS NULL AND r.starting_rate_info->>'rate_type' = 'flat_then_hourly', 'inactive ignored';
  UPDATE rates SET active = true WHERE location_id = '30000000-0000-0000-0000-000000000003' AND name = 'QA hourly';
  SELECT * INTO r FROM search_nearby(16.4023, 120.5960, 5000, 'car')
   WHERE id = '30000000-0000-0000-0000-000000000003';
  ASSERT r.starting_rate = 30, 'hourly wins for the card';
  ASSERT has_function_privilege('anon', 'search_nearby(numeric, numeric, integer, vehicle_type, boolean, boolean, text, integer, rate_type)', 'EXECUTE'), 'anon can search';
END $$;
ROLLBACK;
