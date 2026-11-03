-- 0081 New chat messages: push only, no in-app notification (rj t180u: "Don't generate
-- notifications for messages. We already have push notifications for it and the actual
-- message").
--
-- Before: chat_messages_notify inserted a notifications row (type chat_message) and the
-- notifications_push trigger (0072) sent it to send-push. Now the chat trigger posts the
-- push straight to send-push (pg_net) with the same title, body and tap data (opens the
-- chat), and writes no notifications row. Same rules as before:
--   * recipients: driver writes -> listing staff (listing_staff_ids); staff write -> the
--     driver; never the sender; not system events or hidden messages;
--   * admin switch: push_settings 'chat_message' (Admin > Push notifications);
--   * throttle: no new push while the recipient already has an unread message in that
--     thread from the last 10 minutes (was: an unread chat notification from <10 min).
-- Messages still show in Messages with their own unread badges (my_unread_messages).

CREATE OR REPLACE FUNCTION public.notify_chat_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t chat_threads%ROWTYPE;
  v_loc TEXT;
  v_sender TEXT;
  v_preview TEXT;
  r RECORD;
BEGIN
  IF NEW.sender_id IS NULL OR NEW.kind = 'system' OR COALESCE(NEW.hidden, FALSE) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM push_settings WHERE type = 'chat_message' AND enabled) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO t FROM chat_threads WHERE id = NEW.thread_id;
  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT name INTO v_loc FROM locations WHERE id = t.location_id;
  SELECT NULLIF(btrim(display_name), '') INTO v_sender FROM profiles WHERE id = NEW.sender_id;
  v_preview := CASE WHEN NEW.kind = 'image' THEN '📷 Photo'
                    ELSE left(regexp_replace(COALESCE(NEW.body, ''), '\s+', ' ', 'g'), 140) END;

  FOR r IN
    SELECT x.id, x.aud FROM (
      SELECT t.driver_id AS id, 'driver' AS aud WHERE NEW.sender_id <> t.driver_id
      UNION
      SELECT s, 'operator' FROM listing_staff_ids(t.location_id) s
       WHERE NEW.sender_id = t.driver_id AND s <> NEW.sender_id
    ) x
    WHERE x.id IS NOT NULL
      AND EXISTS (SELECT 1 FROM push_tokens pt WHERE pt.profile_id = x.id)
      AND NOT EXISTS (
        SELECT 1 FROM chat_messages m
         WHERE m.id IN (SELECT my_unread_messages(x.id, t.id))
           AND m.id <> NEW.id AND m.created_at > NOW() - INTERVAL '10 minutes')
  LOOP
    PERFORM push_webhook_post(jsonb_build_object('push', jsonb_build_object(
      'recipient_id', r.id,
      'type', 'chat_message',
      'title', CASE WHEN r.aud = 'driver' THEN 'New message from ' || COALESCE(v_loc, 'a listing')
                    ELSE 'New message from ' || COALESCE(v_sender, 'a driver') || ' · ' || COALESCE(v_loc, '') END,
      'body', v_preview,
      'ref_type', 'chat_thread',
      'ref_id', t.id,
      'data', CASE WHEN r.aud = 'driver'
                   THEN jsonb_build_object('location_id', t.location_id, 'audience', 'driver')
                   ELSE jsonb_build_object('location_id', t.location_id, 'driver_id', t.driver_id,
                                           'audience', 'operator') END)));
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'chat push failed for message %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_chat_message() FROM PUBLIC, anon, authenticated;

-- Nothing else may create chat_message notifications either (e.g. the optional `notify`
-- Edge Function): such rows are dropped silently.
CREATE OR REPLACE FUNCTION public.drop_chat_message_notification()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type = 'chat_message' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.drop_chat_message_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notifications_no_chat ON public.notifications;
CREATE TRIGGER notifications_no_chat BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.drop_chat_message_notification();

-- Opening a thread only marks its messages read now (no chat notifications to clear).
CREATE OR REPLACE FUNCTION public.mark_thread_read(p_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  UPDATE chat_messages SET read_at = NOW()
  WHERE id IN (SELECT my_unread_messages(auth.uid(), p_thread_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'marked', n);
END;
$$;

-- Old chat notifications leave the Notifications list and its unread counts.
DELETE FROM public.notifications WHERE type = 'chat_message';

-- Admin › Push notifications: chat is push-only, so its switch turns it off completely.
UPDATE public.push_settings
   SET description = 'The driver, or the listing''s staff (at most one per thread every 10 minutes while unread). Push only: messages are not added to Notifications, so off = no alert at all (the message is still in Messages)'
 WHERE type = 'chat_message';
