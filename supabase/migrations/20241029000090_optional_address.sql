-- Address is optional. A blank address is stored from the pin coordinates.
-- The app fills a place name from the pin before calling these functions when it can.

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
  v_address text;
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

CREATE OR REPLACE FUNCTION update_location(
  p_location_id uuid,
  p_name text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text,
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric,
  p_capacity integer DEFAULT NULL::integer,
  p_rules text DEFAULT NULL::text,
  p_listing_type listing_type DEFAULT NULL::listing_type,
  p_hours text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_geog GEOGRAPHY;
  v_main areas%ROWTYPE;
  v_in_use integer;
  v_address text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_geog := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY;
  END IF;
  IF p_capacity IS NOT NULL AND p_capacity >= 1 THEN
    SELECT * INTO v_main FROM areas WHERE location_id = p_location_id AND is_main FOR UPDATE;
    v_in_use := area_occupied_spaces(v_main.id) + v_main.manual_reserved_count + v_main.unavailable_count;
    IF v_main.monitored AND p_capacity < v_in_use THEN
      RETURN jsonb_build_object('error', 'capacity_below_in_use', 'in_use', v_in_use);
    END IF;
    UPDATE areas SET capacity = p_capacity WHERE id = v_main.id;
  END IF;

  -- Null leaves the saved address. Blank means "derive from the pin".
  IF p_address IS NULL THEN
    v_address := NULL;
  ELSIF btrim(p_address) = '' AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_address := trim(to_char(p_lat, 'FM999990.00000')) || ', ' || trim(to_char(p_lng, 'FM999990.00000'));
  ELSE
    v_address := NULLIF(btrim(p_address), '');
  END IF;

  UPDATE locations
  SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    address = COALESCE(v_address, address),
    geog = COALESCE(v_geog, geog),
    rules = CASE WHEN p_rules IS NULL THEN rules ELSE NULLIF(btrim(p_rules), '') END,
    listing_type = COALESCE(p_listing_type, listing_type),
    hours = CASE WHEN p_hours IS NULL THEN hours ELSE NULLIF(btrim(p_hours), '') END
  WHERE id = p_location_id;
  RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$function$;

NOTIFY pgrst, 'reload schema';
