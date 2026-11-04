CREATE OR REPLACE FUNCTION upsert_vehicle(
  p_nickname TEXT,
  p_vehicle_type vehicle_type,
  p_plate TEXT DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_is_default BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_nickname IS NULL OR btrim(p_nickname) = '' THEN
    RETURN jsonb_build_object('error', 'nickname_required');
  END IF;

  IF p_vehicle_id IS NULL THEN
    INSERT INTO vehicles (driver_id, nickname, plate, vehicle_type, is_default)
    VALUES (v_uid, btrim(p_nickname), NULLIF(btrim(COALESCE(p_plate, '')), ''), p_vehicle_type, COALESCE(p_is_default, false))
    RETURNING id INTO v_id;
  ELSE
    UPDATE vehicles
    SET nickname = btrim(p_nickname),
        plate = NULLIF(btrim(COALESCE(p_plate, '')), ''),
        vehicle_type = p_vehicle_type,
        is_default = CASE WHEN p_is_default THEN true ELSE is_default END
    WHERE id = p_vehicle_id AND driver_id = v_uid
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'vehicle_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION set_default_vehicle(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  UPDATE vehicles SET is_default = false WHERE driver_id = v_uid;
  UPDATE vehicles SET is_default = true WHERE id = p_vehicle_id AND driver_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_vehicle(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vehicles WHERE id = p_vehicle_id AND driver_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_vehicle(TEXT, vehicle_type, TEXT, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_default_vehicle(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_vehicle(UUID) TO authenticated, service_role;
