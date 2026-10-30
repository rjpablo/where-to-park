-- 🟧 Operators and staff can reply to a driver who messaged them first.
-- Before, an operator member could only send (text or image) when the driver had a parking
-- session or reservation at the listing, so a driver asking a question before booking got
-- 'Permission denied' on every reply. The spec's rule is that operators can't send the
-- FIRST message to a driver without a stay; once the driver has written in the thread,
-- the operator's members (owner, managers, staff) may answer.
-- driver_has_stay itself is unchanged (driver reviews still use it).

CREATE OR REPLACE FUNCTION public.operator_can_message_thread(p_thread_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM chat_threads t
    WHERE t.id = p_thread_id
      AND (
        driver_has_stay(t.location_id, t.driver_id)
        OR EXISTS (
          SELECT 1 FROM chat_messages m
          WHERE m.thread_id = t.id AND m.sender_id = t.driver_id
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.operator_can_message_thread(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_can_message_thread(UUID) TO authenticated, service_role;

-- Direct inserts (RLS): same rule as the RPCs.
DROP POLICY IF EXISTS "Operators send only with a stay" ON chat_messages;
DROP POLICY IF EXISTS "Operators send with a stay or a driver message" ON chat_messages;
CREATE POLICY "Operators send with a stay or a driver message" ON chat_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND EXISTS (
      SELECT 1 FROM chat_threads t
      JOIN operator_members om ON om.operator_id = t.operator_id AND om.profile_id = auth.uid()
      WHERE t.id = chat_messages.thread_id AND operator_can_message_thread(t.id)
    )
  );

-- Chat image uploads (Storage).
DROP POLICY IF EXISTS chat_images_member_write ON storage.objects;
CREATE POLICY chat_images_member_write ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'chat-images' AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id::text = split_part(objects.name, '/', 1)
        AND ((t.driver_id = auth.uid()) OR (is_operator_member(auth.uid(), t.operator_id) AND operator_can_message_thread(t.id)))
    )
  );

DROP POLICY IF EXISTS chat_images_member_update ON storage.objects;
CREATE POLICY chat_images_member_update ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'chat-images' AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id::text = split_part(objects.name, '/', 1)
        AND ((t.driver_id = auth.uid()) OR (is_operator_member(auth.uid(), t.operator_id) AND operator_can_message_thread(t.id)))
    )
  ) WITH CHECK (
    bucket_id = 'chat-images' AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id::text = split_part(objects.name, '/', 1)
        AND ((t.driver_id = auth.uid()) OR (is_operator_member(auth.uid(), t.operator_id) AND operator_can_message_thread(t.id)))
    )
  );

-- RPCs: hosted definitions with the stay check swapped for operator_can_message_thread.

CREATE OR REPLACE FUNCTION public.send_chat_message(p_thread_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_thread RECORD;
  v_id UUID;
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
    AND operator_can_message_thread(v_thread.id)
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RETURN jsonb_build_object('error', 'body_required');
  END IF;
  INSERT INTO chat_messages (thread_id, sender_id, kind, body)
  VALUES (p_thread_id, v_uid, 'text', btrim(p_body))
  RETURNING id INTO v_id;
  UPDATE chat_threads SET last_message_at = NOW() WHERE id = p_thread_id;
  RETURN jsonb_build_object('success', true, 'message_id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.put_chat_image(p_thread_id uuid, p_filename text, p_bytes_base64 text DEFAULT NULL::text, p_content_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND operator_can_message_thread(v_thread.id)
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
$function$;

CREATE OR REPLACE FUNCTION public.register_chat_image(p_thread_id uuid, p_filename text, p_content_type text DEFAULT 'image/jpeg'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND operator_can_message_thread(v_thread.id)
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
$function$;
