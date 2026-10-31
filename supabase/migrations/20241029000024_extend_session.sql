-- Dedicated Extend: move scheduled end forward after a reservation collision check.

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

  RETURN jsonb_build_object(
    'success', true,
    'scheduled_end_at', v_new_end
  );
END;
$$;

GRANT EXECUTE ON FUNCTION extend_session(UUID, NUMERIC, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
