-- RLS and Business Logic Tests
BEGIN;
SELECT plan(20);

-- Setup test data
DO $$
DECLARE
  v_op1 UUID := 'ffff0000-0000-0000-0000-000000000001';
  v_op2 UUID := 'ffff0000-0000-0000-0000-000000000002';
  v_loc1 UUID := 'ffff0000-0000-0000-0000-000000000011';
  v_loc2 UUID := 'ffff0000-0000-0000-0000-000000000012';
  v_user1 UUID := 'ffff0000-0000-0000-0000-000000000021'; -- Operator 1
  v_user2 UUID := 'ffff0000-0000-0000-0000-000000000022'; -- Operator 2
  v_staff UUID := 'ffff0000-0000-0000-0000-000000000023'; -- Staff for Op1
  v_admin UUID := 'ffff0000-0000-0000-0000-000000000024'; -- Admin
  v_driver UUID := 'ffff0000-0000-0000-0000-000000000025'; -- Driver
BEGIN
  -- Create test users
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op1@test.com', 'x', NOW(), NOW(), NOW(), '{}', '{}'),
    (v_user2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'op2@test.com', 'x', NOW(), NOW(), NOW(), '{}', '{}'),
    (v_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff1@test.com', 'x', NOW(), NOW(), NOW(), '{}', '{}'),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin1@test.com', 'x', NOW(), NOW(), NOW(), '{}', '{}'),
    (v_driver, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'driver1@test.com', 'x', NOW(), NOW(), NOW(), '{}', '{}')
  ON CONFLICT DO NOTHING;

  INSERT INTO profiles (id, display_name, is_admin)
  VALUES
    (v_user1, 'Operator 1', false),
    (v_user2, 'Operator 2', false),
    (v_staff, 'Staff 1', false),
    (v_admin, 'Admin', true),
    (v_driver, 'Driver', false)
  ON CONFLICT DO NOTHING;

  -- Operators
  INSERT INTO operators (id, display_name, staff_can_waive)
  VALUES
    (v_op1, 'Operator 1', true),
    (v_op2, 'Operator 2', false)
  ON CONFLICT DO NOTHING;

  -- Locations
  INSERT INTO locations (id, operator_id, name, listing_type, geog, address, tracking_mode, capacity, available_count, published, verification_status)
  VALUES
    (v_loc1, v_op1, 'Location 1', 'commercial', ST_SetSRID(ST_MakePoint(120.596, 16.412), 4326)::GEOGRAPHY, 'Addr 1', 'count', 10, 10, true, 'verified'),
    (v_loc2, v_op2, 'Location 2', 'commercial', ST_SetSRID(ST_MakePoint(120.597, 16.413), 4326)::GEOGRAPHY, 'Addr 2', 'count', 10, 10, true, 'unverified')
  ON CONFLICT DO NOTHING;

  -- Staff member for operator 1
  INSERT INTO operator_members (operator_id, profile_id, role, location_ids)
  VALUES (v_op1, v_staff, 'staff', ARRAY[v_loc1])
  ON CONFLICT DO NOTHING;
END $$;

-- ====================
-- RLS TESTS
-- ====================

-- TEST 1-2: Anon can read published locations, Verified and Unverified
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  SET LOCAL "request.jwt.claims" TO '{}';
  
  SELECT COUNT(*) INTO v_count FROM locations WHERE verification_status = 'verified' AND published = true;
  PERFORM ok(v_count > 0, 'RLS: Anon can read verified locations');
  
  SELECT COUNT(*) INTO v_count FROM locations WHERE verification_status = 'unverified' AND published = true;
  PERFORM ok(v_count > 0, 'RLS: Anon can read published Unverified locations');
  
  RESET ROLE;
END $$;

-- TEST 3: Driver cannot read other operators' sessions
DO $$
DECLARE
  v_session_id UUID;
  v_folio_id UUID;
  v_count INTEGER;
  v_driver UUID := 'ffff0000-0000-0000-0000-000000000025';
  v_op1 UUID := 'ffff0000-0000-0000-0000-000000000001';
  v_loc1 UUID := 'ffff0000-0000-0000-0000-000000000011';
