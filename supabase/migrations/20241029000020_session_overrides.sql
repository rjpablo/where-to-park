-- Start/end time overrides, amount-due edit, overdue flag.

CREATE OR REPLACE FUNCTION override_session_start(
  p_session_id UUID,
  p_started_at TIMESTAMPTZ,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_session RECORD;
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
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'reason_required');
  END IF;
  UPDATE parking_sessions
  SET started_at = p_started_at,
      start_overridden_by = v_uid,
      override_reason = btrim(p_reason)
  WHERE id = p_session_id;
  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'override_start', v_uid, jsonb_build_object('started_at', p_started_at, 'reason', p_reason));
  RETURN jsonb_build_object('success', true, 'parking_so_far', session_parking_quote(p_session_id));
END;
$$;

CREATE OR REPLACE FUNCTION override_session_end(
  p_session_id UUID,
  p_ended_at TIMESTAMPTZ,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_session RECORD;
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
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'reason_required');
  END IF;
  UPDATE parking_sessions
  SET billed_end_at = p_ended_at,
      scheduled_end_at = p_ended_at,
      end_overridden_by = v_uid,
      override_reason = btrim(p_reason)
  WHERE id = p_session_id;
  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'override_end', v_uid, jsonb_build_object('ended_at', p_ended_at, 'reason', p_reason));
  RETURN jsonb_build_object('success', true, 'parking_so_far', session_parking_quote(p_session_id));
END;
$$;

CREATE OR REPLACE FUNCTION edit_amount_due(
  p_session_id UUID,
  p_amount NUMERIC,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_session RECORD;
  v_folio UUID;
  v_current NUMERIC;
  v_delta NUMERIC;
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
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'reason_required');
  END IF;
  SELECT id INTO v_folio FROM folios WHERE session_id = p_session_id;
  v_current := session_parking_quote(p_session_id)
    + COALESCE((SELECT SUM(amount) FROM folio_charges WHERE folio_id = v_folio AND type IN ('additional_fee', 'adjustment') AND voided_at IS NULL), 0);
  v_delta := p_amount - v_current;
  INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
  VALUES (v_folio, 'adjustment', 'Amount due edit', v_delta, btrim(p_reason), v_uid);
  UPDATE parking_sessions
  SET amount_due_override = p_amount, override_reason = btrim(p_reason)
  WHERE id = p_session_id;
  RETURN jsonb_build_object('success', true, 'delta', v_delta, 'amount_due', p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION refresh_overdue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE parking_sessions
  SET status = 'overdue',
      overdue_minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - scheduled_end_at)) / 60))
  WHERE status = 'active'
    AND scheduled_end_at IS NOT NULL
    AND scheduled_end_at < NOW();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION override_session_start(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION override_session_end(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION edit_amount_due(UUID, NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_overdue() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
