BEGIN;
SELECT plan(11);

SELECT ok(
  EXISTS (
    SELECT 1 FROM reviews
    WHERE location_id = '30000000-0000-0000-0000-000000000002'
      AND author_id = '20000000-0000-0000-0000-000000000003'
      AND session_id IS NOT NULL
  ),
  'Sarah Session Road review is stamped Booked via app from her session'
);

SELECT is(
  (SELECT review_count FROM location_rating_stats
    WHERE location_id = '30000000-0000-0000-0000-000000000002'),
  1,
  'Session Road rating stats count matches the listed review'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM reviews
    WHERE location_id = '30000000-0000-0000-0000-000000000001'
      AND author_id = '20000000-0000-0000-0000-000000000003'
      AND session_id IS NULL
      AND reservation_id IS NULL
  ),
  'Sarah SM review is not Booked via app (no stay there)'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (submit_location_review(
    '30000000-0000-0000-0000-000000000004',
    5,
    'Quiet driveway'
  )->>'booked_via_app')::BOOLEAN,
  false,
  'Signed-in user can review a location without a stay'
);

SELECT is(
  (submit_location_review(
    '30000000-0000-0000-0000-000000000002',
    4,
    'Convenient location near Session Road. A bit pricey but worth it.'
  )->>'booked_via_app')::BOOLEAN,
  true,
  'Session Road review stays Booked via app'
);

SELECT is(
  submit_driver_review(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' ORDER BY created_at DESC LIMIT 1),
    5,
    'Great guest'
  )->>'error',
  'Permission denied',
  'Driver cannot write a driver review on their own session'
);

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (submit_driver_review(
    (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' ORDER BY created_at DESC LIMIT 1),
    5,
    'On time, clear plate'
  )->>'success')::BOOLEAN,
  true,
  'Juan can review Sarah from the Session Road session'
);

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM driver_reviews
    WHERE driver_id = '20000000-0000-0000-0000-000000000003'),
  '>=',
  1,
  'Juan can read Sarah driver reviews because he has a stay with her'
);

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM driver_reviews
    WHERE driver_id = '20000000-0000-0000-0000-000000000003'),
  0,
  'Maria cannot read Sarah driver reviews without a stay'
);

RESET ROLE;

-- A stay at SM with Sarah lets Maria see reviews written by other operators.
INSERT INTO parking_sessions (location_id, driver_id, plate, vehicle_type, status)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003',
  'ABC 1234',
  'car',
  'ended'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM driver_reviews
    WHERE driver_id = '20000000-0000-0000-0000-000000000003'),
  '>=',
  1,
  'After an SM stay, Maria can read driver reviews written by other operators'
);

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM driver_reviews),
  0,
  'Anon cannot read driver reviews'
);

SELECT * FROM finish();
ROLLBACK;