BEGIN
  -- Create a session as operator 1
  INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at)
  VALUES (gen_random_uuid(), v_loc1, 'TEST', 'car', 'active', NOW())
  RETURNING id INTO v_session_id;
  
  INSERT INTO folios (id, operator_id, location_id, session_id, status)
  VALUES (gen_random_uuid(), v_op1, v_loc1, v_session_id, 'open')
  RETURNING id INTO v_folio_id;
  
  -- Try to read as driver
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_driver)::text;
  
  SELECT COUNT(*) INTO v_count FROM folios WHERE id = v_folio_id;
  PERFORM is(v_count, 0, 'RLS: Driver cannot read folios');
  
  RESET ROLE;
END $$;

-- TEST 4: Operator cannot read another operator's sessions
DO $$
DECLARE
  v_session_id UUID;
  v_count INTEGER;
  v_op2 UUID := 'ffff0000-0000-0000-0000-000000000002';
  v_user2 UUID := 'ffff0000-0000-0000-0000-000000000022';
  v_loc1 UUID := 'ffff0000-0000-0000-0000-000000000011';
BEGIN
  INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at)
  VALUES (gen_random_uuid(), v_loc1, 'TEST2', 'car', 'active', NOW())
  RETURNING id INTO v_session_id;
  
  -- Try to read as operator 2 (different operator)
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_user2)::text;
  
  SELECT COUNT(*) INTO v_count FROM parking_sessions WHERE id = v_session_id;
  PERFORM is(v_count, 0, 'RLS: Operator 2 cannot read Operator 1 sessions');
  
  RESET ROLE;
END $$;

-- TEST 5: Staff can only work on assigned locations
DO $$
DECLARE
  v_session_id UUID;
  v_count INTEGER;
  v_staff UUID := 'ffff0000-0000-0000-0000-000000000023';
  v_loc2 UUID := 'ffff0000-0000-0000-0000-000000000012'; -- Not assigned
BEGIN
  INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at)
  VALUES (gen_random_uuid(), v_loc2, 'TEST3', 'car', 'active', NOW())
  RETURNING id INTO v_session_id;
  
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_staff)::text;
  
  SELECT COUNT(*) INTO v_count FROM parking_sessions WHERE id = v_session_id;
  PERFORM is(v_count, 0, 'RLS: Staff cannot access non-assigned location sessions');
  
  RESET ROLE;
END $$;

-- TEST 6-7: Only admins can verify locations and create admins
DO $$
DECLARE
  v_result JSONB;
  v_admin UUID := 'ffff0000-0000-0000-0000-000000000024';
  v_user1 UUID := 'ffff0000-0000-0000-0000-000000000021';
  v_loc2 UUID := 'ffff0000-0000-0000-0000-000000000012';
BEGIN
  -- Non-admin tries to verify
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_user1)::text;
  
  BEGIN
    v_result := verify_location(v_loc2);
    PERFORM fail('RLS: Non-admin should not be able to verify locations');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pass('RLS: Non-admin cannot verify locations');
  END;
  
  RESET ROLE;
  
  -- Admin can verify
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_admin)::text;
  
  v_result := verify_location(v_loc2);
  PERFORM ok((v_result->>'success')::BOOLEAN, 'RLS: Admin can verify locations');
  
  RESET ROLE;
END $$;

-- ====================
-- OVERDUE CALCULATION TESTS
-- ====================

-- TEST 8: Overdue minutes calculated but not billed until edited
DO $$
DECLARE
  v_session_id UUID;
  v_folio_id UUID;
  v_charges_sum NUMERIC;
  v_op1 UUID := 'ffff0000-0000-0000-0000-000000000001';
  v_loc1 UUID := 'ffff0000-0000-0000-0000-000000000011';
