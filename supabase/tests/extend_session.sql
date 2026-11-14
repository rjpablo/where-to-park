BEGIN;
SELECT plan(3);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (extend_session(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
    1,
    'Driver asked for one more hour'
  )->>'success')::BOOLEAN,
  true,
  'Juan can extend ABC 1234 by 1 hour'
);

SELECT is(
  (SELECT status FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
  'active',
  'Extend clears overdue and sets status active'
);

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  extend_session(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
    1,
    'nope'
  )->>'error',
  'Permission denied',
  'Driver cannot extend the session'
);

SELECT * FROM finish();
ROLLBACK;
