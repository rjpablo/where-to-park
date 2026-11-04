-- 0073 per-type push switches (pgTAP).
BEGIN;
SELECT plan(7);

SELECT is((SELECT enabled FROM push_settings WHERE type = 'scheduled_end'), false,
  'scheduled end push is off by default');
SELECT is((SELECT enabled FROM push_settings WHERE type = 'chat_message'), true,
  'picked types are on by default');
SELECT is((SELECT count(*) FROM push_settings WHERE type = 'fee_paid')::INT, 0,
  'fee_paid has no switch (never pushed)');

-- Juan (not an admin)
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT is(admin_set_push_setting('chat_message', false)->>'error', 'Permission denied',
  'non-admins cannot change a switch');
SELECT is(admin_push_settings()->>'error', 'Permission denied', 'non-admins cannot list');
SELECT is((SELECT count(*) FROM push_settings)::INT, 0, 'RLS hides the table from non-admins');
RESET ROLE;

UPDATE profiles SET is_admin = true WHERE id = '20000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT is((admin_set_push_setting('chat_message', false)->>'success')::BOOLEAN, true,
  'an admin can turn one off');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