BEGIN
  -- Create overdue session (started 3 hours ago, expected to end 2 hours ago)
  INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at, scheduled_end_at)
  VALUES (gen_random_uuid(), v_loc1, 'OVERDUE', 'car', 'overdue', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour')
  RETURNING id INTO v_session_id;
  
  INSERT INTO folios (id, operator_id, location_id, session_id, status)
  VALUES (gen_random_uuid(), v_op1, v_loc1, v_session_id, 'open')
  RETURNING id INTO v_folio_id;
  
  -- Check no overdue charges yet
  SELECT COALESCE(SUM(amount), 0) INTO v_charges_sum
  FROM folio_charges
  WHERE folio_id = v_folio_id AND type = 'parking_fee';
  
  PERFORM is(v_charges_sum, 0.00, 'Overdue: No charges until session ended');
END $$;

-- ====================
-- STAFF WAIVER TESTS
-- ====================

-- TEST 9-10: Staff waiver rejected when staff_can_waive=false
DO $$
DECLARE
  v_session_id UUID;
  v_folio_id UUID;
  v_staff UUID := 'ffff0000-0000-0000-0000-000000000023';
  v_user2 UUID := 'ffff0000-0000-0000-0000-000000000022'; -- Operator 2 owner
  v_op2 UUID := 'ffff0000-0000-0000-0000-000000000002';
  v_loc2 UUID := 'ffff0000-0000-0000-0000-000000000012';
BEGIN
  -- Create session for operator 2 (staff_can_waive=false)
  INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at)
  VALUES (gen_random_uuid(), v_loc2, 'NOWV', 'car', 'active', NOW() - INTERVAL '2 hours')
  RETURNING id INTO v_session_id;
  
  INSERT INTO folios (id, operator_id, location_id, session_id, status)
  VALUES (gen_random_uuid(), v_op2, v_loc2, v_session_id, 'open')
  RETURNING id INTO v_folio_id;
  
  INSERT INTO folio_charges (folio_id, type, description, amount)
  VALUES (v_folio_id, 'parking_fee', 'Test', 100.00);
  
  -- Staff tries to waive (should fail)
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_staff)::text;
  
  BEGIN
    INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
    VALUES (v_folio_id, 'waiver', 'Waive', -100.00, 'Note', v_staff);
    PERFORM fail('Staff waiver should be rejected when staff_can_waive=false');
  EXCEPTION WHEN check_violation THEN
    PERFORM pass('Staff waiver rejected when staff_can_waive=false');
  END;
  
  RESET ROLE;
  
  -- Operator owner can waive
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO json_build_object('sub', v_user2)::text;
  
  BEGIN
    INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
    VALUES (v_folio_id, 'waiver', 'Owner waive', -50.00, 'Approved', v_user2);
    PERFORM pass('Operator owner can waive when staff_can_waive=false');
  EXCEPTION WHEN OTHERS THEN
    PERFORM fail('Operator owner waiver should succeed');
  END;
  
  RESET ROLE;
END $$;

-- Cleanup
DO $$
BEGIN
  DELETE FROM folio_charges WHERE folio_id IN (SELECT id FROM folios WHERE operator_id IN ('ffff0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000002'));
  DELETE FROM folios WHERE operator_id IN ('ffff0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000002');
  DELETE FROM parking_sessions WHERE location_id IN ('ffff0000-0000-0000-0000-000000000011', 'ffff0000-0000-0000-0000-000000000012');
  DELETE FROM operator_members WHERE operator_id IN ('ffff0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000002');
  DELETE FROM locations WHERE id IN ('ffff0000-0000-0000-0000-000000000011', 'ffff0000-0000-0000-0000-000000000012');
  DELETE FROM operators WHERE id IN ('ffff0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000002');
  DELETE FROM profiles WHERE id IN ('ffff0000-0000-0000-0000-000000000021', 'ffff0000-0000-0000-0000-000000000022', 'ffff0000-0000-0000-0000-000000000023', 'ffff0000-0000-0000-0000-000000000024', 'ffff0000-0000-0000-0000-000000000025');
  DELETE FROM auth.users WHERE id IN ('ffff0000-0000-0000-0000-000000000021', 'ffff0000-0000-0000-0000-000000000022', 'ffff0000-0000-0000-0000-000000000023', 'ffff0000-0000-0000-0000-000000000024', 'ffff0000-0000-0000-0000-000000000025');
END $$;

SELECT * FROM finish();
ROLLBACK;
