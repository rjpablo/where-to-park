-- A new listing stays hidden until an admin publishes it. Publishing does not
-- verify it. Verifying still publishes, so a verified listing is not left hidden.
-- Admins can open an unpublished listing (and its photos, rates and areas) to review it.

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
    false,
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

CREATE OR REPLACE FUNCTION public.publish_location(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE locations
  SET published = true
  WHERE id = p_location_id
    AND deleted_at IS NULL
    AND verification_status = 'unverified'
    AND rejected_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_pending');
  END IF;
  RETURN jsonb_build_object('success', true, 'published', true, 'verification_status', 'unverified');
END;
$$;

REVOKE ALL ON FUNCTION public.publish_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_location(uuid) TO authenticated, service_role;

-- Verifying a hidden listing also publishes it. It still does not run for a
-- publish-only action.
CREATE OR REPLACE FUNCTION public.verify_location(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE locations
  SET
    verification_status = 'verified',
    verified_by = auth.uid(),
    verified_at = NOW(),
    published = true,
    rejected_at = NULL,
    rejected_by = NULL,
    rejection_reason = NULL
  WHERE id = p_location_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

DROP POLICY IF EXISTS "Admins can view all locations" ON locations;
CREATE POLICY "Admins can view all locations"
  ON locations FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view listing photos" ON location_photos;
CREATE POLICY "Admins can view listing photos"
  ON location_photos FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view listing rates" ON rates;
CREATE POLICY "Admins can view listing rates"
  ON rates FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view listing areas" ON areas;
CREATE POLICY "Admins can view listing areas"
  ON areas FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view listing policies" ON location_policies;
CREATE POLICY "Admins can view listing policies"
  ON location_policies FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';
