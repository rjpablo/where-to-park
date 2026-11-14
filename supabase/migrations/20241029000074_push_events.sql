-- 0074 Notification rows for the events rj picked (t176u). Each row is pushed by the 0072
-- trigger when its push_settings switch (0073) is on. Every row has type, ref_type, ref_id
-- and data.location_id / data.audience so a tap opens the right screen.
--
--  6  chat_message         chat_messages INSERT (people only, not system events) -> the
--                          other side: the driver, or the listing's staff. Not the sender.
--                          Burst control: no new row while the recipient still has an
--                          unread chat notification for that thread from the last 10 min;
--                          opening the thread (mark_thread_read) marks them read.
--  7  reservation_request  reservations -> status pending_approval -> listing staff
--  9  no_show              reservations -> status no_show -> listing staff + the driver
-- 10  report               reports INSERT on a listing -> listing owner(s) and managers
-- 11  listing_reviewed     locations verified / rejected -> listing owner(s)
-- 12  session_ending_soon  pg_cron `session-ending-soon` (every minute): active session with
--                          a linked driver whose End is within 30 min -> the driver, once
--                          per End time (an extension gets its own reminder)
-- 13  reservation_decision reservations -> confirmed / declined -> the driver
-- 16  staff_added          operator_members INSERT (manager / staff) -> the added person
--
-- 1, 2, 3, 4, 5 already create rows (0025, 0059, create_location).

-- ---------------------------------------------------------------------------
-- Recipient sets (server-only).
CREATE OR REPLACE FUNCTION public.listing_staff_ids(p_location_id UUID)
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT om.profile_id
    FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id
   WHERE l.id = p_location_id
     AND (om.role IN ('owner', 'manager') OR om.location_ids = '{}' OR l.id = ANY (om.location_ids));
$$;

CREATE OR REPLACE FUNCTION public.listing_manager_ids(p_location_id UUID, p_owners_only BOOLEAN DEFAULT FALSE)
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT om.profile_id
    FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id
   WHERE l.id = p_location_id
     AND (om.role = 'owner' OR (NOT p_owners_only AND om.role = 'manager'));
