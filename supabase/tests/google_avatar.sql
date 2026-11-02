-- 0077 Google picture default (pgTAP).
BEGIN;
SELECT plan(4);
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '90000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
        'g1@example.com', '{"full_name":"G One","picture":"https://lh3.googleusercontent.com/a/one"}', '{"provider":"google"}', NOW(), NOW());
SELECT is((SELECT avatar_url FROM profiles WHERE id = '90000000-0000-0000-0000-000000000001'),
  'https://lh3.googleusercontent.com/a/one', 'Google sign-up gets the Google picture');

INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '90000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
        'g2@example.com', NOW(), '{}', '{"provider":"email"}', NOW(), NOW());
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
VALUES (gen_random_uuid(), 'g2', '90000000-0000-0000-0000-000000000002',
        '{"sub":"g2","email":"g2@example.com","email_verified":true,"picture":"https://lh3.googleusercontent.com/a/two"}', 'google', NOW(), NOW());
SELECT is((SELECT avatar_url FROM profiles WHERE id = '90000000-0000-0000-0000-000000000002'),
  'https://lh3.googleusercontent.com/a/two', 'linking Google fills an empty photo');

UPDATE profiles SET avatar_url = 'avatars/90000000-0000-0000-0000-000000000002/1-x.jpg'
 WHERE id = '90000000-0000-0000-0000-000000000002';
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
VALUES (gen_random_uuid(), 'g2b', '90000000-0000-0000-0000-000000000002',
        '{"sub":"g2b","email":"g2@example.com","email_verified":true,"picture":"https://lh3.googleusercontent.com/a/2b"}', 'google', NOW(), NOW());
SELECT is((SELECT avatar_url FROM profiles WHERE id = '90000000-0000-0000-0000-000000000002'),
  'avatars/90000000-0000-0000-0000-000000000002/1-x.jpg', 'an uploaded photo is never replaced');

UPDATE profiles SET avatar_url = NULL, avatar_removed_at = NOW() WHERE id = '90000000-0000-0000-0000-000000000002';
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
VALUES (gen_random_uuid(), 'g2c', '90000000-0000-0000-0000-000000000002',
        '{"sub":"g2c","email":"g2@example.com","email_verified":true,"picture":"https://lh3.googleusercontent.com/a/2c"}', 'google', NOW(), NOW());
SELECT is((SELECT avatar_url FROM profiles WHERE id = '90000000-0000-0000-0000-000000000002'), NULL,
  'after Remove photo, Google does not bring it back');
SELECT * FROM finish();
ROLLBACK;
