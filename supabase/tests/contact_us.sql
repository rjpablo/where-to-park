-- Contact Us (migration 0059). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN v IS NULL THEN json_build_object('role', 'anon')
    ELSE json_build_object('sub', v, 'role', 'authenticated') END::text, true);
END $$;
-- Juan is an admin inside this transaction only
UPDATE profiles SET is_admin = true WHERE phone = '+639170000002';

DO $$
DECLARE
  r jsonb; gid uuid; sid uuid; dev text := 'testdev_' || substr(md5(random()::text), 1, 12);
  juan uuid := (SELECT id FROM profiles WHERE phone = '+639170000002');
  sarah uuid := (SELECT id FROM profiles WHERE phone = '+639170000001');
  i int;
BEGIN
  -- Guest (no account)
  PERFORM pg_temp.act(NULL);
  ASSERT auth.uid() IS NULL, 'anon';
  ASSERT submit_contact('bug', 'x')->>'error' = 'invalid_category', 'category';
  ASSERT submit_contact('issue', '   ')->>'error' = 'message_required', 'message';
  ASSERT submit_contact('issue', repeat('a', 2001))->>'error' = 'message_too_long', 'length';
  ASSERT submit_contact('issue', 'hi', 'not contact')->>'error' = 'invalid_contact', 'contact';
  ASSERT submit_contact('issue', 'hi', NULL, 'bad id!')->>'error' = 'invalid_device', 'device';
  ASSERT submit_contact('issue', 'hi', NULL, dev, 6)->>'error' = 'too_many_images', 'images';
  r := submit_contact('issue', '  Map does not load  ', 'guest@example.com', dev, 2);
  ASSERT r->>'success' = 'true', 'guest submit: ' || r::text;
  gid := (r->>'id')::uuid;
  ASSERT (SELECT user_id IS NULL AND message = 'Map does not load' AND contact = 'guest@example.com'
            FROM contact_submissions WHERE id = gid), 'stored trimmed, no account';
  ASSERT submit_contact('feedback', 'ok', '+63 917 000 0009', dev)->>'success' = 'true', 'phone contact ok';
  -- Admins are notified
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE recipient_id = juan AND ref_id = gid
                   AND type = 'contact_submission' AND title = 'New contact message: Issue'), 'admin notified';
  ASSERT NOT EXISTS (SELECT 1 FROM notifications WHERE recipient_id = sarah AND ref_id = gid), 'non-admin not';
  -- Upload rule: within 30 min, up to the declared count, plain file names
  ASSERT can_upload_contact_image(gid || '/0-abc.jpg'), 'can upload';
  ASSERT NOT can_upload_contact_image(gid || '/../x.jpg'), 'bad name';
  ASSERT NOT can_upload_contact_image(gid || '/a/b.jpg'), 'no subfolders';
  ASSERT NOT can_upload_contact_image(gen_random_uuid() || '/0.jpg'), 'unknown submission';
  UPDATE contact_submissions SET created_at = now() - interval '31 minutes' WHERE id = gid;
  ASSERT NOT can_upload_contact_image(gid || '/0-abc.jpg'), 'too late';
  UPDATE contact_submissions SET created_at = now() WHERE id = gid;
  -- Rate limit per device: 5 per hour (2 sent above)
  FOR i IN 1..3 LOOP
    ASSERT submit_contact('suggestion', 'idea ' || i, NULL, dev)->>'success' = 'true', 'within limit ' || i;
  END LOOP;
  ASSERT submit_contact('suggestion', 'one more', NULL, dev)->>'error' = 'rate_limited', 'device limited';
  -- Guests can't read
  ASSERT admin_contact_submissions()->>'error' = 'Permission denied', 'anon list';
  -- Signed-in sender: linked to the account
  PERFORM pg_temp.act('+639170000001');
  r := submit_contact('feedback', 'Love it');
  sid := (r->>'id')::uuid;
  ASSERT (SELECT user_id FROM contact_submissions WHERE id = sid) = sarah, 'linked to Sarah';
  ASSERT admin_contact_submissions()->>'error' = 'Permission denied', 'non-admin list';
  ASSERT admin_set_contact_status(sid, 'resolved')->>'error' = 'Permission denied', 'non-admin status';
  -- Admin
  PERFORM pg_temp.act('+639170000002');
  r := admin_contact_submissions();
  -- (one transaction: equal created_at, so check content, not order)
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'items') e
                  WHERE e->>'id' = sid::text AND e->>'user_name' IS NOT NULL), 'sender name: ' || left(r::text, 300);
  r := admin_contact_submission(gid);
  ASSERT r->'item'->>'message' = 'Map does not load' AND r->'item'->>'contact' = 'guest@example.com', 'detail';
  ASSERT admin_set_contact_status(gid, 'resolved')->>'success' = 'true', 'resolve';
  ASSERT (SELECT status = 'resolved' AND resolved_by = juan FROM contact_submissions WHERE id = gid), 'resolved by';
  ASSERT NOT (admin_contact_submissions('open')->'items' @> jsonb_build_array(jsonb_build_object('id', gid))), 'filtered';
  ASSERT admin_set_contact_status(gid, 'open')->>'success' = 'true', 'unresolve';
  ASSERT (SELECT resolved_at IS NULL AND status = 'open' FROM contact_submissions WHERE id = gid), 'unresolved';
  ASSERT admin_set_contact_status(gid, 'done')->>'error' = 'invalid_status', 'bad status';
  ASSERT (get_sidebar_counts()->>'open_contact')::int >= 2, 'sidebar count';
  RAISE NOTICE 'contact us: ok';
END $$;
-- Direct writes are not allowed for clients
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    INSERT INTO contact_submissions (category, message) VALUES ('issue', 'direct');
    RAISE EXCEPTION 'direct insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM contact_submissions) = 0, 'anon reads nothing';
END $$;
RESET ROLE;
ROLLBACK;
