-- Manual Reserved/Unavailable through the same locked location row as claim_capacity.

CREATE OR REPLACE FUNCTION set_manual_counts(
  p_location_id UUID,
  p_reserved INTEGER DEFAULT NULL,
  p_unavailable INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_location RECORD;
  v_reserved INTEGER;
  v_unavailable INTEGER;
  v_occupied INTEGER;
  v_available INTEGER;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id
    WHERE l.id = p_location_id AND om.profile_id = v_uid
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  SELECT * INTO v_location FROM locations WHERE id = p_location_id FOR UPDATE;
  IF v_location IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_reserved := GREATEST(0, COALESCE(p_reserved, v_location.manual_reserved_count));
  v_unavailable := GREATEST(0, COALESCE(p_unavailable, v_location.unavailable_count));

  SELECT COUNT(*) INTO v_occupied
  FROM parking_sessions
  WHERE location_id = p_location_id AND status IN ('active', 'overdue');

  v_available := v_location.capacity - v_occupied - v_reserved - v_unavailable;
  IF v_available < 0 THEN
    RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available);
  END IF;

  UPDATE locations
  SET manual_reserved_count = v_reserved,
      unavailable_count = v_unavailable,
      available_count = v_available,
      availability_updated_at = NOW()
  WHERE id = p_location_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (
    p_location_id,
    'manual_reserved=' || v_reserved || ',unavailable=' || v_unavailable,
    v_uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'available_count', v_available,
    'manual_reserved_count', v_reserved,
    'unavailable_count', v_unavailable
  );
END;
$$;

GRANT EXECUTE ON FUNCTION set_manual_counts(UUID, INTEGER, INTEGER) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
