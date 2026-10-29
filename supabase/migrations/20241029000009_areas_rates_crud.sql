-- Areas and rates CRUD. Default rate cannot be deleted.

CREATE POLICY "Operators can manage areas"
  ON areas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id
      WHERE l.id = areas.location_id
        AND om.profile_id = auth.uid()
        AND om.role IN ('owner', 'manager')
    )
  );

CREATE OR REPLACE FUNCTION upsert_area(
  p_location_id UUID,
  p_name TEXT,
  p_area_id UUID DEFAULT NULL,
  p_sort_order INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_area_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  IF p_area_id IS NULL THEN
    INSERT INTO areas (location_id, name, sort_order)
    VALUES (p_location_id, btrim(p_name), COALESCE(p_sort_order, 0))
    RETURNING id INTO v_area_id;
  ELSE
    UPDATE areas
    SET name = btrim(p_name), sort_order = COALESCE(p_sort_order, sort_order)
    WHERE id = p_area_id AND location_id = p_location_id
    RETURNING id INTO v_area_id;
    IF v_area_id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'area_id', v_area_id);
END;
$$;

CREATE OR REPLACE FUNCTION delete_area(p_area_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
BEGIN
  SELECT l.operator_id INTO v_operator_id
  FROM areas a
  JOIN locations l ON l.id = a.location_id
  WHERE a.id = p_area_id;

  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  DELETE FROM areas WHERE id = p_area_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_rate(
  p_location_id UUID,
  p_name TEXT,
  p_rate_type rate_type,
  p_rate_id UUID DEFAULT NULL,
  p_is_default BOOLEAN DEFAULT FALSE,
  p_hourly_amount NUMERIC DEFAULT NULL,
  p_daily_amount NUMERIC DEFAULT NULL,
  p_monthly_amount NUMERIC DEFAULT NULL,
  p_first_hours INTEGER DEFAULT NULL,
  p_first_amount NUMERIC DEFAULT NULL,
  p_succeeding_hourly_amount NUMERIC DEFAULT NULL,
  p_max_per_day NUMERIC DEFAULT NULL,
  p_area_id UUID DEFAULT NULL,
  p_effective_from TIMESTAMPTZ DEFAULT NULL,
  p_effective_to TIMESTAMPTZ DEFAULT NULL,
  p_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_rate_id UUID;
  v_is_default BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  -- Validate fields per type
  IF p_rate_type = 'hourly' AND (p_hourly_amount IS NULL OR p_hourly_amount < 0) THEN
    RETURN jsonb_build_object('error', 'hourly_amount_required');
  END IF;
  IF p_rate_type = 'daily' AND (p_daily_amount IS NULL OR p_daily_amount < 0) THEN
    RETURN jsonb_build_object('error', 'daily_amount_required');
  END IF;
  IF p_rate_type = 'monthly' AND (p_monthly_amount IS NULL OR p_monthly_amount < 0) THEN
    RETURN jsonb_build_object('error', 'monthly_amount_required');
  END IF;
  IF p_rate_type = 'flat_then_hourly' AND (
    p_first_hours IS NULL OR p_first_hours < 1
    OR p_first_amount IS NULL OR p_succeeding_hourly_amount IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'flat_then_hourly_fields_required');
  END IF;

  v_is_default := COALESCE(p_is_default, false);
  IF v_is_default THEN
    UPDATE rates SET is_default = false
    WHERE location_id = p_location_id
      AND is_default = true
      AND (p_rate_id IS NULL OR id <> p_rate_id);
  END IF;

  IF p_rate_id IS NULL THEN
    INSERT INTO rates (
      location_id, is_default, name, rate_type,
      hourly_amount, daily_amount, monthly_amount,
      first_hours, first_amount, succeeding_hourly_amount, max_per_day,
      area_id, effective_from, effective_to, active
    ) VALUES (
      p_location_id, v_is_default, btrim(p_name), p_rate_type,
      p_hourly_amount, p_daily_amount, p_monthly_amount,
      p_first_hours, p_first_amount, p_succeeding_hourly_amount, p_max_per_day,
      p_area_id, p_effective_from, p_effective_to, COALESCE(p_active, true)
    ) RETURNING id INTO v_rate_id;
  ELSE
    UPDATE rates
    SET
      name = btrim(p_name),
      rate_type = p_rate_type,
      is_default = CASE WHEN is_default THEN true ELSE v_is_default END,
      hourly_amount = p_hourly_amount,
      daily_amount = p_daily_amount,
      monthly_amount = p_monthly_amount,
      first_hours = p_first_hours,
      first_amount = p_first_amount,
      succeeding_hourly_amount = p_succeeding_hourly_amount,
      max_per_day = p_max_per_day,
      area_id = p_area_id,
      effective_from = p_effective_from,
      effective_to = p_effective_to,
      active = COALESCE(p_active, active)
    WHERE id = p_rate_id AND location_id = p_location_id
    RETURNING id INTO v_rate_id;
    IF v_rate_id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'rate_id', v_rate_id);
END;
$$;

CREATE OR REPLACE FUNCTION delete_rate(p_rate_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rate RECORD;
BEGIN
  SELECT r.*, l.operator_id
    INTO v_rate
    FROM rates r
    JOIN locations l ON l.id = r.location_id
   WHERE r.id = p_rate_id;

  IF v_rate IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_rate.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_rate.is_default THEN
    RETURN jsonb_build_object('error', 'cannot_delete_default');
  END IF;

  DELETE FROM rates WHERE id = p_rate_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_area(UUID, TEXT, UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_area(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION upsert_rate(UUID, TEXT, rate_type, UUID, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_rate(UUID) TO authenticated, service_role;
