BEGIN;
SELECT plan(6);

SELECT ok(
  EXISTS (
    SELECT 1 FROM vehicles
    WHERE driver_id = '20000000-0000-0000-0000-000000000003'
      AND is_default AND vehicle_type = 'car' AND nickname = 'My Car'
  ),
  'Sarah seeded default vehicle is a car'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (upsert_vehicle('Scooter', 'motorcycle', 'SCT 1', NULL, true)->>'success')::BOOLEAN,
  true,
  'Sarah can save a motorcycle and mark it default'
);

RESET ROLE;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM vehicles
    WHERE driver_id = '20000000-0000-0000-0000-000000000003' AND is_default),
  1,
  'Only one default vehicle per driver'
);

SELECT is(
  (SELECT vehicle_type FROM vehicles
    WHERE driver_id = '20000000-0000-0000-0000-000000000003' AND is_default),
  'motorcycle'::vehicle_type,
  'Default vehicle type is now motorcycle'
);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM vehicles WHERE driver_id = '20000000-0000-0000-0000-000000000003'),
  0,
  'Juan cannot read Sarah vehicles'
);

RESET ROLE;

SELECT cmp_ok(
  (SELECT COUNT(*) FROM search_nearby(16.4023, 120.5960, 5000, 'motorcycle')),
  '>=',
  1::bigint,
  'search_nearby accepts the default vehicle type as a filter'
);

SELECT * FROM finish();
ROLLBACK;
