BEGIN;
SELECT plan(9);

-- Anon can read public display names, not phones.
SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM public_profiles),
  '>=',
  1,
  'Anon can read public_profiles display names'
);

SELECT throws_ok(
  $$SELECT COUNT(*) FROM profiles$$,
  '42501',
  NULL,
  'Anon cannot read profiles (phones stay private)'
);

RESET ROLE;

-- Another driver cannot read Sarah's phone.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT phone FROM profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  NULL,
  'Unrelated user cannot read Sarah phone from profiles'
);

SELECT is(
  (SELECT display_name FROM public_profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  'Sarah Chen',
  'Unrelated user can still read Sarah display_name'
);

RESET ROLE;

-- Sarah can read her own phone.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT phone FROM profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  '+639183333333',
  'User can read their own phone'
);

RESET ROLE;

-- Session Road operator (Juan) can see Sarah phone because she has a session there.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT phone FROM profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  '+639183333333',
  'Operator with a driver stay can read that driver phone'
);

SELECT is(
  (SELECT phone FROM profiles WHERE id = '20000000-0000-0000-0000-000000000004'),
  '+639184444444',
  'Operator can read teammate phone'
);

RESET ROLE;

-- SM owner (Maria) has no stay with Sarah, so no phone.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT phone FROM profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  NULL,
  'Operator without a stay cannot read driver phone'
);

RESET ROLE;

-- Admin can read phones.
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT phone FROM profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  '+639183333333',
  'Admin can read driver phone'
);

SELECT * FROM finish();
ROLLBACK;
