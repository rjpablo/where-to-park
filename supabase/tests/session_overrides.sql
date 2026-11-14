BEGIN;
SELECT plan(5);

UPDATE parking_sessions
SET scheduled_end_at = NOW() - INTERVAL '30 minutes'
WHERE plate = 'ABC 1234';

SELECT is(refresh_overdue() >= 1, true, 'Active session past scheduled end becomes overdue');

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (override_session_start(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
    NOW() - INTERVAL '3 hours',
    'Arrived early'
  )->>'success')::BOOLEAN,
  true,
  'Juan can override session start time'
);

SELECT cmp_ok(
  (session_balance_preview(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1)
  )->>'parking_so_far')::NUMERIC,
  '>=',
  150.00,
  'Start override of 3h at ₱50/h quotes at least ₱150 parking so far'
);

SELECT is(
  (edit_amount_due(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
    80.00,
    'Guest discount'
  )->>'amount_due')::NUMERIC,
  80.00,
  'Edit amount due posts an adjustment to ₱80'
);

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  override_session_start(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
    NOW() - INTERVAL '1 hour',
    'nope'
  )->>'error',
  'Permission denied',
  'Driver cannot override start time'
);

SELECT * FROM finish();
ROLLBACK;
