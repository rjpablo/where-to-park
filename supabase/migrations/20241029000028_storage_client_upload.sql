-- Stop inserting storage.objects from RPCs (hosted unique index is not
-- (bucket_id, name), so ON CONFLICT 42P10). Clients upload bytes via
-- Storage, then record the path here.
-- Local JWT proxy has no Storage API; put_chat_image still stores BYTEA
-- in chat_image_blobs as a fallback. Location photo bytes are not stored
-- locally (see README).

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.objects TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;

DO $$
BEGIN
  UPDATE storage.buckets SET public = true WHERE id = 'location-photos';
EXCEPTION WHEN undefined_column THEN
  NULL;
END $$;

DO $$
BEGIN
  UPDATE storage.buckets SET public = false WHERE id = 'chat-images';
EXCEPTION WHEN undefined_column THEN
  NULL;
END $$;

DROP POLICY IF EXISTS "chat_images_member_update" ON storage.objects;
CREATE POLICY "chat_images_member_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id::text = split_part(name, '/', 1)
        AND (
          t.driver_id = auth.uid()
          OR (
            is_operator_member(auth.uid(), t.operator_id)
            AND driver_has_stay(t.location_id, t.driver_id)
          )
        )
    )
  )
  WITH CHECK (
    bucket_id = 'chat-images'
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id::text = split_part(name, '/', 1)
        AND (
          t.driver_id = auth.uid()
          OR (
            is_operator_member(auth.uid(), t.operator_id)
            AND driver_has_stay(t.location_id, t.driver_id)
          )
        )
    )
  );

DROP FUNCTION IF EXISTS register_chat_image(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION register_chat_image(
  p_thread_id UUID,
  p_filename TEXT,
  p_content_type TEXT DEFAULT 'image/jpeg'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_thread RECORD;
  v_path TEXT;
  v_id UUID;
  v_type TEXT := COALESCE(NULLIF(btrim(p_content_type), ''), 'image/jpeg');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_thread FROM chat_threads WHERE id = p_thread_id;
  IF v_thread IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_thread.driver_id <> v_uid AND NOT (
    is_operator_member(v_uid, v_thread.operator_id)
    AND driver_has_stay(v_thread.location_id, v_thread.driver_id)
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_path := p_thread_id::TEXT || '/' || regexp_replace(COALESCE(p_filename, 'image.jpg'), '[^A-Za-z0-9._-]', '_', 'g');

  INSERT INTO chat_messages (thread_id, sender_id, kind, image_path, body)
  VALUES (p_thread_id, v_uid, 'image', v_path, NULL)
  RETURNING id INTO v_id;
  UPDATE chat_threads SET last_message_at = NOW() WHERE id = p_thread_id;
  RETURN jsonb_build_object(
    'success', true,
    'message_id', v_id,
    'storage_path', v_path,
    'content_type', v_type
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION register_chat_image(UUID, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION register_chat_image(UUID, TEXT, TEXT) TO authenticated, service_role;

-- Local fallback: store JPEG bytes in chat_image_blobs. Do not touch storage.objects.
CREATE OR REPLACE FUNCTION put_chat_image(
  p_thread_id UUID,
  p_filename TEXT,
  p_bytes_base64 TEXT DEFAULT NULL,
  p_content_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_thread RECORD;
  v_path TEXT;
  v_id UUID;
  v_bytes BYTEA;
  v_type TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_thread FROM chat_threads WHERE id = p_thread_id;
  IF v_thread IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_thread.driver_id <> v_uid AND NOT (
    is_operator_member(v_uid, v_thread.operator_id)
    AND driver_has_stay(v_thread.location_id, v_thread.driver_id)
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_path := p_thread_id::TEXT || '/' || regexp_replace(COALESCE(p_filename, 'image.jpg'), '[^A-Za-z0-9._-]', '_', 'g');
  IF p_bytes_base64 IS NOT NULL AND length(p_bytes_base64) > 8 THEN
    v_bytes := decode(p_bytes_base64, 'base64');
    v_type := COALESCE(NULLIF(btrim(p_content_type), ''), 'image/jpeg');
  ELSE
    v_bytes := default_chat_png();
    v_type := 'image/png';
  END IF;

  INSERT INTO chat_image_blobs (path, content_type, bytes)
  VALUES (v_path, v_type, v_bytes)
  ON CONFLICT (path) DO UPDATE SET bytes = EXCLUDED.bytes, content_type = EXCLUDED.content_type;

  INSERT INTO chat_messages (thread_id, sender_id, kind, image_path, body)
  VALUES (p_thread_id, v_uid, 'image', v_path, NULL)
  RETURNING id INTO v_id;
  UPDATE chat_threads SET last_message_at = NOW() WHERE id = p_thread_id;
  RETURN jsonb_build_object('success', true, 'message_id', v_id, 'storage_path', v_path, 'content_type', v_type);
END;
$$;

GRANT EXECUTE ON FUNCTION put_chat_image(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Metadata only; bytes are uploaded with storage.from('location-photos').upload().
CREATE OR REPLACE FUNCTION put_location_photo(
  p_location_id UUID,
  p_filename TEXT,
  p_is_cover BOOLEAN DEFAULT TRUE,
  p_caption TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_path TEXT;
  v_photo_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_filename IS NULL OR btrim(p_filename) = '' THEN
    RETURN jsonb_build_object('error', 'filename_required');
  END IF;
  IF NOT is_location_operator_member(p_location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  v_path := p_location_id::TEXT || '/' || regexp_replace(btrim(p_filename), '[^A-Za-z0-9._-]', '_', 'g');

  INSERT INTO location_photos (location_id, storage_path, caption, is_cover, uploaded_by)
  VALUES (p_location_id, v_path, NULLIF(btrim(COALESCE(p_caption, '')), ''), COALESCE(p_is_cover, true), v_uid)
  RETURNING id INTO v_photo_id;

  RETURN jsonb_build_object(
    'success', true,
    'photo_id', v_photo_id,
    'storage_path', v_path
  );
END;
$$;

GRANT EXECUTE ON FUNCTION put_location_photo(UUID, TEXT, BOOLEAN, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
