-- A free listing still needs the one default rate every location must have.
-- It is an hourly rate of 0. Location details does not show it; the page says Free instead.

CREATE OR REPLACE FUNCTION public.set_listing_free(p_location_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_operator uuid;
  v_enabled boolean := COALESCE(p_enabled, false);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT operator_id INTO v_operator FROM locations WHERE id = p_location_id AND deleted_at IS NULL;
  IF v_operator IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  UPDATE locations SET is_free = v_enabled WHERE id = p_location_id;
  -- Turning a listing free must not leave it without a default rate.
  IF v_enabled AND NOT EXISTS (
    SELECT 1 FROM rates WHERE location_id = p_location_id AND is_default
  ) THEN
    INSERT INTO rates (location_id, is_default, name, rate_type, hourly_amount, active)
    VALUES (p_location_id, true, 'Free', 'hourly', 0, true);
  END IF;
  RETURN jsonb_build_object('success', true, 'is_free', v_enabled);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_location(
  p_name TEXT,
  p_address TEXT,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_capacity INTEGER,
  p_hourly_amount NUMERIC,
  p_listing_type listing_type DEFAULT 'commercial',
  p_rules TEXT DEFAULT NULL,
  p_operator_id UUID DEFAULT NULL,
  p_operator_name TEXT DEFAULT NULL,
  p_is_free BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_location_id UUID;
  v_rate_id UUID;
  v_free boolean := COALESCE(p_is_free, false);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' OR p_address IS NULL OR btrim(p_address) = '' THEN
    RETURN jsonb_build_object('error', 'name_and_address_required');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('error', 'pin_required');
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RETURN jsonb_build_object('error', 'capacity_required');
  END IF;
  IF NOT v_free AND (p_hourly_amount IS NULL OR p_hourly_amount < 0) THEN
    RETURN jsonb_build_object('error', 'rate_required');
  END IF;

  v_operator_id := p_operator_id;
  IF v_operator_id IS NOT NULL THEN
    IF NOT is_operator_admin(v_uid, v_operator_id) THEN
      RETURN jsonb_build_object('error', 'Permission denied');
    END IF;
  ELSE
    SELECT om.operator_id
      INTO v_operator_id
      FROM operator_members om
     WHERE om.profile_id = v_uid
       AND om.role IN ('owner', 'manager')
     ORDER BY om.created_at
     LIMIT 1;

    IF v_operator_id IS NULL THEN
      INSERT INTO operators (display_name, status)
      VALUES (COALESCE(NULLIF(btrim(p_operator_name), ''), btrim(p_name)), 'active')
      RETURNING id INTO v_operator_id;

      INSERT INTO operator_members (operator_id, profile_id, role)
      VALUES (v_operator_id, v_uid, 'owner');
    END IF;
  END IF;

  INSERT INTO locations (
    operator_id, name, listing_type, geog, address, rules,
    tracking_mode, capacity, available_count, published, verification_status, is_free
  ) VALUES (
    v_operator_id,
    btrim(p_name),
    COALESCE(p_listing_type, 'commercial'),
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY,
    btrim(p_address),
    NULLIF(btrim(COALESCE(p_rules, '')), ''),
    'count',
    p_capacity,
    p_capacity,
    true,
    'unverified',
    v_free
  ) RETURNING id INTO v_location_id;

  INSERT INTO rates (location_id, is_default, name, rate_type, hourly_amount, active)
  VALUES (
    v_location_id,
    true,
    CASE WHEN v_free THEN 'Free' ELSE 'Standard Rate' END,
    'hourly',
    CASE WHEN v_free THEN 0 ELSE p_hourly_amount END,
    true
  )
  RETURNING id INTO v_rate_id;

  INSERT INTO location_policies (location_id) VALUES (v_location_id);

  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id)
  SELECT id, 'verification_needed', 'New listing pending verification', btrim(p_name), 'location', v_location_id
  FROM profiles
  WHERE is_admin = true;

  RETURN jsonb_build_object(
    'success', true,
    'location_id', v_location_id,
    'operator_id', v_operator_id,
    'rate_id', v_rate_id,
    'is_free', v_free
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
