-- 0082 staff invites never reveal whether an account exists (pgTAP).
BEGIN;
SELECT plan(6);
-- Seed: juan (20000000-...-0002) owns 10000000-...-0002; sarah@wheretopark.local exists.
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT is(invite_staff('10000000-0000-0000-0000-000000000002', 'nobody-pgtap@example.com') - 'sent_to',
          invite_staff('10000000-0000-0000-0000-000000000002', 'sarah@wheretopark.local') - 'sent_to',
  'same answer for an unknown email and an existing account');
SELECT is(invite_staff('10000000-0000-0000-0000-000000000002', 'nobody-pgtap@example.com')->>'error', 'cooldown',
  'resend within 3 minutes refused (no account)');
SELECT is(invite_staff('10000000-0000-0000-0000-000000000002', 'sarah@wheretopark.local')->>'error', 'cooldown',
  'resend within 3 minutes refused (account)');
SELECT is(invite_staff('10000000-0000-0000-0000-000000000002', 'not-an-email')->>'error', 'invalid_email',
  'format errors still reported');
SELECT throws_ok($$SELECT * FROM staff_invites$$, '42501', NULL, 'staff_invites is server-only');
RESET ROLE;
UPDATE staff_invites SET last_sent_at = NOW() - INTERVAL '181 seconds';
SET LOCAL ROLE authenticated;
SELECT is((invite_staff('10000000-0000-0000-0000-000000000002', 'nobody-pgtap@example.com')->>'success')::BOOLEAN, true,
  'resend allowed after 3 minutes');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
