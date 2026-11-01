-- Admin Delete for contact messages (rj). Admins only.
-- The app first removes the message's images through the Storage API (allowed by the
-- admin DELETE policy below; no service-role key in the client), then calls
-- admin_delete_contact_submission, which deletes the message and its notifications.
-- The RPC refuses while images are still stored, so no orphaned files are left behind.

DROP POLICY IF EXISTS contact_images_admin_delete ON storage.objects;
CREATE POLICY contact_images_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'contact-images' AND is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_delete_contact_submission(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_left int;
  v_notes int;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  PERFORM 1 FROM contact_submissions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  SELECT COUNT(*) INTO v_left FROM storage.objects o
   WHERE o.bucket_id = 'contact-images' AND o.name LIKE p_id::text || '/%';
  IF v_left > 0 THEN
    RETURN jsonb_build_object('error', 'images_remaining', 'images', v_left);
  END IF;
  DELETE FROM notifications
   WHERE type = 'contact_submission' AND ref_type = 'contact_submission' AND ref_id = p_id;
  GET DIAGNOSTICS v_notes = ROW_COUNT;
  DELETE FROM contact_submissions WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'notifications_deleted', v_notes);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_contact_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_contact_submission(uuid) TO authenticated, service_role;
