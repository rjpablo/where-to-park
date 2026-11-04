-- Accept resized JPEG bytes (EXIF already stripped by the client canvas).

DROP FUNCTION IF EXISTS put_chat_image(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION put_chat_image(
  p_thread_id UUID,
  p_filename TEXT,
  p_bytes_base64 TEXT DEFAULT NULL,
  p_content_type TEXT DEFAULT NULL
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

  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES (
    'chat-images',
    v_path,
    v_uid,
    jsonb_build_object('source', 'put_chat_image', 'contentType', v_type)
  )
  ON CONFLICT (bucket_id, name) DO UPDATE SET updated_at = NOW();

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

NOTIFY pgrst, 'reload schema';
