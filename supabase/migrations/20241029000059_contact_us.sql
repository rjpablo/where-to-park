-- 0059: Contact Us (rj): anyone (guests too) can send an Issue / Feedback / Suggestion
-- with up to 5 images; admins see them in an Admin screen, mark them resolved, and get
-- an in-app notification (notifications table, like the other alerts) for each one.
--
-- * contact_submissions: no direct inserts; submit_contact() (anon + authenticated)
--   validates and rate-limits, links the signed-in user, notifies every admin.
-- * Abuse limits: message 1-2000 chars, contact <= 200 chars (email or phone), device id
--   format checked, at most 5 per hour per account and per device, 60 per hour for all
--   guests together, at most 5 images.
-- * Storage bucket contact-images (private): anyone may upload '<submission id>/<file>'
--   within 30 minutes of the submission, up to the image count it declared (max 5);
--   only admins can read. No update/delete for senders.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contact_submission';

CREATE TABLE IF NOT EXISTS contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('issue', 'feedback', 'suggestion')),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  contact text CHECK (contact IS NULL OR char_length(contact) <= 200),
  device_id text CHECK (device_id IS NULL OR device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  image_count int NOT NULL DEFAULT 0 CHECK (image_count BETWEEN 0 AND 5),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS contact_submissions_created ON contact_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS contact_submissions_user ON contact_submissions (user_id, created_at);
CREATE INDEX IF NOT EXISTS contact_submissions_device ON contact_submissions (device_id, created_at);

ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_submissions_admin_read ON contact_submissions;
CREATE POLICY contact_submissions_admin_read ON contact_submissions
  FOR SELECT TO authenticated USING (is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON contact_submissions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_input_error(p_category text, p_message text, p_contact text, p_device_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_category IS NULL OR p_category NOT IN ('issue', 'feedback', 'suggestion') THEN 'invalid_category'
    WHEN p_message IS NULL OR char_length(btrim(p_message)) = 0 THEN 'message_required'
    WHEN char_length(btrim(p_message)) > 2000 THEN 'message_too_long'
    WHEN NULLIF(btrim(p_contact), '') IS NOT NULL AND (char_length(btrim(p_contact)) > 200 OR NOT (
      btrim(p_contact) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      OR regexp_replace(btrim(p_contact), '[\s()-]', '', 'g') ~ '^\+?[0-9]{7,15}$')) THEN 'invalid_contact'
    WHEN p_device_id IS NOT NULL AND p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' THEN 'invalid_device'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.submit_contact(
  p_category text,
  p_message text,
  p_contact text DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_image_count int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_err text := contact_input_error(p_category, p_message, p_contact, p_device_id);
  v_id uuid;
  v_label text;
BEGIN
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  IF p_image_count IS NULL OR p_image_count < 0 OR p_image_count > 5 THEN
    RETURN jsonb_build_object('error', 'too_many_images');
  END IF;
  -- Rate limits (last hour): per account, per device, all guests together.
  IF v_uid IS NOT NULL AND (SELECT count(*) FROM contact_submissions
       WHERE user_id = v_uid AND created_at > now() - interval '1 hour') >= 5 THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  IF p_device_id IS NOT NULL AND (SELECT count(*) FROM contact_submissions
       WHERE device_id = p_device_id AND created_at > now() - interval '1 hour') >= 5 THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  IF v_uid IS NULL AND (SELECT count(*) FROM contact_submissions
       WHERE user_id IS NULL AND created_at > now() - interval '1 hour') >= 60 THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  INSERT INTO contact_submissions (user_id, category, message, contact, device_id, image_count)
  VALUES (v_uid, p_category, btrim(p_message), NULLIF(btrim(p_contact), ''), p_device_id, p_image_count)
  RETURNING id INTO v_id;

  v_label := initcap(p_category);
  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
  SELECT p.id, 'contact_submission'::notification_type, 'New contact message: ' || v_label,
         left(btrim(p_message), 140), 'contact_submission', v_id,
         jsonb_build_object('category', p_category)
    FROM profiles p WHERE p.is_admin;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_contact(text, text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_contact(text, text, text, text, int) TO anon, authenticated, service_role;

-- Storage
INSERT INTO storage.buckets (id, name) VALUES ('contact-images', 'contact-images')
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  UPDATE storage.buckets SET public = false WHERE id = 'contact-images';
  UPDATE storage.buckets SET file_size_limit = 5242880,
         allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
   WHERE id = 'contact-images';
EXCEPTION WHEN undefined_column THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.can_upload_contact_image(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM contact_submissions c
     WHERE c.id::text = split_part(p_name, '/', 1)
       AND c.created_at > now() - interval '30 minutes'
       AND split_part(p_name, '/', 2) ~ '^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$'
       AND split_part(p_name, '/', 3) = ''
       AND (SELECT count(*) FROM storage.objects o
             WHERE o.bucket_id = 'contact-images' AND o.name LIKE c.id::text || '/%') < c.image_count
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_upload_contact_image(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS contact_images_insert ON storage.objects;
CREATE POLICY contact_images_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'contact-images' AND can_upload_contact_image(name));
DROP POLICY IF EXISTS contact_images_admin_read ON storage.objects;
CREATE POLICY contact_images_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contact-images' AND is_admin(auth.uid()));

-- Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_contact_submissions(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  RETURN jsonb_build_object('success', true, 'items', COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC) FROM (
      SELECT c.id, c.created_at, c.category, c.status, c.contact, c.user_id,
             left(c.message, 140) AS preview,
             p.display_name AS user_name, p.phone AS user_phone,
             (SELECT count(*) FROM storage.objects o
               WHERE o.bucket_id = 'contact-images' AND o.name LIKE c.id::text || '/%') AS images
        FROM contact_submissions c LEFT JOIN profiles p ON p.id = c.user_id
       WHERE p_status IS NULL OR c.status = p_status
       ORDER BY c.created_at DESC
       LIMIT 200) x), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_contact_submission(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT row_to_json(x)::jsonb INTO v FROM (
    SELECT c.id, c.created_at, c.category, c.status, c.contact, c.user_id, c.message,
           c.resolved_at, rp.display_name AS resolved_by_name,
           p.display_name AS user_name, p.phone AS user_phone,
           COALESCE((SELECT array_agg(o.name ORDER BY o.name) FROM storage.objects o
             WHERE o.bucket_id = 'contact-images' AND o.name LIKE c.id::text || '/%'), '{}') AS images
      FROM contact_submissions c
      LEFT JOIN profiles p ON p.id = c.user_id
      LEFT JOIN profiles rp ON rp.id = c.resolved_by
     WHERE c.id = p_id) x;
  IF v IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'item', v);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_contact_status(p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_status NOT IN ('open', 'resolved') THEN
    RETURN jsonb_build_object('error', 'invalid_status');
  END IF;
  UPDATE contact_submissions
     SET status = p_status,
         resolved_at = CASE WHEN p_status = 'resolved' THEN now() END,
         resolved_by = CASE WHEN p_status = 'resolved' THEN auth.uid() END
   WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_contact_submissions(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_contact_submission(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_contact_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_contact_submissions(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_contact_submission(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_contact_status(uuid, text) TO authenticated, service_role;

-- Sidebar: open contact messages count for admins.
CREATE OR REPLACE FUNCTION public.get_sidebar_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_profile profiles;
  v_admin BOOLEAN;
  v_triggers JSONB;
BEGIN
  SELECT COALESCE(jsonb_object_agg(key, enabled), '{}'::JSONB) INTO v_triggers
  FROM attention_triggers;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('signed_in', false, 'triggers', v_triggers);
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  v_admin := COALESCE(v_profile.is_admin, FALSE);

  RETURN jsonb_build_object(
    'signed_in', true,
    'triggers', v_triggers,
    'unread_messages', (SELECT COUNT(*) FROM my_unread_messages(v_uid)),
    'unread_notifications', (
      SELECT COUNT(*) FROM notifications WHERE recipient_id = v_uid AND read_at IS NULL
    ),
    'pending_verifications', CASE WHEN v_admin THEN (
      SELECT COUNT(*) FROM locations
      WHERE verification_status = 'unverified' AND rejected_at IS NULL AND deleted_at IS NULL
    ) ELSE 0 END,
    'pending_reports', CASE WHEN v_admin THEN (
      SELECT COUNT(*) FROM reports WHERE status = 'pending'
    ) ELSE 0 END,
    'open_contact', CASE WHEN v_admin THEN (
      SELECT COUNT(*) FROM contact_submissions WHERE status = 'open'
    ) ELSE 0 END,
    'listing_reviewed', (SELECT COUNT(*) FROM my_unseen_reviews(v_uid)),
    'listings', (
      SELECT COUNT(DISTINCT l.id) FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id AND om.profile_id = v_uid
      WHERE l.deleted_at IS NULL
        AND (om.role IN ('owner', 'manager')
         OR om.location_ids = '{}'
         OR l.id = ANY (om.location_ids))
    ),
    'vehicles', (SELECT COUNT(*) FROM vehicles WHERE driver_id = v_uid),
    'profile_incomplete', CASE
      WHEN v_profile.id IS NOT NULL AND is_profile_incomplete(v_profile) THEN 1 ELSE 0 END
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
