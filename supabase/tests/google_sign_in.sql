-- Google sign-in and account linking (migration 0069) with simulated identities.
-- GoTrue's own steps are simulated as the rows it writes. Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.google_user(p_id uuid, p_email text, p_name text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, now(),
    jsonb_build_object('full_name', p_name, 'picture', 'https://lh3.googleusercontent.com/a/qa', 'email', p_email, 'email_verified', true),
    '{"provider":"google","providers":["google"]}', now(), now());
$$;
CREATE FUNCTION pg_temp.google_identity(p_user uuid, p_sub text, p_email text, p_verified boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.identities (id, provider_id, user_id, provider, identity_data, created_at, updated_at)
  VALUES (gen_random_uuid(), p_sub, p_user, 'google',
    jsonb_build_object('sub', p_sub, 'email', p_email, 'email_verified', p_verified,
      'full_name', 'QA Google', 'picture', 'https://lh3.googleusercontent.com/a/qa-link'), now(), now());
$$;
CREATE FUNCTION pg_temp.fails(p_sql text, p_err text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> p_err THEN RAISE NOTICE 'unexpected: %', SQLERRM; RETURN false; END IF;
  RETURN true;
END $$;

DO $$
DECLARE
  G uuid := 'a0000000-0000-0000-0000-0000000000a1';
  JUAN uuid := (SELECT id FROM profiles WHERE phone = '+639170000002');
  ANA uuid := (SELECT id FROM profiles WHERE phone = '+639170000003');
  P profiles%ROWTYPE;
  r jsonb;
BEGIN
  -- 1. A new Google user gets a profile from Google: name and picture, no phone, not onboarded.
  PERFORM pg_temp.google_user(G, 'qa.google.new@example.com', 'QA Google New');
  PERFORM pg_temp.google_identity(G, 'sub-qa-new', 'qa.google.new@example.com', true);
  SELECT * INTO P FROM profiles WHERE id = G;
  ASSERT P.display_name = 'QA Google New', 'name from Google: ' || P.display_name;
  ASSERT P.phone IS NULL AND P.avatar_url = 'https://lh3.googleusercontent.com/a/qa', 'no phone, avatar';
  ASSERT P.onboarded = false AND P.account_type = 'driver', 'asks onboarding';
  ASSERT P.display_name NOT LIKE '%@%', 'email never the display name';
  PERFORM pg_temp.act(G);
  r := complete_profile('QA Google New', 'operator');
  ASSERT (SELECT onboarded AND account_type = 'operator' FROM profiles WHERE id = G), 'onboarded: ' || r::text;

  -- 2. Automatic linking (GoTrue: same verified email -> identity on that user) is allowed.
  PERFORM pg_temp.google_identity(G, 'sub-qa-new-2', 'qa.google.new@example.com', true);

  -- 3. Unverified Google emails never become identities.
  ASSERT pg_temp.fails(format('SELECT pg_temp.google_identity(%L, %L, %L, false)', JUAN, 'sub-qa-unv', 'qa.unverified@example.com'),
    'oauth_email_not_verified'), 'unverified rejected';

  -- 4. Hijack attempt: Ana manually links an identity carrying someone else's email.
  ASSERT pg_temp.fails(format('SELECT pg_temp.google_identity(%L, %L, %L, true)', ANA, 'sub-qa-attack', 'QA.Google.New@example.com'),
    'oauth_email_belongs_to_another_account'), 'foreign email rejected (case-insensitive)';

  -- 5. Juan (phone account) links Google on purpose: allowed; his avatar fills in.
  UPDATE profiles SET avatar_url = NULL WHERE id = JUAN;
  PERFORM pg_temp.google_identity(JUAN, 'sub-qa-juan', 'qa.juan@example.com', true);
  ASSERT (SELECT avatar_url FROM profiles WHERE id = JUAN) = 'https://lh3.googleusercontent.com/a/qa-link', 'avatar on link';
  ASSERT (SELECT phone FROM profiles WHERE id = JUAN) = '+639170000002', 'same phone account';
  -- ...and nobody else can now claim Juan's Google email.
  ASSERT pg_temp.fails(format('SELECT pg_temp.google_identity(%L, %L, %L, true)', ANA, 'sub-qa-attack2', 'qa.juan@example.com'),
    'oauth_email_belongs_to_another_account'), 'linked email protected';

  -- 6. Pre-account takeover: an account holding an UNCONFIRMED copy of an email can't
  --    receive that email's Google identity.
  UPDATE auth.users SET email = 'qa.victim@example.com', email_confirmed_at = NULL WHERE id = ANA;
  ASSERT pg_temp.fails(format('SELECT pg_temp.google_identity(%L, %L, %L, true)', ANA, 'sub-qa-victim', 'qa.victim@example.com'),
    'oauth_link_target_unverified'), 'unconfirmed target rejected';

  -- 7. Phone sign-ups are unchanged (profile named after the phone, onboarding asked).
  INSERT INTO auth.users (id, instance_id, aud, role, phone, created_at, updated_at)
  VALUES ('a0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '639179990001', now(), now());
  SELECT * INTO P FROM profiles WHERE id = 'a0000000-0000-0000-0000-0000000000a2';
  ASSERT P.phone = '+639179990001' AND P.display_name = '+639179990001' AND NOT P.onboarded, 'phone signup';
  ASSERT (SELECT bool_and(onboarded) FROM profiles WHERE phone IN ('+639170000002', '+639170000003')), 'demo accounts onboarded';
END $$;
ROLLBACK;
