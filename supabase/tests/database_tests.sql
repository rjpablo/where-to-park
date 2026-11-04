-- pgTAP tests. Use top-level SELECT (not PERFORM inside DO) so TAP is emitted.
BEGIN;
SELECT plan(23);

SELECT has_extension('uuid-ossp', 'uuid-ossp extension should be installed');
SELECT has_extension('postgis', 'postgis extension should be installed');

SELECT has_table('profiles');
SELECT has_table('operators');
SELECT has_table('locations');
SELECT has_table('parking_sessions');
SELECT has_table('folios');
SELECT has_table('folio_charges');
SELECT has_table('payments');
SELECT has_table('operator_members');

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'profiles' AND relnamespace = 'public'::regnamespace),
  true,
  'RLS enabled on profiles'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'locations' AND relnamespace = 'public'::regnamespace),
  true,
  'RLS enabled on locations'
);

SELECT has_function('quote_price');
SELECT has_function('claim_capacity');
SELECT has_function('search_nearby');
SELECT has_function('is_operator_admin');

-- Hourly: SM default 40/h * 3h = 120
SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000001', 'car', NOW(), 3)->>'amount')::NUMERIC,
  120.00,
  'Hourly rate: 3 hours is 120 (40 * 3)'
);

INSERT INTO folios (id, operator_id, location_id, status)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'open'
);
INSERT INTO folio_charges (folio_id, type, description, amount)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'parking_fee', 'Parking', 200.00),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'waiver', 'Waived', -100.00);
INSERT INTO payments (folio_id, amount, method)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 100.00, 'cash');

SELECT is(
  (
    SELECT COALESCE(SUM(amount), 0) FROM folio_charges WHERE folio_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  ) - (
    SELECT COALESCE(SUM(amount), 0) FROM payments WHERE folio_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  ),
  0.00,
  'Folio balance after payment and waiver is 0'
);

-- Overdue minutes are stored on the session and not auto-billed
INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at, scheduled_end_at, overdue_minutes)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'OVR1',
  'car',
  'overdue',
  NOW() - INTERVAL '3 hours',
  NOW() - INTERVAL '1 hour',
  60
);

SELECT is(
  (SELECT overdue_minutes FROM parking_sessions WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  60,
  'Overdue minutes recorded on the session'
);

SELECT is(
  (
    SELECT COALESCE(SUM(amount), 0)
    FROM folio_charges
    WHERE folio_id IN (
      SELECT id FROM folios WHERE session_id = 'dddddddd-0000-0000-0000-000000000001'
    )
  ),
  0.00,
  'Overdue does not auto-insert a parking_fee charge'
);

-- search_nearby returns Baguio seed rows
SELECT cmp_ok(
  (SELECT COUNT(*) FROM search_nearby(16.4023, 120.5960, 5000, 'car')),
  '>=',
  4::bigint,
  'search_nearby returns at least 4 Baguio locations'
);

SELECT ok(
  EXISTS (SELECT 1 FROM locations WHERE name = 'Burnham Park Street Parking' AND verification_status = 'unverified'),
  'Burnham Park is seeded unverified'
);

SELECT ok(
  EXISTS (SELECT 1 FROM locations WHERE name = 'Pine Ridge Driveway' AND verification_status = 'verified'),
  'Pine Ridge Driveway is seeded verified'
);

SELECT * FROM finish();
ROLLBACK;
