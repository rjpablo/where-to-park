-- Tracking spots uses the existing area monitored flag. The capacity number
-- is stored either way. Monitored off means drivers see Available or Full
-- and the number is kept for when monitoring is turned back on.

DROP FUNCTION IF EXISTS public.create_location(text, text, numeric, numeric, integer, numeric, listing_type, text, uuid, text, boolean);

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
  p_is_free BOOLEAN DEFAULT false,
  p_monitored BOOLEAN DEFAULT true
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
  v_monitored boolean := COALESCE(p_monitored, true);
  v_address text;
  v_capacity integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
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

  v_address := NULLIF(btrim(COALESCE(p_address, '')), '');
  IF v_address IS NULL THEN
    v_address := trim(to_char(p_lat, 'FM999990.00000')) || ', ' || trim(to_char(p_lng, 'FM999990.00000'));
  END IF;

  v_capacity := p_capacity;

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
    v_address,
    NULLIF(btrim(COALESCE(p_rules, '')), ''),
    'count',
    v_capacity,
    v_capacity,
    false,
    'unverified',
    v_free
  ) RETURNING id INTO v_location_id;

  IF NOT v_monitored THEN
    UPDATE areas
       SET monitored = false
     WHERE location_id = v_location_id
       AND is_main;
  END IF;

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

REVOKE ALL ON FUNCTION public.create_location(text, text, numeric, numeric, integer, numeric, listing_type, text, uuid, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_location(text, text, numeric, numeric, integer, numeric, listing_type, text, uuid, text, boolean, boolean) TO authenticated, service_role;
