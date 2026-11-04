-- Location create/edit RPCs and location-photos storage RLS.
BEGIN;
SELECT plan(14);

SELECT ok(
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'location-photos'),
  'location-photos storage bucket exists'
);

-- Claims as postgres before SET ROLE so auth.uid() is visible to authenticated.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (create_location(
    'Wright Park Overflow',
    'Wright Park, Baguio',
    16.4128,
    120.6195,
    12,
    45.00,
    'commercial',
    'No overnight parking'
  )->>'success')::BOOLEAN,
  true,
  'Juan can create a location via create_location'
);

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM locations
    WHERE name = 'Wright Park Overflow'
      AND verification_status = 'unverified'
      AND published = true
      AND rules = 'No overnight parking'
      AND capacity = 12
  ),
  'Created location is published unverified with rules and capacity'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM rates r
    JOIN locations l ON l.id = r.location_id
    WHERE l.name = 'Wright Park Overflow'
      AND r.is_default = true
      AND r.rate_type = 'hourly'
      AND r.hourly_amount = 45.00
  ),
  'Create inserts a default hourly rate'
);

SELECT is(
  (
    SELECT round(ST_Y(geog::geometry)::numeric, 4)
    FROM locations
    WHERE name = 'Wright Park Overflow'
  ),
  16.4128,
  'Pin latitude is stored on the location geography'
);

-- update_location as Juan
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (update_location(
    (SELECT id FROM locations WHERE name = 'Wright Park Overflow'),
    'Wright Park Overflow Lot',
    NULL, NULL, NULL, NULL,
    'Gate closes 10 PM'
  )->>'success')::BOOLEAN,
  true,
  'Juan can update name and rules'
);

SELECT is(
  (put_location_photo(
    (SELECT id FROM locations WHERE name = 'Wright Park Overflow Lot'),
    'facade.jpg',
    true,
    'Street view'
  )->>'success')::BOOLEAN,
  true,
  'Juan can register a facility photo'
);

-- Direct storage INSERT as operator member (RLS write)
INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES (
  'location-photos',
  '30000000-0000-0000-0000-000000000002/rls-member.jpg',
  '20000000-0000-0000-0000-000000000002',
  '{}'::jsonb
);

RESET ROLE;

SELECT is(
  (SELECT rules FROM locations WHERE name = 'Wright Park Overflow Lot'),
  'Gate closes 10 PM',
  'Updated rules persist'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM location_photos lp
    JOIN locations l ON l.id = lp.location_id
    WHERE l.name = 'Wright Park Overflow Lot'
      AND lp.is_cover = true
      AND lp.storage_path LIKE '%/facade.jpg'
  ),
  'Photo metadata row points at the storage path'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'location-photos'
      AND name = '30000000-0000-0000-0000-000000000002/rls-member.jpg'
  ),
  'Operator member write to location-photos succeeded'
);

-- Public (anon) read
SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM storage.objects WHERE bucket_id = 'location-photos'),
  '>=',
  1,
  'Anon can read location-photos objects'
);

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('location-photos', '30000000-0000-0000-0000-000000000002/anon.jpg')$$,
  '42501',
  NULL,
  'Anon cannot write location-photos'
);

RESET ROLE;

-- Non-member (Sarah) cannot write another operator's path
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('location-photos', '30000000-0000-0000-0000-000000000002/sarah.jpg')$$,
  '42501',
  NULL,
  'Non-member cannot write location-photos'
);

SELECT is(
  create_location(
    'Sarah Secret Lot',
    'Somewhere',
    16.41,
    120.59,
    2,
    20
  )->>'operator_id' IS NOT NULL,
  true,
  'Driver with no operator becomes owner of a new operator on create'
);

SELECT * FROM finish();
ROLLBACK;
