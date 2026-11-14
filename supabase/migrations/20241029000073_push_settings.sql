-- 0073 Per-type push on/off (rj t176u: "Add an admin-only UI to turn on/off sending of
-- push notifications for each item").
--
-- push_settings has one row per notification type rj picked, plus scheduled_end (not
-- picked: off by default, kept as a switch). The 0072 trigger now pushes a notification
-- only when its type has a row here with enabled = true; any other type (fee_paid,
-- new_listing, approval_required, overdue) is never pushed. The in-app notifications row
-- is always created; only the push is skipped.
--
-- New notification types for the events added in 0074.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'listing_reviewed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_ending_soon';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reservation_decision';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'staff_added';

CREATE TABLE IF NOT EXISTS public.push_settings (
  type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.push_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_settings FROM anon, authenticated;
GRANT SELECT ON public.push_settings TO authenticated;
DROP POLICY IF EXISTS "Admins read push settings" ON public.push_settings;
CREATE POLICY "Admins read push settings"
  ON public.push_settings FOR SELECT
  USING (is_admin(auth.uid()));

-- rj's numbering (t176u) in sort_order. Existing rows keep their switch position.
INSERT INTO public.push_settings (type, label, description, enabled, sort_order) VALUES
  ('session_ended', 'Session ended', 'Listing staff, when a session is ended', TRUE, 1),
  ('session_extended', 'Session extended', 'Listing staff, when a session is extended', TRUE, 2),
  ('scheduled_end', 'Scheduled end reached (overdue)', 'Listing staff, when a session passes its End', FALSE, 3),
  ('verification_needed', 'New listing awaiting verification', 'Admins', TRUE, 4),
  ('contact_submission', 'New contact message', 'Admins', TRUE, 5),
  ('chat_message', 'New chat message', 'The driver, or the listing''s staff (at most one per thread every 10 minutes while unread)', TRUE, 6),
  ('reservation_request', 'Reservation request', 'Listing staff', TRUE, 7),
  ('no_show', 'No-show released', 'Listing staff and the driver', TRUE, 9),
  ('report', 'Driver reported a listing', 'Listing owner and managers', TRUE, 10),
  ('listing_reviewed', 'Listing verified or rejected', 'Listing owner', TRUE, 11),
  ('session_ending_soon', 'Session ending soon (30 min)', 'The driver linked to the session', TRUE, 12),
  ('reservation_decision', 'Reservation confirmed or declined', 'The driver', TRUE, 13),
  ('staff_added', 'Added as staff', 'The person added to a listing''s staff', TRUE, 16)
ON CONFLICT (type) DO NOTHING;

-- Admin list (also readable through RLS; the RPC gives the app one shape).
CREATE OR REPLACE FUNCTION public.admin_push_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  RETURN jsonb_build_object('items', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'type', type, 'label', label, 'description', description, 'enabled', enabled,
      'updated_at', updated_at) ORDER BY sort_order, type)
    FROM push_settings), '[]'::JSONB));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_push_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_push_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_push_setting(p_type TEXT, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('error', 'enabled_required');
  END IF;
  UPDATE push_settings
     SET enabled = p_enabled, updated_at = NOW(), updated_by = auth.uid()
   WHERE type = p_type;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true, 'type', p_type, 'enabled', p_enabled);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_push_setting(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_push_setting(TEXT, BOOLEAN) TO authenticated;

-- 0072's trigger, now gated on push_settings.
CREATE OR REPLACE FUNCTION public.push_dispatch_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM push_settings WHERE type = NEW.type::TEXT AND enabled)
     AND EXISTS (SELECT 1 FROM push_tokens WHERE profile_id = NEW.recipient_id) THEN
    PERFORM push_webhook_post(jsonb_build_object('notification_id', NEW.id));
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for notification %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.push_dispatch_notification() FROM PUBLIC, anon, authenticated;
