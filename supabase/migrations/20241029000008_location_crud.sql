-- Operator location create/edit RPCs, photo registration, and
-- storage.buckets location-photos with RLS:
--   public SELECT, operator members INSERT/UPDATE/DELETE.

CREATE OR REPLACE FUNCTION storage_location_id_from_path(object_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN NULLIF(split_part(object_name, '/', 1), '')::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION is_location_operator_member(p_location_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id
    WHERE l.id = p_location_id
      AND om.profile_id = p_user_id
  );
END;
$$;

INSERT INTO storage.buckets (id, name)
VALUES ('location-photos', 'location-photos')
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "location_photos_public_read" ON storage.objects;
CREATE POLICY "location_photos_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'location-photos');

DROP POLICY IF EXISTS "location_photos_member_insert" ON storage.objects;
CREATE POLICY "location_photos_member_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'location-photos'
    AND is_location_operator_member(storage_location_id_from_path(name), auth.uid())
  );

DROP POLICY IF EXISTS "location_photos_member_update" ON storage.objects;
CREATE POLICY "location_photos_member_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'location-photos'
    AND is_location_operator_member(storage_location_id_from_path(name), auth.uid())
  )
  WITH CHECK (
    bucket_id = 'location-photos'
    AND is_location_operator_member(storage_location_id_from_path(name), auth.uid())
  );

DROP POLICY IF EXISTS "location_photos_member_delete" ON storage.objects;
CREATE POLICY "location_photos_member_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'location-photos'
    AND is_location_operator_member(storage_location_id_from_path(name), auth.uid())
  );

-- Create a listing (and operator if the user has none). Owner/manager only.
CREATE OR REPLACE FUNCTION create_location(
  p_name TEXT,
  p_address TEXT,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_capacity INTEGER,
  p_hourly_amount NUMERIC,
  p_listing_type listing_type DEFAULT 'commercial',
  p_rules TEXT DEFAULT NULL,
  p_operator_id UUID DEFAULT NULL,
  p_operator_name TEXT DEFAULT NULL
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
  IF p_hourly_amount IS NULL OR p_hourly_amount < 0 THEN
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
    tracking_mode, capacity, available_count, published, verification_status
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
    'unverified'
  ) RETURNING id INTO v_location_id;

  INSERT INTO rates (location_id, is_default, name, rate_type, hourly_amount, active)
  VALUES (v_location_id, true, 'Standard Rate', 'hourly', p_hourly_amount, true)
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
    'rate_id', v_rate_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_location(
  p_location_id UUID,
  p_name TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL,
  p_capacity INTEGER DEFAULT NULL,
  p_rules TEXT DEFAULT NULL,
  p_listing_type listing_type DEFAULT NULL,
  p_hours TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_geog GEOGRAPHY;
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

  UPDATE locations
  SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    address = COALESCE(NULLIF(btrim(p_address), ''), address),
    geog = COALESCE(v_geog, geog),
    capacity = CASE
      WHEN p_capacity IS NOT NULL AND p_capacity >= 1 THEN p_capacity
      ELSE capacity
    END,
    available_count = CASE
      WHEN p_capacity IS NOT NULL AND p_capacity >= 1 THEN LEAST(available_count, p_capacity)
      ELSE available_count
    END,
    rules = CASE
      WHEN p_rules IS NULL THEN rules
      ELSE NULLIF(btrim(p_rules), '')
    END,
    listing_type = COALESCE(p_listing_type, listing_type),
    hours = CASE
      WHEN p_hours IS NULL THEN hours
      ELSE NULLIF(btrim(p_hours), '')
    END
  WHERE id = p_location_id;

  RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$$;

-- Register a facility photo in Storage (objects row) and location_photos.
-- Host storage-api cannot reach the DB in this environment; this RPC is the
-- documented write path and still goes through storage.objects + RLS helpers.
CREATE OR REPLACE FUNCTION put_location_photo(
  p_location_id UUID,
  p_filename TEXT,
  p_is_cover BOOLEAN DEFAULT TRUE,
  p_caption TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_path TEXT;
  v_photo_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_filename IS NULL OR btrim(p_filename) = '' THEN
    RETURN jsonb_build_object('error', 'filename_required');
  END IF;
  IF NOT is_location_operator_member(p_location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  v_path := p_location_id::TEXT || '/' || regexp_replace(btrim(p_filename), '[^A-Za-z0-9._-]', '_', 'g');

  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES (
    'location-photos',
    v_path,
    v_uid,
    jsonb_build_object('mimetype', 'image/jpeg', 'source', 'put_location_photo')
  )
  ON CONFLICT (bucket_id, name) DO UPDATE
    SET owner = EXCLUDED.owner, updated_at = NOW();

  INSERT INTO location_photos (location_id, storage_path, caption, is_cover, uploaded_by)
  VALUES (p_location_id, v_path, NULLIF(btrim(COALESCE(p_caption, '')), ''), COALESCE(p_is_cover, true), v_uid)
  RETURNING id INTO v_photo_id;

  RETURN jsonb_build_object(
    'success', true,
    'photo_id', v_photo_id,
    'storage_path', v_path
  );
END;
$$;

GRANT EXECUTE ON FUNCTION storage_location_id_from_path(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_location_operator_member(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_location(TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, NUMERIC, listing_type, TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_location(UUID, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, listing_type, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION put_location_photo(UUID, TEXT, BOOLEAN, TEXT) TO authenticated, service_role;
