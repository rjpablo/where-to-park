BEGIN;
SELECT plan(8);

SELECT is(
  (request_phone_otp('+63 918 333 3333')->>'success')::BOOLEAN,
  true,
  'request_phone_otp accepts a seeded driver phone'
);

SELECT is(
  verify_phone_otp('+639183333333', '000000')->>'error',
  'invalid_otp',
  'Wrong OTP is rejected'
);

SELECT is(
  (verify_phone_otp('+639183333333', '123456')->>'user_id')::UUID,
  '20000000-0000-0000-0000-000000000003'::UUID,
  'Test OTP 123456 signs in Sarah by phone'
);

SELECT is(
  (verify_phone_otp('+639199900011', '123456')->>'is_new')::BOOLEAN,
  true,
  'Unknown phone with test OTP creates a new user'
);

SELECT is(
  (SELECT account_type FROM profiles WHERE phone = '+639199900011'),
  'driver',
  'New phone profile defaults to driver'
);

SELECT set_config('request.jwt.claim.sub', id::TEXT, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', jsonb_build_object('sub', id::TEXT, 'role', 'authenticated')::TEXT, true)
FROM profiles WHERE phone = '+639199900011';
SET LOCAL ROLE authenticated;

SELECT is(
  (complete_profile('New Operator', 'operator')->>'account_type'),
  'operator',
  'New user can set operator account type'
);

RESET ROLE;

SELECT is(
  (SELECT account_type FROM profiles WHERE phone = '+639199900011'),
  'operator',
  'account_type persisted on the profile'
);

SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT cmp_ok(
  (SELECT COUNT(*) FROM search_nearby(16.4023, 120.5960, 5000, 'car')),
  '>=',
  4::bigint,
  'Guest (anon) can still search signed out'
);

SELECT * FROM finish();
ROLLBACK;
