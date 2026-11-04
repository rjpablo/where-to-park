-- Email privacy (rj t179u): "a user's email address should only be visible to him/her".
-- Emails live only in auth.users / auth.identities, which clients cannot read; no public
-- table, view or RPC result carries one. Your own email comes from your session
-- (GET /auth/v1/user). API-level check: scripts/test-email-privacy.js.
BEGIN;
SELECT plan(9);
SELECT is((SELECT count(*)::INT FROM information_schema.columns
            WHERE table_schema IN ('public', 'storage') AND column_name ILIKE '%email%'), 0,
  'no email column in any public or storage table/view');
SELECT ok(NOT has_table_privilege('anon', 'auth.users', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'auth.users', 'SELECT'), 'clients cannot read auth.users');
SELECT ok(NOT has_table_privilege('anon', 'auth.identities', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'auth.identities', 'SELECT'),
  'clients cannot read auth.identities (Google profile data)');
SELECT is((SELECT array_agg(column_name::TEXT ORDER BY column_name) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'public_profiles'),
  ARRAY['avatar_url', 'display_name', 'id'], 'public_profiles is id, name and photo only');
SELECT is((SELECT count(*)::INT FROM pg_views
            WHERE schemaname = 'public' AND (definition ILIKE '%auth.users%' OR definition ILIKE '%identities%')), 0,
  'no public view reads auth.users or auth.identities');
SELECT is((SELECT count(*)::INT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND pg_get_function_result(p.oid) ILIKE '%email%'), 0,
  'no public function returns a column named email');
SELECT is(oauth_display_name('{"name":"someone@gmail.com"}'::jsonb), NULL,
  'an email sent as the Google name never becomes the public display name (0080)');
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT ok(NOT EXISTS (SELECT 1 FROM public_profiles pp
                        JOIN LATERAL (SELECT row_to_json(pp)::TEXT AS j) x ON TRUE WHERE x.j LIKE '%@%'),
  'public_profiles rows carry no email');
SELECT ok(listing_owner('30000000-0000-0000-0000-000000000002')::TEXT NOT LIKE '%@%',
  'listing owner carries no email');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
