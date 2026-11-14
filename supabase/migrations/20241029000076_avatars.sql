-- 0076 Profile photos (rj t179u: "Add an option to upload a user's profile picture").
--
-- profiles.avatar_url (0069) now holds either
--   * 'avatars/<user id>/<file>.jpg' — an uploaded photo in the public Storage bucket
--     `avatars` (the app turns it into <supabase url>/storage/v1/object/public/…), or
--   * an https URL — the Google picture (0069 / 0077).
-- Users can't write avatar_url directly (no column grant); set_my_avatar / clear_my_avatar
-- do it after checking the file is in the caller's own folder.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_removed_at TIMESTAMPTZ;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public bucket: files are served by URL without a SELECT policy. Only the owner may list,
-- add, replace or delete files in <their user id>/.
DROP POLICY IF EXISTS "avatars_owner_select" ON storage.objects;
CREATE POLICY "avatars_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT);
DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
CREATE POLICY "avatars_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT
              AND array_length(storage.foldername(name), 1) = 1);
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT);
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

-- p_path: '<user id>/<file>' inside the avatars bucket (already uploaded).
CREATE OR REPLACE FUNCTION public.set_my_avatar(p_path TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_path TEXT := btrim(COALESCE(p_path, ''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF v_path !~ ('^' || v_uid::TEXT || '/[A-Za-z0-9._-]{1,80}$') THEN
    RETURN jsonb_build_object('error', 'invalid_path');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'avatars' AND name = v_path) THEN
    RETURN jsonb_build_object('error', 'not_uploaded');
  END IF;
  UPDATE profiles SET avatar_url = 'avatars/' || v_path, avatar_removed_at = NULL, updated_at = NOW()
   WHERE id = v_uid;
  RETURN jsonb_build_object('success', true, 'avatar_url', 'avatars/' || v_path);
END;
$$;

-- Remove photo: back to the generic icon. Doesn't bring the Google picture back (0077).
CREATE OR REPLACE FUNCTION public.clear_my_avatar()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  UPDATE profiles SET avatar_url = NULL, avatar_removed_at = NOW(), updated_at = NOW()
   WHERE id = auth.uid();
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_avatar(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_my_avatar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_avatar(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_my_avatar() TO authenticated;
