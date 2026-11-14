-- Reserved / Unavailable per area (set_area_counts, 0067; was set_manual_counts).
BEGIN;
SELECT plan(4);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (set_area_counts(main_area_id('30000000-0000-0000-0000-000000000001'), 2, 1)->>'counted_spaces')::INTEGER,
  (SELECT location_counted_spaces(id) - 2 - 1 FROM locations WHERE id = '30000000-0000-0000-0000-000000000001'),
  'Reserved and unavailable subtract from available'
);

SELECT is(
  set_area_counts(main_area_id('30000000-0000-0000-0000-000000000001'), 5000, 0)->>'error',
  'no_longer_available',
  'Manual reserved cannot make available negative'
);

RESET ROLE;

SELECT is(
  (SELECT unavailable_count FROM areas WHERE id = main_area_id('30000000-0000-0000-0000-000000000001')),
  1,
  'Unavailable count persisted'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  set_area_counts(main_area_id('30000000-0000-0000-0000-000000000001'), 0, 0)->>'error',
  'Permission denied',
  'Driver cannot set manual counts'
);

SELECT * FROM finish();
ROLLBACK;
