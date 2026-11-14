BEGIN;
SELECT plan(9);

-- Inserting an auth.users row must create a matching profile.
-- Local GoTrue has no users.phone column; hosted does. Prefer phone when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'phone'
  ) THEN
    EXECUTE $i$
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token, recovery_token,
        phone, phone_confirmed_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        'aaaaaaaa-0000-0000-0000-000000000099',
        'authenticated', 'authenticated', 'trigger-user@wheretopark.local',
        'x', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW(),
        '', '', '', '',
        '639170000099', NOW()
      )
    $i$;
  ELSE
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      'aaaaaaaa-0000-0000-0000-000000000099',
      'authenticated', 'authenticated', 'trigger-user@wheretopark.local',
      'x', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW(),
      '', '', '', ''
    );
  END IF;
END $$;

SELECT ok(
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000099'
  ),
  'Profile is created on auth.users insert'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000099'
      AND display_name IN ('+639170000099', 'trigger-user@wheretopark.local', 'New user')
  ),
  'Auto-created profile uses phone, email, or New user as display_name'
);

SELECT is(
  (SELECT is_admin FROM profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000099'),
  false,
  'Auto-created profile is not admin'
);

-- Anon cannot call the local-only fake OTP RPCs.
SET LOCAL "request.jwt.claim.sub" TO '';
SET LOCAL "request.jwt.claim.role" TO 'anon';
SET LOCAL "request.jwt.claims" TO '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT request_phone_otp('+639170000001')$$,
  '42501',
  NULL,
  'anon cannot execute request_phone_otp'
);

SELECT throws_ok(
  $$SELECT verify_phone_otp('+639170000001', '123456')$$,
  '42501',
  NULL,
  'anon cannot execute verify_phone_otp'
);

RESET ROLE;

-- Authenticated user cannot set is_admin on their own row.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000003';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE profiles SET is_admin = true WHERE id = '20000000-0000-0000-0000-000000000003'$$,
  '42501',
  NULL,
  'is_admin cannot be self-set'
);

SELECT lives_ok(
  $$UPDATE profiles SET preferred_nav_app = 'waze' WHERE id = '20000000-0000-0000-0000-000000000003'$$,
  'User can still update allowed profile columns'
);

SELECT is(
  (SELECT is_admin FROM profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  false,
  'Sarah remains non-admin after the blocked is_admin update'
);

RESET ROLE;

SELECT is(
  (SELECT preferred_nav_app FROM profiles WHERE id = '20000000-0000-0000-0000-000000000003'),
  'waze',
  'Allowed column update persisted'
);

SELECT * FROM finish();
ROLLBACK;
