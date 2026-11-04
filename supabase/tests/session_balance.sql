BEGIN;
SELECT plan(4);

-- Walk-in 1h at Session Road ₱50 plus Lost Ticket ₱150, ₱20 cash → waiver ₱180.
INSERT INTO parking_sessions (
  id, location_id, plate, vehicle_type, status, started_at, rate_snapshot
) VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  'WVE 180',
  'car',
  'active',
  NOW() - INTERVAL '1 hour',
  '{"amount": 50, "rate_type": "hourly", "rate_name": "Standard Rate"}'::jsonb
);

INSERT INTO folios (id, operator_id, location_id, session_id, status)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'open'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (apply_fee_preset(
    'bbbbbbbb-0000-0000-0000-000000000001',
    (SELECT id FROM fee_presets
      WHERE operator_id = '10000000-0000-0000-0000-000000000002'
        AND name = 'Lost Ticket' LIMIT 1)
  )->>'amount')::NUMERIC,
  150.00,
  'Lost Ticket posts ₱150 extra fee'
);

SELECT is(
  (session_balance_preview('bbbbbbbb-0000-0000-0000-000000000001')->>'live_balance')::NUMERIC,
  200.00,
  'Live balance is ₱50 parking so far plus ₱150 extra fee'
);

SELECT is(
  (end_session('bbbbbbbb-0000-0000-0000-000000000001', 20, 'partial cash demo')->>'success')::BOOLEAN,
  true,
  'Close with ₱20 cash and a waiver note succeeds'
);

RESET ROLE;

SELECT is(
  (SELECT amount FROM folio_charges
    WHERE folio_id = 'bbbbbbbb-0000-0000-0000-000000000002'
      AND type = 'waiver'),
  -180.00,
  '1h ₱50 plus ₱150 Lost Ticket minus ₱20 cash waives ₱180'
);

SELECT * FROM finish();
ROLLBACK;
