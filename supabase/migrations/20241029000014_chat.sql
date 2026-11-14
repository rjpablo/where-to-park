-- Chat: drivers message any listing; operators/staff only reply when a
-- session or reservation exists. Images in private chat-images bucket.

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_location_driver_key
  ON chat_threads (location_id, driver_id);

CREATE OR REPLACE FUNCTION driver_has_stay(p_location_id UUID, p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM parking_sessions
    WHERE location_id = p_location_id AND driver_id = p_driver_id
  ) OR EXISTS (
    SELECT 1 FROM reservations
    WHERE location_id = p_location_id AND driver_id = p_driver_id
  );
$$;

CREATE OR REPLACE FUNCTION post_system_chat_event(
  p_location_id UUID,
  p_driver_id UUID,
  p_body TEXT,
  p_event_type TEXT,
  p_ref UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread UUID;
  v_operator UUID;
BEGIN
  IF p_driver_id IS NULL THEN
    RETURN;
  END IF;
  SELECT operator_id INTO v_operator FROM locations WHERE id = p_location_id;
  SELECT id INTO v_thread FROM chat_threads
   WHERE location_id = p_location_id AND driver_id = p_driver_id LIMIT 1;
  IF v_thread IS NULL THEN
    INSERT INTO chat_threads (location_id, operator_id, driver_id, started_by)
    VALUES (p_location_id, v_operator, p_driver_id, 'system')
    RETURNING id INTO v_thread;
  END IF;
  INSERT INTO chat_messages (thread_id, sender_id, kind, body, event_type, event_ref)
  VALUES (v_thread, NULL, 'system', p_body, p_event_type, p_ref);
  UPDATE chat_threads SET last_message_at = NOW() WHERE id = v_thread;
END;
$$;

DROP POLICY IF EXISTS "Thread participants can send messages" ON chat_messages;
DROP POLICY IF EXISTS "Drivers send in own threads" ON chat_messages;
DROP POLICY IF EXISTS "Operators send only with a stay" ON chat_messages;

CREATE POLICY "Drivers send in own threads"
  ON chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = thread_id AND t.driver_id = auth.uid()
    )
  );

CREATE POLICY "Operators send only with a stay"
  ON chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      JOIN operator_members om ON om.operator_id = t.operator_id AND om.profile_id = auth.uid()
      WHERE t.id = chat_messages.thread_id
        AND driver_has_stay(t.location_id, t.driver_id)
    )
  );

INSERT INTO storage.buckets (id, name)
VALUES ('chat-images', 'chat-images')
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat_images_member_read" ON storage.objects;
CREATE POLICY "chat_images_member_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-images'
    AND EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id::text = split_part(name, '/', 1)
        AND (
          t.driver_id = auth.uid()
          OR is_operator_member(auth.uid(), t.operator_id)
        )
    )
  );

DROP POLICY IF EXISTS "chat_images_member_write" ON storage.objects;
CREATE POLICY "chat_images_member_write"
  ON storage.objects FOR INSERT
  TO authenticated
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

CREATE OR REPLACE FUNCTION start_thread(p_location_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator UUID;
  v_thread UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT operator_id INTO v_operator FROM locations WHERE id = p_location_id AND published = true;
  IF v_operator IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  SELECT id INTO v_thread FROM chat_threads
   WHERE location_id = p_location_id AND driver_id = v_uid;
  IF v_thread IS NULL THEN
    INSERT INTO chat_threads (location_id, operator_id, driver_id, started_by)
    VALUES (p_location_id, v_operator, v_uid, 'driver')
    RETURNING id INTO v_thread;
  END IF;
  RETURN jsonb_build_object('success', true, 'thread_id', v_thread);
END;
$$;

CREATE OR REPLACE FUNCTION send_chat_message(p_thread_id UUID, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND driver_has_stay(v_thread.location_id, v_thread.driver_id)
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
$$;

CREATE OR REPLACE FUNCTION put_chat_image(p_thread_id UUID, p_filename TEXT)
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
  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES ('chat-images', v_path, v_uid, jsonb_build_object('source', 'put_chat_image'))
  ON CONFLICT (bucket_id, name) DO UPDATE SET updated_at = NOW();
  INSERT INTO chat_messages (thread_id, sender_id, kind, image_path, body)
  VALUES (p_thread_id, v_uid, 'image', v_path, 'Photo')
  RETURNING id INTO v_id;
  UPDATE chat_threads SET last_message_at = NOW() WHERE id = p_thread_id;
  RETURN jsonb_build_object('success', true, 'message_id', v_id, 'storage_path', v_path);
END;
$$;

-- System events for payment / waiver / extra fee (separate functions so
-- NEW.type is not referenced on payments rows).
CREATE OR REPLACE FUNCTION notify_payment_chat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folio RECORD;
BEGIN
  SELECT * INTO v_folio FROM folios WHERE id = NEW.folio_id;
  IF v_folio.session_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM post_system_chat_event(
    v_folio.location_id,
    (SELECT driver_id FROM parking_sessions WHERE id = v_folio.session_id),
    'Payment recorded',
    'payment_recorded',
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_charge_chat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folio RECORD;
BEGIN
  SELECT * INTO v_folio FROM folios WHERE id = NEW.folio_id;
  IF v_folio.session_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM post_system_chat_event(
    v_folio.location_id,
    (SELECT driver_id FROM parking_sessions WHERE id = v_folio.session_id),
    CASE
      WHEN NEW.type = 'waiver' THEN 'Balance waived'
      ELSE 'Fee added'
    END,
    CASE
      WHEN NEW.type = 'waiver' THEN 'waiver'
      ELSE 'fee_added'
    END,
    NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_payment_chat ON payments;
CREATE TRIGGER notify_payment_chat
AFTER INSERT ON payments
FOR EACH ROW EXECUTE FUNCTION notify_payment_chat();

DROP TRIGGER IF EXISTS notify_charge_chat ON folio_charges;
CREATE TRIGGER notify_charge_chat
AFTER INSERT ON folio_charges
FOR EACH ROW
WHEN (NEW.type IN ('waiver', 'additional_fee'))
EXECUTE FUNCTION notify_charge_chat();

-- Align session-close copy with the product language.
CREATE OR REPLACE FUNCTION create_session_chat_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM post_system_chat_event(NEW.location_id, NEW.driver_id, 'Session started', 'session_started', NEW.id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended' THEN
    PERFORM post_system_chat_event(NEW.location_id, NEW.driver_id, 'Session closed', 'session_closed', NEW.id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'overdue' AND OLD.status IS DISTINCT FROM 'overdue' THEN
    PERFORM post_system_chat_event(NEW.location_id, NEW.driver_id, 'Session is overdue', 'session_overdue', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION driver_has_stay(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION start_thread(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION send_chat_message(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION put_chat_image(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
