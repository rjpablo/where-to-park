BEGIN;
SELECT plan(4);

SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT ok(
  EXISTS (
    SELECT 1 FROM locations
    WHERE id = '30000000-0000-0000-0000-000000000005'
      AND verification_status = 'unverified'
      AND published = true
  ),
  'Anon can read a published Unverified listing (visible with badge)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM search_nearby(16.4023, 120.5960, 5000, NULL, false, false, 'distance', 50)
    WHERE id = '30000000-0000-0000-0000-000000000005'
      AND verification_status = 'unverified'
  ),
  'search_nearby returns published Unverified listings to guests'
);

RESET ROLE;

UPDATE locations SET published = false
WHERE id = '30000000-0000-0000-0000-000000000005';

SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM locations WHERE id = '30000000-0000-0000-0000-000000000005'),
  0,
  'Anon cannot read unpublished listings'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM search_nearby(16.4023, 120.5960, 5000, NULL, false, false, 'distance', 50)
    WHERE id = '30000000-0000-0000-0000-000000000005'),
  0,
  'search_nearby hides unpublished listings'
);

SELECT * FROM finish();
ROLLBACK;
