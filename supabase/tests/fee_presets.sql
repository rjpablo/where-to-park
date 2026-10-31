BEGIN;
SELECT plan(9);

-- Seeded Session Road Lost Ticket is ₱150 — that is a fee preset, not the hourly rate.
SELECT is(
  (SELECT amount FROM fee_presets
    WHERE operator_id = '10000000-0000-0000-0000-000000000002'
      AND name = 'Lost Ticket'),
  150.00,
  'Session Road Lost Ticket preset is ₱150'
);

SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000002', 'car', NOW(), 1)->>'amount')::NUMERIC,
  50.00,
  'Session Road 1h parking quote remains ₱50, not the ₱150 preset'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (upsert_fee_preset(
    '10000000-0000-0000-0000-000000000002',
    'Overnight parking',
    200.00,
    NULL,
    '30000000-0000-0000-0000-000000000002'
  )->>'success')::BOOLEAN,
  true,
  'Juan can create a fee preset'
);

CREATE TEMP TABLE applied_fee (payload JSONB);
GRANT ALL ON applied_fee TO PUBLIC;
INSERT INTO applied_fee
SELECT apply_fee_preset(
  (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' ORDER BY created_at DESC LIMIT 1),
  (SELECT id FROM fee_presets
    WHERE operator_id = '10000000-0000-0000-0000-000000000002'
      AND name = 'Lost Ticket'
    LIMIT 1)
);

SELECT is(
  (SELECT (payload->>'amount')::NUMERIC FROM applied_fee),
  150.00,
  'Applying Lost Ticket posts ₱150 additional_fee on the session ledger'
);

RESET ROLE;

SELECT is(
  (SELECT amount FROM folio_charges WHERE id = (
    SELECT (payload->>'charge_id')::UUID FROM applied_fee
  )),
  150.00,
  'Ledger has a ₱150 additional_fee after applying the preset'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (delete_fee_preset((
    SELECT id FROM fee_presets
    WHERE operator_id = '10000000-0000-0000-0000-000000000002'
      AND name = 'Overnight parking'
    LIMIT 1
  ))->>'success')::BOOLEAN,
  true,
  'Juan can delete a fee preset'
);

RESET ROLE;

-- Staff Ana can apply a preset
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000004';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (apply_fee_preset(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' ORDER BY created_at DESC LIMIT 1),
    (SELECT id FROM fee_presets
      WHERE operator_id = '10000000-0000-0000-0000-000000000002'
        AND name = 'Lost Ticket'
      LIMIT 1),
    150.00
  )->>'success')::BOOLEAN,
  true,
  'Staff can apply a fee preset to a session'
);

SELECT is(
  upsert_fee_preset(
    '10000000-0000-0000-0000-000000000002',
    'Staff made this',
    25.00
  )->>'error',
  'Permission denied',
  'Staff cannot CRUD fee presets'
);

RESET ROLE;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM fee_presets
    WHERE operator_id = '10000000-0000-0000-0000-000000000002'
      AND name = 'Overnight parking'
  ),
  'Deleted preset is gone'
);

SELECT * FROM finish();
ROLLBACK;
