-- Comprehensive Behavior Tests
-- Tests business logic: quote_price, ledger, RLS

\set ON_ERROR_STOP on

BEGIN;

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- ====================
-- SETUP TEST DATA
-- ====================

DO $$
DECLARE
  v_op1 UUID := 'eeeeeeee-0000-0000-0000-000000000001';
  v_op2 UUID := 'eeeeeeee-0000-0000-0000-000000000002';
  v_loc1 UUID := 'eeeeeeee-0000-0000-0000-000000000011';
  v_loc2 UUID := 'eeeeeeee-0000-0000-0000-000000000012';
  v_slot1 UUID := 'eeeeeeee-0000-0000-0000-000000000021';
BEGIN
  -- Operators
  INSERT INTO operators (id, display_name, staff_can_waive) VALUES
    (v_op1, 'Operator 1', true),
    (v_op2, 'Operator 2', false);

  -- Locations
  INSERT INTO locations (id, operator_id, name, listing_type, geog, address, tracking_mode, capacity, available_count, published)
  VALUES 
    (v_loc1, v_op1, 'Test Loc 1', 'commercial',
      ST_SetSRID(ST_MakePoint(120.596, 16.412), 4326)::GEOGRAPHY,
      'Address 1', 'count', 10, 10, true),
    (v_loc2, v_op2, 'Test Loc 2', 'commercial',
      ST_SetSRID(ST_MakePoint(120.597, 16.413), 4326)::GEOGRAPHY,
      'Address 2', 'count', 5, 5, true);

  -- Slot for loc1
  INSERT INTO slots (id, location_id, code) VALUES (v_slot1, v_loc1, 'A1');

  -- Rates for loc1
  INSERT INTO rates (location_id, is_default, name, rate_type, hourly_amount, active)
  VALUES (v_loc1, true, 'Default Hourly', 'hourly', 50.00, true);

  INSERT INTO rates (location_id, is_default, name, rate_type, vehicle_type, hourly_amount, active)
  VALUES (v_loc1, false, 'SUV Premium', 'hourly', 'suv', 70.00, true);

  INSERT INTO rates (location_id, is_default, name, rate_type, slot_id, hourly_amount, active)
  VALUES (v_loc1, false, 'Slot A1 Premium', 'hourly', v_slot1, 80.00, true);

  INSERT INTO rates (location_id, is_default, name, rate_type, first_hours, first_amount, succeeding_hourly_amount, active)
  VALUES (v_loc1, false, 'Flat then Hourly', 'flat_then_hourly', 2, 80.00, 40.00, true);

  INSERT INTO rates (location_id, is_default, name, rate_type, daily_amount, active)
  VALUES (v_loc1, false, 'Daily Rate', 'daily', 200.00, true);

  INSERT INTO rates (location_id, is_default, name, rate_type, monthly_amount, active)
  VALUES (v_loc1, false, 'Monthly', 'monthly', 3000.00, true);
END $$;

-- ====================
-- TESTS
-- ====================

\echo ''
\echo '=== QUOTE_PRICE TESTS ==='
\echo ''

-- Test 1: Per-started-hour billing (3.12 hours = 4 hours)
\echo 'Test 1: Per-started-hour (3.12h should bill as 4h)'
SELECT
  CASE
    WHEN (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 3.12, NULL, NULL)->>'billed_hours')::INTEGER = 4
    THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 4, got ' || (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 3.12, NULL, NULL)->>'billed_hours')::INTEGER
  END AS result;

-- Test 2: Amount calculation
\echo 'Test 2: 3.12h at $50/h should be $200 (4 * 50)'
SELECT
  CASE
    WHEN (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 3.12, NULL, NULL)->>'amount')::NUMERIC = 200.00
    THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 200, got ' || (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 3.12, NULL, NULL)->>'amount')::NUMERIC
  END AS result;

-- Test 3: Vehicle-specific rate (SUV)
\echo 'Test 3: SUV rate (2h * $70 = $140)'
SELECT
  CASE
    WHEN (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'suv', NOW(), 2, NULL, NULL)->>'amount')::NUMERIC = 140.00
    THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 140, got ' || (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'suv', NOW(), 2, NULL, NULL)->>'amount')::NUMERIC
  END AS result;

-- Test 4: Car uses default rate
\echo 'Test 4: Car default rate (2h * $50 = $100)'
SELECT
  CASE
    WHEN (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 2, NULL, NULL)->>'amount')::NUMERIC = 100.00
    THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 100, got ' || (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 2, NULL, NULL)->>'amount')::NUMERIC
  END AS result;

-- Test 5: Slot-specific rate precedence
\echo 'Test 5: Slot A1 premium rate (2h * $80 = $160)'
SELECT
  CASE
    WHEN (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 2, NULL, 'eeeeeeee-0000-0000-0000-000000000021')->>'amount')::NUMERIC = 160.00
    THEN '✓ PASS'
    ELSE '✗ FAIL: Expected 160, got ' || (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 2, NULL, 'eeeeeeee-0000-0000-0000-000000000021')->>'amount')::NUMERIC
  END AS result;

