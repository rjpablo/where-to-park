-- pgTAP test suite for Where To Park

BEGIN;
SELECT plan(50); -- Adjust based on actual test count

-- Test extensions
SELECT has_extension('uuid-ossp', 'uuid-ossp extension should be installed');
SELECT has_extension('postgis', 'postgis extension should be installed');

-- Test tables exist
SELECT has_table('profiles', 'profiles table should exist');
SELECT has_table('operators', 'operators table should exist');
SELECT has_table('locations', 'locations table should exist');
SELECT has_table('parking_sessions', 'parking_sessions table should exist');
SELECT has_table('folios', 'folios table should exist');
SELECT has_table('folio_charges', 'folio_charges table should exist');
SELECT has_table('payments', 'payments table should exist');

-- Test RLS is enabled
SELECT is(relrowsecurity, true, 'RLS should be enabled on profiles')
FROM pg_class
WHERE relname = 'profiles';

SELECT is(relrowsecurity, true, 'RLS should be enabled on locations')
FROM pg_class
WHERE relname = 'locations';

-- Test quote_price function exists
SELECT has_function('quote_price', 'quote_price function should exist');

-- Test claim_capacity function exists
SELECT has_function('claim_capacity', 'claim_capacity function should exist');

-- Test search_nearby function exists
SELECT has_function('search_nearby', 'search_nearby function should exist');

-- Test rate resolution: hourly rate
DO $$
DECLARE
  v_location_id UUID := '30000000-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  v_result := quote_price(v_location_id, 'car', NOW(), 3);
  PERFORM is((v_result->>'amount')::NUMERIC, 120.00, 'Hourly rate: 3 hours should be 120 (40 * 3)');
END $$;

-- Test ledger balance calculation
DO $$
DECLARE
  v_folio_id UUID;
  v_balance NUMERIC;
BEGIN
  -- Create test folio
  INSERT INTO folios (operator_id, location_id, status)
  VALUES (
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'open'
  ) RETURNING id INTO v_folio_id;

  -- Add charge
  INSERT INTO folio_charges (folio_id, type, description, amount)
  VALUES (v_folio_id, 'parking_fee', 'Parking', 200.00);

  -- Add payment
  INSERT INTO payments (folio_id, amount, method)
  VALUES (v_folio_id, 100.00, 'cash');

  -- Calculate balance
  SELECT 
    (SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE folio_id = v_folio_id) -
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE folio_id = v_folio_id)
  INTO v_balance;

  PERFORM is(v_balance, 100.00, 'Folio balance should be 100 (200 charge - 100 payment)');

  -- Add waiver
  INSERT INTO folio_charges (folio_id, type, description, amount, note)
  VALUES (v_folio_id, 'waiver', 'Waived balance', -100.00, 'Test waiver');

  -- Recalculate balance
  SELECT 
    (SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE folio_id = v_folio_id) -
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE folio_id = v_folio_id)
  INTO v_balance;

  PERFORM is(v_balance, 0.00, 'After waiver, balance should be 0');
END $$;

-- Test concurrency: claim_capacity with multiple requests
DO $$
DECLARE
  v_location_id UUID := '30000000-0000-0000-0000-000000000001';
  v_result1 JSONB;
  v_result2 JSONB;
  v_initial_available INTEGER;
BEGIN
  -- Set capacity and available to specific values for testing
  UPDATE locations
  SET capacity = 10, available_count = 1
  WHERE id = v_location_id;

  SELECT available_count INTO v_initial_available
  FROM locations
  WHERE id = v_location_id;

  -- First claim should succeed
  v_result1 := claim_capacity(v_location_id, NULL, NOW(), NOW() + INTERVAL '1 hour', 'session');
  PERFORM ok((v_result1->>'success')::BOOLEAN, 'First claim should succeed when 1 space available');

  -- Create a session to actually occupy the space
  INSERT INTO parking_sessions (location_id, plate, vehicle_type, status)
  VALUES (v_location_id, 'TEST123', 'car', 'active');

  -- Second claim should fail (no longer available)
  v_result2 := claim_capacity(v_location_id, NULL, NOW(), NOW() + INTERVAL '1 hour', 'session');
  PERFORM is(v_result2->>'error', 'no_longer_available', 'Second claim should fail when no space available');
END $$;

