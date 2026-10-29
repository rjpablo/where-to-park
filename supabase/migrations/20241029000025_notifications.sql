-- In-app inbox + Expo push tokens. Session staff are notified on scheduled
-- end (overdue), manual end, and extend.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_ended';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_extended';

CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_profile ON push_tokens(profile_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push tokens" ON push_tokens;
CREATE POLICY "Users manage own push tokens"
  ON push_tokens FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE OR REPLACE FUNCTION register_push_token(p_token TEXT, p_platform TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  INSERT INTO push_tokens (token, profile_id, platform, updated_at)
  VALUES (btrim(p_token), auth.uid(), p_platform, NOW())
  ON CONFLICT (token) DO UPDATE
    SET profile_id = EXCLUDED.profile_id,
        platform = EXCLUDED.platform,
        updated_at = NOW();
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION notify_session_staff(
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
  v_tokens JSONB;
BEGIN
  SELECT s.id, s.location_id, s.plate, l.operator_id
  INTO v_session
  FROM parking_sessions s
  JOIN locations l ON l.id = s.location_id
  WHERE s.id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id)
  SELECT DISTINCT om.profile_id,
         p_type::notification_type,
         p_title,
         p_body,
         'session',
         p_session_id
  FROM operator_members om
  WHERE om.operator_id = v_session.operator_id
    AND (
      om.role IN ('owner', 'manager')
      OR om.location_ids = '{}'
      OR v_session.location_id = ANY (om.location_ids)
    );

  SELECT COALESCE(jsonb_agg(token), '[]'::JSONB) INTO v_tokens
  FROM push_tokens
  WHERE profile_id IN (
    SELECT om.profile_id
    FROM operator_members om
    WHERE om.operator_id = v_session.operator_id
      AND (
        om.role IN ('owner', 'manager')
        OR om.location_ids = '{}'
        OR v_session.location_id = ANY (om.location_ids)
      )
  );

  RETURN jsonb_build_object('success', true, 'push_tokens', v_tokens);
END;
$$;

CREATE OR REPLACE FUNCTION mark_notification_read(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications SET read_at = NOW()
  WHERE id = p_id AND recipient_id = auth.uid() AND read_at IS NULL;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION refresh_overdue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    UPDATE parking_sessions
    SET status = 'overdue',
        overdue_minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - scheduled_end_at)) / 60))
    WHERE status = 'active'
      AND scheduled_end_at IS NOT NULL
      AND scheduled_end_at < NOW()
    RETURNING id, plate
  LOOP
    n := n + 1;
    PERFORM notify_session_staff(
      r.id,
      'scheduled_end',
      'Scheduled end reached',
      COALESCE(r.plate, 'Session') || ' is overdue'
    );
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION end_session(
  p_session_id UUID,
  p_cash_amount NUMERIC DEFAULT NULL,
  p_waive_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_folio RECORD;
  v_balance NUMERIC;
  v_charges_total NUMERIC;
  v_paid_total NUMERIC;
  v_operator RECORD;
  v_can_waive BOOLEAN;
  v_amount NUMERIC;
  v_notify JSONB;
BEGIN
  SELECT * INTO v_session FROM parking_sessions WHERE id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;

  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id;
  IF v_folio IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_amount := session_parking_quote(p_session_id);

  IF NOT EXISTS (
    SELECT 1 FROM folio_charges
    WHERE folio_id = v_folio.id AND type = 'parking_fee' AND voided_at IS NULL
  ) THEN
    INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
    VALUES (v_folio.id, 'parking_fee', 'Parking fee', v_amount, auth.uid());
  END IF;

  IF p_cash_amount IS NOT NULL AND p_cash_amount > 0 THEN
    INSERT INTO payments (folio_id, amount, method, recorded_by)
    VALUES (v_folio.id, p_cash_amount, 'cash', auth.uid());
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_charges_total
  FROM folio_charges WHERE folio_id = v_folio.id AND voided_at IS NULL;

  SELECT COALESCE(SUM(
    CASE direction WHEN 'payment' THEN amount WHEN 'refund' THEN -amount END
  ), 0) INTO v_paid_total
  FROM payments WHERE folio_id = v_folio.id;

  v_balance := v_charges_total - v_paid_total;

  IF v_balance > 0.01 THEN
    IF p_waive_note IS NULL OR trim(p_waive_note) = '' THEN
      RETURN jsonb_build_object('error', 'waiver_note_required', 'balance', v_balance);
    END IF;

    SELECT o.*, om.role INTO v_operator
    FROM operators o
    JOIN operator_members om ON om.operator_id = o.id
    WHERE o.id = v_folio.operator_id
      AND om.profile_id = auth.uid()
    LIMIT 1;

    v_can_waive := (
      v_operator.role IN ('owner', 'manager') OR
      (v_operator.role = 'staff' AND v_operator.staff_can_waive = true)
    );

    IF NOT v_can_waive THEN
      RETURN jsonb_build_object('error', 'waiver_not_allowed');
    END IF;

    INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
    VALUES (v_folio.id, 'waiver', 'Waived balance', -v_balance, p_waive_note, auth.uid());
  END IF;

  UPDATE parking_sessions
  SET status = 'ended', ended_at = NOW(), ended_by = auth.uid()
  WHERE id = p_session_id;

  UPDATE folios SET status = 'settled' WHERE id = v_folio.id;

  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, v_session.status, 'ended', 'end_session', auth.uid());

  v_notify := notify_session_staff(
    p_session_id,
    'session_ended',
    'Session ended',
    COALESCE(v_session.plate, 'Session') || ' was closed'
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'final_balance', 0,
    'push_tokens', COALESCE(v_notify->'push_tokens', '[]'::JSONB)
  );
