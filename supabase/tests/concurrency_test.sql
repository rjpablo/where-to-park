-- Concurrency test for last-space protection
-- This test simulates multiple parallel requests for the last available space

BEGIN;
SELECT plan(10);

-- Setup: Create test location with exactly 1 space available
DO $$
DECLARE
  v_test_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_test_operator_id UUID := 'cccccccc-0000-0000-0000-000000000002';
BEGIN
  -- Create test operator
  INSERT INTO operators (id, display_name, status)
  VALUES (v_test_operator_id, 'Concurrency Test Operator', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Create test location with 1 space
  INSERT INTO locations (
    id, operator_id, name, listing_type, geog, address,
    tracking_mode, capacity, available_count, published
  ) VALUES (
    v_test_location_id,
    v_test_operator_id,
    'Concurrency Test Location',
    'commercial',
    ST_SetSRID(ST_MakePoint(120.5960, 16.4120), 4326)::GEOGRAPHY,
    'Test Address',
    'count',
    10,
    1,  -- Only 1 space available
    true
  ) ON CONFLICT (id) DO UPDATE
  SET available_count = 1, capacity = 10;
END $$;

-- Test 1: First claim should succeed
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  v_result := claim_capacity(v_location_id, NULL, NOW(), NOW() + INTERVAL '1 hour', 'reservation');
  PERFORM ok((v_result->>'success')::BOOLEAN, 'First claim for last space should succeed');
  PERFORM is((v_result->>'available')::INTEGER, 1, 'Should show 1 space available before claim');
END $$;

-- Test 2: Create first reservation to occupy the space
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_reservation_id UUID;
BEGIN
  INSERT INTO reservations (
    location_id, start_at, end_at, status, quote_amount, fee_due_amount
  ) VALUES (
    v_location_id,
    NOW() + INTERVAL '1 hour',
    NOW() + INTERVAL '3 hours',
    'confirmed',
    100.00,
    20.00
  ) RETURNING id INTO v_reservation_id;

  PERFORM ok(v_reservation_id IS NOT NULL, 'First reservation created successfully');
END $$;

-- Test 3: Second claim should fail (no longer available)
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  v_result := claim_capacity(v_location_id, NULL, NOW() + INTERVAL '1.5 hours', NOW() + INTERVAL '3 hours', 'reservation');
  PERFORM is(v_result->>'error', 'no_longer_available', 'Second overlapping claim should fail');
END $$;

-- Test 4: Walk-in vs reservation race
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  -- Reset: delete reservations and set available to 1
  DELETE FROM reservations WHERE location_id = v_location_id;
  UPDATE locations SET available_count = 1 WHERE id = v_location_id;

  -- Try walk-in claim
  v_result := claim_capacity(v_location_id, NULL, NOW(), NULL, 'session');
  PERFORM ok((v_result->>'success')::BOOLEAN, 'Walk-in claim should succeed when space available');
  
  -- Create session
  INSERT INTO parking_sessions (location_id, plate, vehicle_type, status)
  VALUES (v_location_id, 'RACE001', 'car', 'active');

  -- Try reservation - should fail
  v_result := claim_capacity(v_location_id, NULL, NOW(), NOW() + INTERVAL '1 hour', 'reservation');
  PERFORM is(v_result->>'error', 'no_longer_available', 'Reservation should fail after walk-in took the space');
END $$;

-- Test 5: Manual unavailable reduces capacity
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  -- Reset
  DELETE FROM parking_sessions WHERE location_id = v_location_id;
  UPDATE locations SET available_count = 1, unavailable_count = 0 WHERE id = v_location_id;

  -- Mark 1 as unavailable
  UPDATE locations SET unavailable_count = 1 WHERE id = v_location_id;

  -- Try to claim - should fail
  v_result := claim_capacity(v_location_id, NULL, NOW(), NOW() + INTERVAL '1 hour', 'session');
  PERFORM is(v_result->>'error', 'no_longer_available', 'Claim should fail when space is marked unavailable');
END $$;

-- Test 6: CHECK constraint prevents negative available
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
BEGIN
  BEGIN
    UPDATE locations
    SET available_count = -1
    WHERE id = v_location_id;
    
    PERFORM fail('Should not allow negative available_count');
  EXCEPTION WHEN check_violation THEN
    PERFORM pass('CHECK constraint prevents negative available_count');
  END;
END $$;

-- Test 7: Non-overlapping reservations don't conflict
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  -- Reset
  DELETE FROM reservations WHERE location_id = v_location_id;
  UPDATE locations SET available_count = 1, unavailable_count = 0 WHERE id = v_location_id;

  -- Create reservation for later
  INSERT INTO reservations (
    location_id, start_at, end_at, status, quote_amount, fee_due_amount
  ) VALUES (
    v_location_id,
    NOW() + INTERVAL '10 hours',
    NOW() + INTERVAL '12 hours',
    'confirmed',
    100.00,
    0
  );

  -- Try claim for now - should succeed (not overlapping)
  v_result := claim_capacity(v_location_id, NULL, NOW(), NOW() + INTERVAL '1 hour', 'session');
  PERFORM ok((v_result->>'success')::BOOLEAN, 'Non-overlapping claim should succeed');
END $$;

-- Test 8: Expired holds don't block capacity
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  -- Reset
  DELETE FROM reservations WHERE location_id = v_location_id;
  DELETE FROM parking_sessions WHERE location_id = v_location_id;
  UPDATE locations SET available_count = 1 WHERE id = v_location_id;

  -- Create expired reservation
  INSERT INTO reservations (
    location_id, start_at, end_at, status, quote_amount, fee_due_amount
  ) VALUES (
    v_location_id,
    NOW() + INTERVAL '1 hour',
    NOW() + INTERVAL '3 hours',
    'expired',  -- Expired status
    100.00,
    0
  );

  -- Try claim - should succeed (expired doesn't block)
  v_result := claim_capacity(v_location_id, NULL, NOW() + INTERVAL '1.5 hours', NOW() + INTERVAL '2 hours', 'session');
  PERFORM ok((v_result->>'success')::BOOLEAN, 'Expired reservation should not block capacity');
END $$;

-- Test 9: Multiple non-overlapping can coexist up to capacity
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result JSONB;
BEGIN
  -- Reset with capacity 3
  DELETE FROM reservations WHERE location_id = v_location_id;
  DELETE FROM parking_sessions WHERE location_id = v_location_id;
  UPDATE locations SET available_count = 3, capacity = 3 WHERE id = v_location_id;

  -- Create 3 reservations for different time slots
  INSERT INTO reservations (location_id, start_at, end_at, status, quote_amount, fee_due_amount)
  VALUES 
    (v_location_id, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'confirmed', 50, 0),
    (v_location_id, NOW() + INTERVAL '3 hours', NOW() + INTERVAL '4 hours', 'confirmed', 50, 0),
    (v_location_id, NOW() + INTERVAL '5 hours', NOW() + INTERVAL '6 hours', 'confirmed', 50, 0);

  -- All should succeed since they don't overlap
  -- Try another non-overlapping one
  v_result := claim_capacity(v_location_id, NULL, NOW() + INTERVAL '7 hours', NOW() + INTERVAL '8 hours', 'reservation');
  PERFORM ok((v_result->>'success')::BOOLEAN, 'Multiple non-overlapping reservations should succeed');
END $$;

-- Test 10: Simulation of parallel requests (sequential execution due to lock)
DO $$
DECLARE
  v_location_id UUID := 'cccccccc-0000-0000-0000-000000000001';
  v_result1 JSONB;
  v_result2 JSONB;
  v_result3 JSONB;
BEGIN
  -- Reset with exactly 1 space
  DELETE FROM reservations WHERE location_id = v_location_id;
  DELETE FROM parking_sessions WHERE location_id = v_location_id;
  UPDATE locations SET available_count = 1, capacity = 1 WHERE id = v_location_id;

  -- Simulate 3 requests for the same time slot
  -- Only the first should succeed (they execute sequentially due to FOR UPDATE lock)
  
  v_result1 := claim_capacity(v_location_id, NULL, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'reservation');
  
  -- If first succeeded, create the reservation
  IF (v_result1->>'success')::BOOLEAN THEN
    INSERT INTO reservations (location_id, start_at, end_at, status, quote_amount, fee_due_amount)
    VALUES (v_location_id, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'confirmed', 50, 0);
  END IF;

  -- Second and third should fail
  v_result2 := claim_capacity(v_location_id, NULL, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'reservation');
  v_result3 := claim_capacity(v_location_id, NULL, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'reservation');

  PERFORM ok(
    (v_result1->>'success')::BOOLEAN = true AND
    (v_result2->>'error') = 'no_longer_available' AND
    (v_result3->>'error') = 'no_longer_available',
    'Only first of 3 parallel requests for last space should succeed'
  );
END $$;

-- Cleanup
DO $$
BEGIN
  DELETE FROM reservations WHERE location_id = 'cccccccc-0000-0000-0000-000000000001';
  DELETE FROM parking_sessions WHERE location_id = 'cccccccc-0000-0000-0000-000000000001';
  DELETE FROM locations WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  DELETE FROM operators WHERE id = 'cccccccc-0000-0000-0000-000000000002';
END $$;

SELECT * FROM finish();
ROLLBACK;