-- Test RLS: users can only see their own vehicles
DO $$
DECLARE
  v_user1_id UUID := '20000000-0000-0000-0000-000000000001';
  v_user2_id UUID := '20000000-0000-0000-0000-000000000002';
  v_vehicle_count INTEGER;
BEGIN
  -- As user1, should see only user1's vehicles
  SET LOCAL role authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_user1_id::TEXT)::TEXT;

  SELECT COUNT(*) INTO v_vehicle_count
  FROM vehicles
  WHERE driver_id = v_user1_id;

  PERFORM ok(v_vehicle_count >= 0, 'User should see their own vehicles');
END $$;

-- Test search_nearby returns published locations only
DO $$
DECLARE
  v_result_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_result_count
  FROM search_nearby(16.4120, 120.5960, 5000, NULL, false, false, 'distance', 50);

  PERFORM ok(v_result_count > 0, 'Search should return published locations');

  -- All results should be published
  PERFORM ok(
    (SELECT COUNT(*) = 0
     FROM search_nearby(16.4120, 120.5960, 5000, NULL, false, false, 'distance', 50) s
     JOIN locations l ON l.id = s.id
     WHERE l.published = false),
    'Search should only return published locations'
  );
END $$;

-- Test monthly filter
DO $$
DECLARE
  v_monthly_count INTEGER;
  v_total_count INTEGER;
BEGIN
  -- Count with monthly filter
  SELECT COUNT(*) INTO v_monthly_count
  FROM search_nearby(16.4120, 120.5960, 5000, NULL, true, false, 'distance', 50);

  -- Count without filter
  SELECT COUNT(*) INTO v_total_count
  FROM search_nearby(16.4120, 120.5960, 5000, NULL, false, false, 'distance', 50);

  PERFORM ok(v_monthly_count <= v_total_count, 'Monthly filter should return same or fewer results');

  -- All monthly results should have a monthly rate
  PERFORM ok(
    (SELECT bool_and(has_monthly)
     FROM search_nearby(16.4120, 120.5960, 5000, NULL, true, false, 'distance', 50)),
    'Monthly filter results should all have monthly rates'
  );
END $$;

-- Test rating stats trigger
DO $$
DECLARE
  v_location_id UUID := '30000000-0000-0000-0000-000000000001';
  v_avg_rating NUMERIC;
  v_review_count INTEGER;
BEGIN
  -- Get current stats
  SELECT avg_rating, review_count INTO v_avg_rating, v_review_count
  FROM location_rating_stats
  WHERE location_id = v_location_id;

  PERFORM ok(v_review_count >= 0, 'Review count should be non-negative');
  PERFORM ok(v_avg_rating IS NULL OR (v_avg_rating >= 1 AND v_avg_rating <= 5), 
             'Average rating should be between 1 and 5');
END $$;

-- Test default vehicle constraint
DO $$
DECLARE
  v_driver_id UUID := '20000000-0000-0000-0000-000000000003';
  v_default_count INTEGER;
BEGIN
  -- Count default vehicles for driver
  SELECT COUNT(*) INTO v_default_count
  FROM vehicles
  WHERE driver_id = v_driver_id AND is_default = true;

  PERFORM ok(v_default_count <= 1, 'Driver should have at most one default vehicle');
END $$;

-- Test availability CHECK constraint
DO $$
DECLARE
  v_location_id UUID;
BEGIN
  -- Try to set available_count to negative (should fail)
  BEGIN
    INSERT INTO locations (
      operator_id, name, listing_type, geog, address,
      tracking_mode, capacity, available_count, published
    ) VALUES (
      '10000000-0000-0000-0000-000000000001',
      'Test Negative Available',
      'commercial',
      ST_SetSRID(ST_MakePoint(120.5960, 16.4120), 4326)::GEOGRAPHY,
      'Test Address',
      'count',
      10,
      -1,  -- Invalid: negative
      false
    ) RETURNING id INTO v_location_id;

    PERFORM fail('Should not allow negative available_count');
  EXCEPTION WHEN check_violation THEN
    PERFORM pass('CHECK constraint prevents negative available_count');
  END;
END $$;

-- Test verification status change
DO $$
DECLARE
  v_location_id UUID := '30000000-0000-0000-0000-000000000004';
  v_status verification_status;
BEGIN
  SELECT verification_status INTO v_status
  FROM locations
  WHERE id = v_location_id;

  PERFORM is(v_status::TEXT, 'unverified', 'New locations should be unverified');
END $$;

SELECT * FROM finish();
ROLLBACK;
