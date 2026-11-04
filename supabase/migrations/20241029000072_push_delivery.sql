-- 0072 Push delivery (rj t173u).
--
-- Every row inserted into notifications is pushed to the recipient's devices:
--   AFTER INSERT trigger -> pg_net POST -> Edge Function `send-push` -> Expo push API -> FCM V1.
-- The function URL and a shared webhook secret live in Supabase Vault
-- (`push_function_url`, `push_webhook_secret`); the same secret is the function secret
-- PUSH_WEBHOOK_SECRET. No values are stored in this file. If either Vault secret is
-- missing the trigger does nothing, so the in-app inbox keeps working without push.
--
-- Also:
-- * push_tickets: Expo ticket ids waiting for a receipt; a pg_cron job asks send-push to
--   read the receipts and delete tokens Expo reports as DeviceNotRegistered.
-- * pg_cron `refresh-overdue` runs refresh_overdue() every minute, so "Scheduled end
--   reached" notifications (and their push) fire on time instead of only when staff open
--   Active Sessions.
-- * notify_session_staff no longer hands push tokens back to the app (the app used to send
--   the push itself); it returns an empty push_tokens list so older builds send nothing
--   and nobody gets the same push twice.
-- * unregister_push_token(token): sign-out / account switch removes this device's token.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- Tickets waiting for an Expo push receipt (server-only; RLS on, no policies).
CREATE TABLE IF NOT EXISTS public.push_tickets (
  ticket_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  notification_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_tickets_created ON public.push_tickets(created_at);
ALTER TABLE public.push_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tickets FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- POST a JSON body to send-push with the webhook secret (no-op without Vault config).
CREATE OR REPLACE FUNCTION public.push_webhook_post(p_body JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'push_function_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := v_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.push_webhook_post(JSONB) FROM PUBLIC, anon, authenticated;

-- AFTER INSERT on notifications: queue one push request per row whose recipient has a
-- token. pg_net sends it after the transaction commits; a failure here never blocks the
-- insert.
CREATE OR REPLACE FUNCTION public.push_dispatch_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM push_tokens WHERE profile_id = NEW.recipient_id) THEN
    PERFORM push_webhook_post(jsonb_build_object('notification_id', NEW.id));
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for notification %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.push_dispatch_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notifications_push ON public.notifications;
CREATE TRIGGER notifications_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_dispatch_notification();

-- ---------------------------------------------------------------------------
-- Sign-out / account switch: drop this device's token (own tokens only).
CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  DELETE FROM push_tokens WHERE token = btrim(p_token) AND profile_id = auth.uid();
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.unregister_push_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Staff notifications: inbox rows only; the trigger above pushes them. push_tokens stays
-- in the result (always empty) so older app builds don't break or send a second push.
CREATE OR REPLACE FUNCTION public.notify_session_staff(
  p_session_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
BEGIN
  SELECT s.id, s.location_id, s.plate, l.operator_id
  INTO v_session
  FROM parking_sessions s
  JOIN locations l ON l.id = s.location_id
  WHERE s.id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
  SELECT DISTINCT om.profile_id,
         p_type::notification_type,
         p_title,
         p_body,
         'session',
         p_session_id,
         jsonb_build_object('location_id', v_session.location_id)
  FROM operator_members om
  WHERE om.operator_id = v_session.operator_id
    AND (
      om.role IN ('owner', 'manager')
      OR om.location_ids = '{}'
      OR v_session.location_id = ANY (om.location_ids)
    );

  RETURN jsonb_build_object('success', true, 'push_tokens', '[]'::JSONB);
END;
$$;

-- ---------------------------------------------------------------------------
-- pg_cron: overdue sweep every minute; push receipts every 15 minutes.
SELECT cron.schedule('refresh-overdue', '* * * * *', $cron$SELECT public.refresh_overdue()$cron$);
SELECT cron.schedule(
  'push-receipts',
  '*/15 * * * *',
  $cron$SELECT public.push_webhook_post('{"action":"receipts"}'::jsonb)$cron$
);