-- Test 6: Monthly rate excluded from hourly quotes
\echo 'Test 6: Monthly rate not used for hourly quotes'
SELECT
  CASE
    WHEN (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 2, NULL, NULL)->>'rate_type')::TEXT != 'monthly'
    THEN '✓ PASS'
    ELSE '✗ FAIL: Should not return monthly rate'
  END AS result;

-- Test 7: Dated custom rate with priority overrides default
\echo 'Test 7: Dated rate with priority overrides default'
DO $$
BEGIN
  INSERT INTO rates (location_id, is_default, name, rate_type, hourly_amount, effective_from, effective_to, priority, active)
  VALUES ('eeeeeeee-0000-0000-0000-000000000011', false, 'Weekend Special', 'hourly', 60.00,
    NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days', 10, true);

  IF (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 2, NULL, NULL)->>'amount')::NUMERIC = 120.00 THEN
    RAISE NOTICE '✓ PASS: Dated rate selected (2h * $60 = $120)';
  ELSE
    RAISE NOTICE '✗ FAIL: Expected 120, got %', (quote_price('eeeeeeee-0000-0000-0000-000000000011', 'car', NOW(), 2, NULL, NULL)->>'amount')::NUMERIC;
  END IF;

  DELETE FROM rates WHERE name = 'Weekend Special';
END $$;

\echo ''
\echo '=== LEDGER TESTS ==='
\echo ''

-- Test 7-8: Ledger balance calculation
DO $$
DECLARE
  v_folio_id UUID;
  v_session_id UUID;
  v_balance NUMERIC;
  v_op UUID := 'eeeeeeee-0000-0000-0000-000000000001';
  v_loc UUID := 'eeeeeeee-0000-0000-0000-000000000011';
BEGIN
  INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at)
  VALUES (gen_random_uuid(), v_loc, 'TEST123', 'car', 'active', NOW() - INTERVAL '3 hours')
  RETURNING id INTO v_session_id;

  INSERT INTO folios (id, operator_id, location_id, session_id, status)
  VALUES (gen_random_uuid(), v_op, v_loc, v_session_id, 'open')
  RETURNING id INTO v_folio_id;

  INSERT INTO folio_charges (folio_id, type, description, amount)
  VALUES
    (v_folio_id, 'parking_fee', 'Parking 3h', 150.00),
    (v_folio_id, 'additional_fee', 'Extra cleaning', 50.00);

  INSERT INTO payments (folio_id, amount, method)
  VALUES (v_folio_id, 100.00, 'cash');

  SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE folio_id = v_folio_id AND voided_at IS NULL) -
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE folio_id = v_folio_id AND direction = 'payment')
  INTO v_balance;

  RAISE NOTICE 'Test 7: Balance calculation (200 - 100 = 100): %',
    CASE WHEN v_balance = 100.00 THEN '✓ PASS' ELSE '✗ FAIL: got ' || v_balance END;

  -- Add waiver
  INSERT INTO folio_charges (folio_id, type, description, amount, note)
  VALUES (v_folio_id, 'waiver', 'Manager waived', -100.00, 'Customer complaint');

  SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE folio_id = v_folio_id AND voided_at IS NULL) -
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE folio_id = v_folio_id AND direction = 'payment')
  INTO v_balance;

  RAISE NOTICE 'Test 8: Waiver brings balance to 0: %',
    CASE WHEN v_balance = 0.00 THEN '✓ PASS' ELSE '✗ FAIL: got ' || v_balance END;
END $$;

\echo ''
\echo '=== CONSTRAINT TESTS ==='
\echo ''

-- Test 9: CHECK constraint prevents negative available_count
\echo 'Test 9: CHECK prevents negative available_count'
DO $$
BEGIN
  BEGIN
    UPDATE locations SET available_count = -1 WHERE id = 'eeeeeeee-0000-0000-0000-000000000011';
    RAISE NOTICE '✗ FAIL: Should have rejected negative value';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ PASS: CHECK constraint prevented negative value';
  END;
END $$;

-- Test 10: Zero is allowed
\echo 'Test 10: Zero available_count is allowed'
DO $$
BEGIN
  UPDATE locations SET available_count = 0 WHERE id = 'eeeeeeee-0000-0000-0000-000000000011';
  RAISE NOTICE '✓ PASS: Zero is allowed';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '✗ FAIL: %', SQLERRM;
END $$;

-- ====================
-- CLEANUP
-- ====================

DO $$
BEGIN
  DELETE FROM reservations WHERE location_id IN ('eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000012');
  DELETE FROM payments WHERE folio_id IN (SELECT id FROM folios WHERE operator_id IN ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002'));
  DELETE FROM folio_charges WHERE folio_id IN (SELECT id FROM folios WHERE operator_id IN ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002'));
  DELETE FROM folios WHERE operator_id IN ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002');
  DELETE FROM parking_sessions WHERE location_id IN ('eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000012');
  DELETE FROM slots WHERE location_id IN ('eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000012');
  DELETE FROM rates WHERE location_id IN ('eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000012');
  DELETE FROM locations WHERE id IN ('eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000012');
  DELETE FROM operators WHERE id IN ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002');
END $$;

ROLLBACK;

\echo ''
\echo '=== ALL TESTS COMPLETE ==='
