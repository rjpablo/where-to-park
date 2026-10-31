-- Store chat image bytes and mint signed URLs (host Storage cannot reach the DB).

CREATE TABLE IF NOT EXISTS chat_image_blobs (
  path TEXT PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'image/png',
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_image_blobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_image_blobs_member_read" ON chat_image_blobs;
CREATE POLICY "chat_image_blobs_member_read"
  ON chat_image_blobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id::text = split_part(path, '/', 1)
        AND (
          t.driver_id = auth.uid()
          OR is_operator_member(auth.uid(), t.operator_id)
        )
    )
  );

-- 80x56 solid blue PNG used when the client does not upload bytes.
CREATE OR REPLACE FUNCTION default_chat_png()
RETURNS BYTEA
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAA4CAIAAADl1OjNAAAAU0lEQVR42u3PQQ0AAAgEoCtjMuNbwhS+ZKMAqZ5XIiwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsfG0BFtxd+NlI7coAAAAASUVORK5CYII=',
    'base64'
  );
$$;

DROP FUNCTION IF EXISTS put_chat_image(UUID, TEXT);

CREATE OR REPLACE FUNCTION put_chat_image(
  p_thread_id UUID,
  p_filename TEXT,
  p_bytes_base64 TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_thread RECORD;
  v_path TEXT;
  v_id UUID;
  v_bytes BYTEA;
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
  ELSE
    v_bytes := default_chat_png();
  END IF;

  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES (
    'chat-images',
    v_path,
    v_uid,
    jsonb_build_object('source', 'put_chat_image', 'contentType', 'image/png')
  )
  ON CONFLICT (bucket_id, name) DO UPDATE SET updated_at = NOW();

  INSERT INTO chat_image_blobs (path, content_type, bytes)
  VALUES (v_path, 'image/png', v_bytes)
  ON CONFLICT (path) DO UPDATE SET bytes = EXCLUDED.bytes, content_type = EXCLUDED.content_type;

  INSERT INTO chat_messages (thread_id, sender_id, kind, image_path, body)
  VALUES (p_thread_id, v_uid, 'image', v_path, NULL)
  RETURNING id INTO v_id;
  UPDATE chat_threads SET last_message_at = NOW() WHERE id = p_thread_id;
  RETURN jsonb_build_object('success', true, 'message_id', v_id, 'storage_path', v_path);
END;
$$;

CREATE OR REPLACE FUNCTION get_chat_image(p_path TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_blob RECORD;
  v_thread UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  v_thread := NULLIF(split_part(p_path, '/', 1), '')::UUID;
  IF v_thread IS NULL OR NOT EXISTS (
    SELECT 1 FROM chat_threads t
    WHERE t.id = v_thread
      AND (t.driver_id = v_uid OR is_operator_member(v_uid, t.operator_id))
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT * INTO v_blob FROM chat_image_blobs WHERE path = p_path;
  IF v_blob IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'content_type', v_blob.content_type,
    'base64', encode(v_blob.bytes, 'base64')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION put_chat_image(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_chat_image(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION default_chat_png() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
