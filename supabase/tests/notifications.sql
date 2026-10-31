BEGIN;
SELECT plan(6);

SELECT is(refresh_overdue() >= 1, true, 'ABC 1234 scheduled end notifies staff as overdue');

SELECT ok(
  EXISTS (
    SELECT 1 FROM notifications
    WHERE type = 'scheduled_end'
      AND ref_id = (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1)
      AND recipient_id = '20000000-0000-0000-0000-000000000002'
  ),
  'Juan received a scheduled-end inbox row'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (extend_session(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
    1,
    'grace'
  )->>'success')::BOOLEAN,
  true,
  'Extend records a staff notification'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM notifications
    WHERE type = 'session_extended'
      AND recipient_id = '20000000-0000-0000-0000-000000000002'
  ),
  'Juan received a session-extended inbox row'
);

SELECT is(
  (end_session(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1),
    0,
    'Closed after notify test'
  )->>'success')::BOOLEAN,
  true,
  'Manual end records a staff notification'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM notifications
    WHERE type = 'session_ended'
      AND recipient_id = '20000000-0000-0000-0000-000000000002'
  ),
  'Juan received a session-ended inbox row'
);

SELECT * FROM finish();
ROLLBACK;
