-- Open/Full tracking mode: one toggle, pins show Open or Full.

CREATE OR REPLACE FUNCTION set_tracking_mode(
  p_location_id UUID,
  p_mode tracking_mode
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id
    WHERE l.id = p_location_id AND om.profile_id = v_uid
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_mode = 'slots' THEN
    RETURN jsonb_build_object('error', 'slots_phase_2');
  END IF;

  UPDATE locations
  SET tracking_mode = p_mode,
      open_status = CASE
        WHEN p_mode = 'open_full' THEN COALESCE(open_status, available_count > 0)
        ELSE open_status
      END,
      availability_updated_at = NOW()
  WHERE id = p_location_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, 'tracking_mode=' || p_mode::TEXT, v_uid);

  RETURN jsonb_build_object('success', true, 'tracking_mode', p_mode);
END;
$$;

CREATE OR REPLACE FUNCTION set_open_status(
  p_location_id UUID,
  p_open BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id
    WHERE l.id = p_location_id AND om.profile_id = v_uid
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE locations
  SET tracking_mode = 'open_full',
      open_status = p_open,
      availability_updated_at = NOW()
  WHERE id = p_location_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, CASE WHEN p_open THEN 'opened' ELSE 'filled' END, v_uid);

  RETURN jsonb_build_object('success', true, 'open_status', p_open);
END;
$$;

CREATE OR REPLACE FUNCTION claim_capacity(
  p_location_id UUID,
  p_slot_id UUID DEFAULT NULL,
  p_start_at TIMESTAMPTZ DEFAULT NOW(),
  p_end_at TIMESTAMPTZ DEFAULT NULL,
  p_kind TEXT DEFAULT 'session'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location RECORD;
  v_slot RECORD;
  v_overlapping INTEGER;
  v_available INTEGER;
BEGIN
  SELECT * INTO v_location FROM locations WHERE id = p_location_id FOR UPDATE;
  IF v_location IS NULL THEN
    RETURN jsonb_build_object('error', 'Location not found');
  END IF;

  IF v_location.tracking_mode = 'open_full' THEN
    IF v_location.open_status IS TRUE THEN
      RETURN jsonb_build_object('success', true, 'open_status', true);
    END IF;
    RETURN jsonb_build_object('error', 'no_longer_available');
  END IF;

  IF v_location.tracking_mode = 'count' THEN
    SELECT COUNT(*) INTO v_overlapping
    FROM (
      SELECT 1 FROM reservations
      WHERE location_id = p_location_id
      AND status IN ('awaiting_payment', 'pending_approval', 'confirmed')
      AND (p_end_at IS NULL OR start_at < p_end_at)
      AND (end_at > p_start_at OR end_at IS NULL)
      UNION ALL
      SELECT 1 FROM parking_sessions
      WHERE location_id = p_location_id
      AND status IN ('active', 'overdue')
      AND (p_end_at IS NULL OR started_at < p_end_at)
      AND (ended_at IS NULL OR ended_at > p_start_at)
    ) AS sub;

    v_available := v_location.capacity - v_overlapping - v_location.manual_reserved_count - v_location.unavailable_count;
    IF v_available < 1 THEN
      RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available);
    END IF;
    RETURN jsonb_build_object('success', true, 'available', v_available);
  END IF;

  IF v_location.tracking_mode = 'slots' AND p_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot FROM slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot IS NULL OR v_slot.state != 'available' THEN
      RETURN jsonb_build_object('error', 'no_longer_available');
    END IF;
    SELECT COUNT(*) INTO v_overlapping
    FROM (
      SELECT 1 FROM reservations
      WHERE slot_id = p_slot_id
      AND status IN ('awaiting_payment', 'pending_approval', 'confirmed')
      AND (p_end_at IS NULL OR start_at < p_end_at)
      AND (end_at > p_start_at OR end_at IS NULL)
      UNION ALL
      SELECT 1 FROM parking_sessions
      WHERE slot_id = p_slot_id
      AND status IN ('active', 'overdue')
      AND (p_end_at IS NULL OR started_at < p_end_at)
      AND (ended_at IS NULL OR ended_at > p_start_at)
    ) AS sub;
    IF v_overlapping > 0 THEN
      RETURN jsonb_build_object('error', 'no_longer_available');
    END IF;
    RETURN jsonb_build_object('success', true, 'slot_id', p_slot_id);
  END IF;

  RETURN jsonb_build_object('error', 'Invalid tracking mode or missing slot');
END;
$$;

GRANT EXECUTE ON FUNCTION set_tracking_mode(UUID, tracking_mode) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_open_status(UUID, BOOLEAN) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