$$;
REVOKE ALL ON FUNCTION public.listing_staff_ids(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listing_manager_ids(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.manila_time(p_ts TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(p_ts AT TIME ZONE 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM') $$;

CREATE INDEX IF NOT EXISTS idx_notifications_ref ON public.notifications (ref_id, type);

-- ---------------------------------------------------------------------------
-- 6 Chat
CREATE OR REPLACE FUNCTION public.notify_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t chat_threads%ROWTYPE;
  v_loc TEXT;
  v_sender TEXT;
  v_preview TEXT;
BEGIN
  IF NEW.sender_id IS NULL OR NEW.kind = 'system' OR COALESCE(NEW.hidden, FALSE) THEN
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

  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
  SELECT r.id,
         'chat_message'::notification_type,
         CASE WHEN r.aud = 'driver' THEN 'New message from ' || COALESCE(v_loc, 'a listing')
              ELSE 'New message from ' || COALESCE(v_sender, 'a driver') || ' · ' || COALESCE(v_loc, '') END,
         v_preview,
         'chat_thread',
         t.id,
         CASE WHEN r.aud = 'driver'
              THEN jsonb_build_object('location_id', t.location_id, 'audience', 'driver')
              ELSE jsonb_build_object('location_id', t.location_id, 'driver_id', t.driver_id, 'audience', 'operator') END
    FROM (
      SELECT t.driver_id AS id, 'driver' AS aud WHERE NEW.sender_id <> t.driver_id
      UNION
      SELECT s, 'operator' FROM listing_staff_ids(t.location_id) s
       WHERE NEW.sender_id = t.driver_id AND s <> NEW.sender_id
    ) r
   WHERE r.id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM notifications n
        WHERE n.recipient_id = r.id AND n.type = 'chat_message' AND n.ref_id = t.id
          AND n.read_at IS NULL AND n.created_at > NOW() - INTERVAL '10 minutes'
     );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'chat notification failed for message %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_chat_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS chat_messages_notify ON public.chat_messages;
CREATE TRIGGER chat_messages_notify
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_chat_message();

-- Opening a thread also clears its chat notifications (so the Notifications count doesn't
-- stay up for messages already read, and the next message can notify again).
CREATE OR REPLACE FUNCTION public.mark_thread_read(p_thread_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  UPDATE chat_messages SET read_at = NOW()
  WHERE id IN (SELECT my_unread_messages(auth.uid(), p_thread_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE notifications SET read_at = NOW()
   WHERE recipient_id = auth.uid() AND type = 'chat_message' AND ref_id = p_thread_id
     AND read_at IS NULL;
  RETURN jsonb_build_object('success', true, 'marked', n);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7, 9, 13 Reservations (status changes on public.reservations)
CREATE OR REPLACE FUNCTION public.notify_reservation_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_loc TEXT;
  v_body TEXT;
  v_staff JSONB;
  v_driver JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  SELECT name INTO v_loc FROM locations WHERE id = NEW.location_id;
  v_body := COALESCE(v_loc, 'Listing') || ' · ' || manila_time(NEW.start_at);
  v_staff := jsonb_build_object('location_id', NEW.location_id, 'audience', 'operator');
  v_driver := jsonb_build_object('location_id', NEW.location_id, 'audience', 'driver');

  IF NEW.status = 'pending_approval' THEN
    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
    SELECT s, 'reservation_request', 'New reservation request', v_body, 'reservation', NEW.id, v_staff
      FROM listing_staff_ids(NEW.location_id) s
     WHERE s IS DISTINCT FROM NEW.driver_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('confirmed', 'declined') AND NEW.driver_id IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
    VALUES (NEW.driver_id, 'reservation_decision',
            CASE WHEN NEW.status = 'confirmed' THEN 'Reservation confirmed' ELSE 'Reservation declined' END,
            v_body, 'reservation', NEW.id, v_driver || jsonb_build_object('status', NEW.status));
  ELSIF NEW.status = 'no_show' THEN
    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
    SELECT s, 'no_show', 'No-show: reservation released', v_body, 'reservation', NEW.id, v_staff
      FROM listing_staff_ids(NEW.location_id) s
     WHERE s IS DISTINCT FROM NEW.driver_id;
    IF NEW.driver_id IS NOT NULL THEN
      INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
      VALUES (NEW.driver_id, 'no_show', 'Your reservation was released (no-show)', v_body,
              'reservation', NEW.id, v_driver);
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'reservation notification failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_reservation_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reservations_notify ON public.reservations;
CREATE TRIGGER reservations_notify
  AFTER INSERT OR UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.notify_reservation_status();

-- ---------------------------------------------------------------------------
-- 10 Driver reports a listing -> owner(s) and managers (the reporter isn't named)
CREATE OR REPLACE FUNCTION public.notify_listing_report()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_loc TEXT;
BEGIN
  IF NEW.target_type <> 'location' THEN
    RETURN NULL;
  END IF;
  SELECT name INTO v_loc FROM locations WHERE id = NEW.target_id;
  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
  SELECT m, 'report', 'Your listing was reported',
         COALESCE(v_loc, 'Listing') || ': "' || left(NEW.reason, 120) || '"',
         'location', NEW.target_id,
         jsonb_build_object('location_id', NEW.target_id, 'report_id', NEW.id, 'audience', 'operator')
    FROM listing_manager_ids(NEW.target_id) m
   WHERE m IS DISTINCT FROM NEW.reporter_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'report notification failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_listing_report() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reports_notify ON public.reports;
CREATE TRIGGER reports_notify
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_listing_report();

-- ---------------------------------------------------------------------------
-- 11 Listing verified / rejected -> owner(s)
CREATE OR REPLACE FUNCTION public.notify_listing_reviewed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
  v_outcome TEXT;
BEGIN
  IF NEW.verification_status = 'verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    v_outcome := 'verified';
    v_title := 'Listing verified';
    v_body := NEW.name || ' is now verified.';
  ELSIF NEW.rejected_at IS NOT NULL AND OLD.rejected_at IS NULL THEN
    v_outcome := 'rejected';
    v_title := 'Listing rejected';
    v_body := NEW.name || COALESCE(': ' || NEW.rejection_reason, ' was not approved.');
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
  SELECT o, 'listing_reviewed', v_title, v_body, 'location', NEW.id,
         jsonb_build_object('location_id', NEW.id, 'outcome', v_outcome, 'audience', 'operator')
    FROM listing_manager_ids(NEW.id, TRUE) o
   WHERE o IS DISTINCT FROM auth.uid();
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'listing review notification failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_listing_reviewed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS locations_notify_reviewed ON public.locations;
CREATE TRIGGER locations_notify_reviewed
  AFTER UPDATE OF verification_status, rejected_at ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.notify_listing_reviewed();

-- ---------------------------------------------------------------------------
-- 16 Added as staff / manager -> the added person (new memberships only; owners skipped)
CREATE OR REPLACE FUNCTION public.notify_staff_added()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_op TEXT;
  v_where TEXT;
BEGIN
  IF NEW.role = 'owner' OR NEW.profile_id IS NOT DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;
  SELECT NULLIF(btrim(display_name), '') INTO v_op FROM operators WHERE id = NEW.operator_id;
  IF COALESCE(NEW.location_ids, '{}') = '{}' THEN
    v_where := 'all listings';
  ELSE
    SELECT string_agg(name, ', ' ORDER BY name) INTO v_where
      FROM locations WHERE id = ANY (NEW.location_ids) AND deleted_at IS NULL;
  END IF;
  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
  VALUES (NEW.profile_id, 'staff_added',
          'You were added as ' || NEW.role::TEXT,
          COALESCE(v_op || ' · ', '') || COALESCE(v_where, 'all listings'),
          'operator', NEW.operator_id,
          jsonb_build_object('operator_id', NEW.operator_id, 'role', NEW.role, 'audience', 'operator'));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'staff notification failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_staff_added() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS operator_members_notify ON public.operator_members;
CREATE TRIGGER operator_members_notify
  AFTER INSERT ON public.operator_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_staff_added();

-- ---------------------------------------------------------------------------
-- 12 Session ending in 30 minutes -> the linked driver, once per End time
CREATE OR REPLACE FUNCTION public.notify_sessions_ending_soon()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
  SELECT s.driver_id,
         'session_ending_soon',
         'Parking ends in ' || GREATEST(1, CEIL(EXTRACT(EPOCH FROM (s.scheduled_end_at - NOW())) / 60))::INT || ' min',
         COALESCE(l.name, 'Your session') || ' · ends at ' || manila_time(s.scheduled_end_at),
         'session', s.id,
         jsonb_build_object('location_id', s.location_id, 'audience', 'driver',
                            'end_epoch', FLOOR(EXTRACT(EPOCH FROM s.scheduled_end_at))::BIGINT::TEXT)
    FROM parking_sessions s
    JOIN locations l ON l.id = s.location_id
   WHERE s.status = 'active'
     AND s.driver_id IS NOT NULL
     AND s.started_at <= NOW()
     AND s.scheduled_end_at > NOW()
     AND s.scheduled_end_at <= NOW() + INTERVAL '30 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM notifications x
        WHERE x.type = 'session_ending_soon' AND x.ref_id = s.id
          AND x.data->>'end_epoch' = FLOOR(EXTRACT(EPOCH FROM s.scheduled_end_at))::BIGINT::TEXT
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_sessions_ending_soon() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('session-ending-soon', '* * * * *',
  $cron$SELECT public.notify_sessions_ending_soon()$cron$);
