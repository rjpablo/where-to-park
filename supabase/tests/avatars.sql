-- 0076 profile photos (pgTAP).
BEGIN;
SELECT plan(5);
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT is(set_my_avatar('20000000-0000-0000-0000-000000000002/x.jpg')->>'error', 'invalid_path',
  'cannot point at another user''s folder');
SELECT is(set_my_avatar('20000000-0000-0000-0000-000000000003/../x.jpg')->>'error', 'invalid_path',
  'no path tricks');
SELECT is(set_my_avatar('20000000-0000-0000-0000-000000000003/none.jpg')->>'error', 'not_uploaded',
  'the file must exist');
SELECT throws_ok($$UPDATE profiles SET avatar_url = 'https://evil.example/x.png'
  WHERE id = '20000000-0000-0000-0000-000000000003'$$, '42501', NULL,
  'avatar_url cannot be written directly');
SELECT is((clear_my_avatar()->>'success')::BOOLEAN, true, 'remove photo works');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
