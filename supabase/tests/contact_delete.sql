-- Admin delete of contact messages (migration 0060). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v::text, ''), true);
  PERFORM set_config('request.jwt.claims', CASE WHEN v IS NULL THEN json_build_object('role', 'anon')
    ELSE json_build_object('sub', v, 'role', 'authenticated') END::text, true);
END $$;
UPDATE profiles SET is_admin = true WHERE phone = '+639170000002';

DO $$
DECLARE
  r jsonb; gid uuid; dev text := 'testdev_' || substr(md5(random()::text), 1, 12);
  juan uuid := (SELECT id FROM profiles WHERE phone = '+639170000002');
BEGIN
  PERFORM pg_temp.act(NULL);
  r := submit_contact('issue', 'Delete me please', NULL, dev, 1);
  gid := (r->>'id')::uuid;
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE ref_id = gid AND recipient_id = juan), 'notified';
  -- Guests and non-admins can't delete
  ASSERT admin_delete_contact_submission(gid)->>'error' = 'Permission denied', 'anon denied';
  PERFORM pg_temp.act('+639170000001');
  ASSERT admin_delete_contact_submission(gid)->>'error' = 'Permission denied', 'non-admin denied';
  -- Admin: refuses while images remain (simulated object row; storage blocks direct deletes, so
  -- the fake row is dropped with the transaction's rollback)
  PERFORM pg_temp.act('+639170000002');
  ASSERT admin_delete_contact_submission(gen_random_uuid())->>'error' = 'not_found', 'not found';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('contact-images', gid || '/0-test.jpg');
  r := admin_delete_contact_submission(gid);
  ASSERT r->>'error' = 'images_remaining' AND (r->>'images')::int = 1, 'images first: ' || r::text;
  ASSERT EXISTS (SELECT 1 FROM contact_submissions WHERE id = gid), 'still there';
  -- (the test object row is renamed out of this message's folder; it goes away with the rollback)
  UPDATE storage.objects SET name = 'zz-test/' || name WHERE bucket_id = 'contact-images' AND name = gid || '/0-test.jpg';
  r := admin_delete_contact_submission(gid);
  ASSERT r->>'success' = 'true', 'admin delete: ' || r::text;
  ASSERT (r->>'notifications_deleted')::int >= 1, 'notifications counted';
  ASSERT NOT EXISTS (SELECT 1 FROM contact_submissions WHERE id = gid), 'row gone';
  ASSERT NOT EXISTS (SELECT 1 FROM notifications WHERE ref_id = gid), 'notifications gone';
  ASSERT admin_delete_contact_submission(gid)->>'error' = 'not_found', 'second delete';
  -- Storage policy exists for admins only
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'contact_images_admin_delete' AND cmd = 'DELETE'), 'delete policy';
  ASSERT NOT has_function_privilege('anon', 'admin_delete_contact_submission(uuid)', 'EXECUTE'), 'anon no exec';
END $$;
ROLLBACK;
