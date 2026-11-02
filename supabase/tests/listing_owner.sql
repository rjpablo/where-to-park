-- 0079 listing_owner: "Listed by" returns only id, name and photo (pgTAP).
BEGIN;
SELECT plan(3);
SET LOCAL ROLE anon;
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(
  listing_owner('30000000-0000-0000-0000-000000000002')) k),
  ARRAY['avatar_url', 'display_name', 'id'], 'only id, name and photo (no email, no phone)');
RESET ROLE;
UPDATE locations SET published = false WHERE id = '30000000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
SELECT is(listing_owner('30000000-0000-0000-0000-000000000002'), NULL,
  'unpublished listing: owner not shown to the public');
SELECT is(listing_owner('00000000-0000-0000-0000-00000000dead'), NULL, 'unknown listing: NULL');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
