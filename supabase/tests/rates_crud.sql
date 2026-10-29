-- Areas and rates CRUD, including quote_price preview and default-rate protection.
BEGIN;
SELECT plan(16);

-- Session Road seeded default is hourly ₱50. 1 billed hour is ₱50, not ₱150.
SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000002', 'car', NOW(), 1)->>'amount')::NUMERIC,
  50.00,
  'Session Road 1h quote is ₱50 from seeded hourly Standard Rate'
);

SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000002', 'car', NOW(), 1)->>'rate_name'),
  'Standard Rate',
  'Session Road 1h uses seeded Standard Rate'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (upsert_area('30000000-0000-0000-0000-000000000002', 'Covered')->>'success')::BOOLEAN,
  true,
  'Juan can create a named area'
);

SELECT is(
  (upsert_rate(
    '30000000-0000-0000-0000-000000000002',
    'Day Pass',
    'daily',
    NULL,
    false,
    NULL,
    400.00
  )->>'success')::BOOLEAN,
  true,
  'Juan can create a Daily rate'
);

SELECT is(
  (upsert_rate(
    '30000000-0000-0000-0000-000000000002',
    'First 2 then hourly',
    'flat_then_hourly',
    NULL,
    false,
    NULL, NULL, NULL,
    2,
    80.00,
    40.00
  )->>'success')::BOOLEAN,
  true,
  'Juan can create a flat-then-hourly rate'
);

SELECT is(
  (upsert_rate(
    '30000000-0000-0000-0000-000000000002',
    'Staff Monthly',
    'monthly',
    NULL,
    false,
    NULL, NULL,
    4500.00
  )->>'success')::BOOLEAN,
  true,
  'Juan can create a named Monthly rate'
);

-- Named custom with a date window that wins over the default.
SELECT is(
  (upsert_rate(
    '30000000-0000-0000-0000-000000000002',
    'Holiday Rush',
    'hourly',
    NULL,
    false,
    150.00,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NOW() - INTERVAL '1 hour',
    NOW() + INTERVAL '2 days'
  )->>'success')::BOOLEAN,
  true,
  'Juan can create a named custom rate with a date range'
);

RESET ROLE;

SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000002', 'car', NOW(), 1)->>'amount')::NUMERIC,
  150.00,
  'Dated custom Holiday Rush ₱150 wins quote_price for 1h'
);

SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000002', 'car', NOW(), 1)->>'rate_name'),
  'Holiday Rush',
  'quote_price preview names the winning custom rate'
);

-- Daily: 25h -> 2 started days * 400
SELECT is(
  (quote_price(
    '30000000-0000-0000-0000-000000000002',
    'car',
    NOW() + INTERVAL '10 days',
    1
  )->>'amount')::NUMERIC,
  50.00,
  'Outside the holiday window, Session Road falls back to ₱50/h default'
);

-- Casa Vallejo seeded flat_then_hourly: ₱100 first 3h then ₱40
SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000003', 'car', NOW(), 1)->>'amount')::NUMERIC,
  100.00,
  'Flat-then-hourly: 1h still pays the flat first-N amount'
);

SELECT is(
  (quote_price('30000000-0000-0000-0000-000000000003', 'car', NOW(), 4)->>'amount')::NUMERIC,
  140.00,
  'Flat-then-hourly: 4h is ₱100 + ₱40'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  delete_rate((
    SELECT id FROM rates
    WHERE location_id = '30000000-0000-0000-0000-000000000002'
      AND is_default = true
    LIMIT 1
  ))->>'error',
  'cannot_delete_default',
  'Default rate cannot be deleted'
);

SELECT is(
  (delete_rate((
    SELECT id FROM rates
    WHERE location_id = '30000000-0000-0000-0000-000000000002'
      AND name = 'Holiday Rush'
    LIMIT 1
  ))->>'success')::BOOLEAN,
  true,
  'Named custom rate can be deleted'
);

SELECT is(
  (delete_area((
    SELECT id FROM areas
    WHERE location_id = '30000000-0000-0000-0000-000000000002'
      AND name = 'Covered'
    LIMIT 1
  ))->>'success')::BOOLEAN,
  true,
  'Named area can be deleted'
);

RESET ROLE;

-- Staff cannot manage rates
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000004';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  upsert_rate(
    '30000000-0000-0000-0000-000000000002',
    'Staff Rate',
    'hourly',
    NULL,
    false,
    10.00
  )->>'error',
  'Permission denied',
  'Staff cannot upsert rates'
);

SELECT * FROM finish();
ROLLBACK;
