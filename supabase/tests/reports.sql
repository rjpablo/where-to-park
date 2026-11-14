BEGIN;
SELECT plan(9);

CREATE TEMP TABLE report_ids (label TEXT, id UUID);
GRANT ALL ON report_ids TO PUBLIC;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO report_ids
SELECT 'location', (submit_report(
  'location',
  '30000000-0000-0000-0000-000000000002',
  'Inaccurate rates'
)->>'report_id')::UUID;

INSERT INTO report_ids
SELECT 'review', (submit_report(
  'review',
  (SELECT id FROM reviews
    WHERE location_id = '30000000-0000-0000-0000-000000000001'
    LIMIT 1),
  'Spam'
)->>'report_id')::UUID;

SELECT ok(
  (SELECT id FROM report_ids WHERE label = 'location') IS NOT NULL,
  'Sarah can report a listing'
);

SELECT ok(
  (SELECT id FROM report_ids WHERE label = 'review') IS NOT NULL,
  'Sarah can report a review'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM reports),
  0,
  'Non-admin cannot read the report queue'
);

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  resolve_report((SELECT id FROM report_ids WHERE label = 'review'), 'hide')->>'error',
  'Permission denied',
  'Non-admin cannot resolve reports'
);

RESET ROLE;

SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM reports WHERE status = 'pending'),
  '>=',
  2,
  'Admin can list pending reports'
);

SELECT is(
  (resolve_report(
    (SELECT id FROM reports WHERE target_type = 'review' AND status = 'pending' LIMIT 1),
    'hide'
  )->>'action'),
  'hide',
  'Admin can hide a reported review'
);

SELECT is(
  (resolve_report(
    (SELECT id FROM reports WHERE target_type = 'location' AND status = 'pending' LIMIT 1),
    'resolve'
  )->>'status'),
  'resolved',
  'Admin can resolve a listing report without hiding it'
);

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1 FROM reviews
    WHERE location_id = '30000000-0000-0000-0000-000000000001'
      AND hidden = true
  ),
  'Hidden review is marked hidden'
);

SELECT is(
  (SELECT published FROM locations WHERE id = '30000000-0000-0000-0000-000000000002'),
  true,
  'Resolved listing report does not unpublish the location'
);

SELECT * FROM finish();
ROLLBACK;