END;
$$;

CREATE OR REPLACE FUNCTION extend_session(
  p_session_id UUID,
  p_hours NUMERIC DEFAULT 1,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_session RECORD;
  v_new_end TIMESTAMPTZ;
  v_collision INTEGER;
  v_notify JSONB;
BEGIN
  SELECT s.*, l.operator_id INTO v_session
  FROM parking_sessions s
  JOIN locations l ON l.id = s.location_id
  WHERE s.id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_uid IS NULL OR NOT is_operator_member(v_uid, v_session.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_session.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'not_active');
  END IF;
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RETURN jsonb_build_object('error', 'hours_required');
  END IF;

  v_new_end := GREATEST(COALESCE(v_session.scheduled_end_at, NOW()), NOW())
    + (p_hours || ' hours')::INTERVAL;

  SELECT COUNT(*) INTO v_collision
  FROM reservations
  WHERE location_id = v_session.location_id
    AND status IN ('awaiting_payment', 'pending_approval', 'confirmed')
    AND start_at < v_new_end
    AND end_at > COALESCE(v_session.scheduled_end_at, NOW())
    AND (v_session.slot_id IS NULL OR slot_id = v_session.slot_id);

  IF v_collision > 0 THEN
    RETURN jsonb_build_object('error', 'reservation_collision');
  END IF;

  UPDATE parking_sessions
  SET scheduled_end_at = v_new_end,
      status = 'active',
      overdue_minutes = 0,
      override_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = p_session_id;

  INSERT INTO booking_events (session_id, from_status, to_status, action, actor, details)
  VALUES (
    p_session_id,
    v_session.status,
    'active',
    'extend_session',
    v_uid,
    jsonb_build_object('new_end', v_new_end, 'hours', p_hours, 'reason', p_reason)
  );

  PERFORM post_system_chat_event(
    v_session.location_id,
    v_session.driver_id,
    'Session extended',
    'session_extended',
    p_session_id
  );

  v_notify := notify_session_staff(
    p_session_id,
    'session_extended',
    'Session extended',
    COALESCE(v_session.plate, '') || ' extended by ' || p_hours || 'h'
  );

  RETURN jsonb_build_object(
    'success', true,
    'scheduled_end_at', v_new_end,
    'push_tokens', COALESCE(v_notify->'push_tokens', '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION register_push_token(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION notify_session_staff(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_notification_read(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_overdue() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

