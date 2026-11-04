-- 0072 push delivery (pgTAP). Vault config is absent locally, so the trigger is a no-op
-- here; this checks the wiring, not delivery (see docs/push-notifications.md › Testing).
BEGIN;
SELECT plan(9);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notifications_push'
          AND tgrelid = 'public.notifications'::regclass),
  'notifications has the push trigger'
);

SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-overdue' AND schedule = '* * * * *'),
  'refresh-overdue runs every minute'
);

SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-receipts'),
  'push-receipts job exists'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.push_webhook_post(jsonb)', 'EXECUTE'),
  'clients cannot call the webhook poster'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.push_tickets', 'SELECT'),
  'clients cannot read push tickets'
);

-- Juan (staff) registers a token, then an insert still succeeds without Vault config.
SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (register_push_token('ExponentPushToken[test-juan]', 'android')->>'success')::BOOLEAN,
  true,
  'Juan registers a token'
);

SELECT is(
  (extend_session(
     (SELECT id FROM parking_sessions WHERE plate = 'ABC 1234' LIMIT 1), 1, 'push test'
   )->'push_tokens'),
  '[]'::JSONB,
  'extend_session no longer hands tokens to the app'
);

SELECT is(
  (unregister_push_token('ExponentPushToken[test-juan]')->>'success')::BOOLEAN,
  true,
  'Juan unregisters on sign-out'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM push_tokens WHERE token = 'ExponentPushToken[test-juan]')::INT,
  0,
  'the token is gone'
);

SELECT * FROM finish();
ROLLBACK;
