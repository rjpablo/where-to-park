-- staff_can_waive=false rejects staff waiver via end_session
BEGIN;
SELECT plan(2);

INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at, rate_snapshot)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  'NOWV',
  'car',
  'active',
  NOW() - INTERVAL '2 hours',
  '{"amount": 100, "rate_type": "hourly", "rate_name": "Valet Rate"}'::jsonb
);

INSERT INTO folios (id, operator_id, location_id, session_id, status)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000003',
  'eeeeeeee-0000-0000-0000-000000000001',
  'open'
);

INSERT INTO folio_charges (folio_id, type, description, amount)
VALUES ('eeeeeeee-0000-0000-0000-000000000002', 'parking_fee', 'Parking', 100.00);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL ROLE authenticated;

SELECT is(
  end_session(
    'eeeeeeee-0000-0000-0000-000000000001',
    20,
    'please waive'
  )->>'error',
  'waiver_not_allowed',
  'Staff waiver rejected when staff_can_waive=false'
);

RESET ROLE;

INSERT INTO parking_sessions (id, location_id, plate, vehicle_type, status, started_at, rate_snapshot)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000011',
  '30000000-0000-0000-0000-000000000002',
  'WAVE',
  'car',
  'active',
  NOW() - INTERVAL '1 hour',
  '{"amount": 50, "rate_type": "hourly", "rate_name": "Standard Rate"}'::jsonb
);

INSERT INTO folios (id, operator_id, location_id, session_id, status)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000012',
  '10000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  'eeeeeeee-0000-0000-0000-000000000011',
  'open'
);

INSERT INTO folio_charges (folio_id, type, description, amount)
VALUES ('eeeeeeee-0000-0000-0000-000000000012', 'parking_fee', 'Parking', 50.00);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL ROLE authenticated;

SELECT ok(
  (end_session(
    'eeeeeeee-0000-0000-0000-000000000011',
    20,
    'guest of the owner'
  )->>'success')::BOOLEAN,
  'Owner can waive remaining balance after partial cash'
);

SELECT * FROM finish();
ROLLBACK;
