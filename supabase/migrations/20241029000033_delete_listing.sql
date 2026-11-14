-- 🟪 1.0.8: operators (listing owners) can delete a listing.
-- Soft delete: locations.deleted_at is set and the row stays, so sessions, folios,
-- payments, reviews and chat threads that point at it keep working.
-- Deleted listings leave search, ETAs, the admin queue, sidebar counts and the public
-- RLS read; operator members can still read the row for their history screens.

ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- Public reads skip deleted listings.
DROP POLICY IF EXISTS "Published locations viewable by all" ON locations;
CREATE POLICY "Published locations viewable by all" ON locations
  FOR SELECT USING (published = true AND deleted_at IS NULL);

-- Owners/managers can't edit (or un-delete) a deleted listing through the API;
-- only delete_location sets deleted_at.
DROP POLICY IF EXISTS "Operators can manage locations" ON locations;
CREATE POLICY "Operators can manage locations" ON locations
  FOR ALL
  USING (
    deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM operator_members
      WHERE operator_members.operator_id = locations.operator_id
        AND operator_members.profile_id = auth.uid()
        AND operator_members.role = ANY (ARRAY['owner'::operator_role, 'manager'::operator_role])
    )
  )
  WITH CHECK (
    deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM operator_members
      WHERE operator_members.operator_id = locations.operator_id
        AND operator_members.profile_id = auth.uid()
        AND operator_members.role = ANY (ARRAY['owner'::operator_role, 'manager'::operator_role])
    )
  );

-- Delete a listing (owner only). Refuses while anything is still running there:
-- sessions that aren't ended, and reservations that aren't in a finished state.
-- Statuses are matched against the finished set, so a status added later counts as
-- active (blocks deletion) until it's listed here.
CREATE OR REPLACE FUNCTION public.delete_location(p_location_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_location locations;
  v_sessions INTEGER;
  v_reservations INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_signed_in');
  END IF;

  -- Same row lock as claim_capacity (walk-in check-in / reservations), so a check-in
  -- can't slip in between the checks below and the delete.
  SELECT * INTO v_location FROM locations WHERE id = p_location_id FOR UPDATE;
  IF v_location.id IS NULL OR v_location.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM operator_members
    WHERE operator_id = v_location.operator_id
      AND profile_id = v_uid
      AND role = 'owner'
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*) INTO v_sessions FROM parking_sessions
  WHERE location_id = p_location_id AND status IS DISTINCT FROM 'ended';

  SELECT COUNT(*) INTO v_reservations FROM reservations
  WHERE location_id = p_location_id
    AND status NOT IN ('completed', 'cancelled', 'declined', 'expired', 'no_show');

  IF v_sessions > 0 OR v_reservations > 0 THEN
    RETURN jsonb_build_object(
      'error', 'has_active',
      'active_sessions', v_sessions,
      'active_reservations', v_reservations
    );
  END IF;

  UPDATE locations
  SET deleted_at = NOW(), deleted_by = v_uid, published = false
  WHERE id = p_location_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_location(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_location(UUID) TO authenticated;

-- Functions below are the hosted definitions with a deleted_at filter added.

CREATE OR REPLACE FUNCTION public.claim_capacity(p_location_id uuid, p_slot_id uuid DEFAULT NULL::uuid, p_start_at timestamp with time zone DEFAULT now(), p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_kind text DEFAULT 'session'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_location RECORD;
  v_slot RECORD;
  v_overlapping INTEGER;
  v_available INTEGER;
BEGIN
  SELECT * INTO v_location FROM locations WHERE id = p_location_id FOR UPDATE;
  -- 🟪 1.0.8: deleted listings take no new sessions or reservations. The row lock
  -- above is the same one delete_location takes, so the two can't race.
  IF v_location IS NULL OR v_location.deleted_at IS NOT NULL THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.search_nearby(p_lat numeric, p_lng numeric, p_radius_m integer DEFAULT 1000, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type, p_monthly_only boolean DEFAULT false, p_hide_full boolean DEFAULT false, p_sort_by text DEFAULT 'distance'::text, p_limit integer DEFAULT 50, p_rate_type rate_type DEFAULT NULL::rate_type)
 RETURNS TABLE(id uuid, name text, listing_type listing_type, address text, lat numeric, lng numeric, distance_m integer, available_count integer, capacity integer, open_status boolean, tracking_mode tracking_mode, availability_updated_at timestamp with time zone, stale_after_min integer, verification_status verification_status, cover_photo_url text, starting_rate numeric, avg_rating numeric, review_count integer, has_monthly boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_origin GEOGRAPHY;
BEGIN
  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY;

  RETURN QUERY
  SELECT
    l.id,
    l.name,
    l.listing_type,
    l.address,
    ST_Y(l.geog::GEOMETRY)::NUMERIC AS lat,
    ST_X(l.geog::GEOMETRY)::NUMERIC AS lng,
    ST_Distance(l.geog, v_origin)::INTEGER AS distance_m,
    l.available_count,
    l.capacity,
    l.open_status,
    l.tracking_mode,
    l.availability_updated_at,
    l.stale_after_min,
    l.verification_status,
    (SELECT storage_path FROM location_photos WHERE location_id = l.id AND is_cover = true LIMIT 1) AS cover_photo_url,
    (
      SELECT r.hourly_amount
      FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND (r.vehicle_type IS NULL OR r.vehicle_type = p_vehicle_type)
      AND r.rate_type = 'hourly'
      ORDER BY r.is_default DESC
      LIMIT 1
    ) AS starting_rate,
    lrs.avg_rating,
    lrs.review_count,
    EXISTS (
      SELECT 1 FROM rates
      WHERE location_id = l.id
      AND active = true
      AND rate_type = 'monthly'
    ) AS has_monthly
  FROM locations l
  LEFT JOIN location_rating_stats lrs ON lrs.location_id = l.id
  WHERE l.published = true
  AND l.deleted_at IS NULL
  AND ST_DWithin(l.geog, v_origin, p_radius_m)
  AND (NOT p_monthly_only OR EXISTS (
    SELECT 1 FROM rates
    WHERE location_id = l.id
    AND active = true
    AND rate_type = 'monthly'
  ))
  AND (p_rate_type IS NULL OR EXISTS (
    SELECT 1 FROM rates
    WHERE location_id = l.id
    AND active = true
    AND rate_type = p_rate_type
  ))
  AND (NOT p_hide_full OR (
    (l.tracking_mode = 'count' AND l.available_count > 0) OR
    (l.tracking_mode = 'open_full' AND l.open_status = true)
  ))
  ORDER BY
    CASE p_sort_by
      WHEN 'price' THEN (
        SELECT r.hourly_amount
        FROM rates r
        WHERE r.location_id = l.id
        AND r.active = true
        ORDER BY r.is_default DESC
        LIMIT 1
      )
      WHEN 'availability' THEN -l.available_count
      WHEN 'rating' THEN -lrs.avg_rating
      ELSE ST_Distance(l.geog, v_origin)
    END
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_etas(p_lat numeric, p_lng numeric, p_location_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cell TEXT;
  v_etas JSONB := '[]'::JSONB;
  r RECORD;
  v_duration INTEGER;
  v_distance INTEGER;
  v_source TEXT;
BEGIN
  v_cell := round(p_lat * 200) / 200 || ',' || round(p_lng * 200) / 200;
  FOR r IN
    SELECT l.id,
           ST_Y(l.geog::geometry) AS lat,
           ST_X(l.geog::geometry) AS lng
    FROM locations l
    WHERE l.published = true
      AND l.deleted_at IS NULL
      AND (p_location_ids IS NULL OR l.id = ANY (p_location_ids))
  LOOP
    SELECT duration_s, distance_m, source
      INTO v_duration, v_distance, v_source
    FROM eta_cache
    WHERE origin_cell = v_cell
      AND location_id = r.id
      AND fetched_at > NOW() - INTERVAL '10 minutes';

    IF v_duration IS NULL THEN
      v_distance := haversine_m(p_lat, p_lng, r.lat::NUMERIC, r.lng::NUMERIC);
      -- 30 km/h Baguio estimate
      v_duration := GREATEST(60, ROUND((v_distance / 30000.0) * 3600));
      v_source := 'estimate';
      INSERT INTO eta_cache (origin_cell, location_id, duration_s, distance_m, source, fetched_at)
      VALUES (v_cell, r.id, v_duration, v_distance, v_source, NOW())
      ON CONFLICT (origin_cell, location_id) DO UPDATE
        SET duration_s = EXCLUDED.duration_s,
            distance_m = EXCLUDED.distance_m,
            source = EXCLUDED.source,
            fetched_at = EXCLUDED.fetched_at;
    END IF;

    v_etas := v_etas || jsonb_build_array(jsonb_build_object(
      'location_id', r.id,
      'duration_s', v_duration,
      'distance_m', v_distance,
      'source', v_source
    ));
    v_duration := NULL;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'etas', v_etas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sidebar_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_profile profiles;
  v_admin BOOLEAN;
  v_triggers JSONB;
BEGIN
  SELECT COALESCE(jsonb_object_agg(key, enabled), '{}'::JSONB) INTO v_triggers
  FROM attention_triggers;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('signed_in', false, 'triggers', v_triggers);
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  v_admin := COALESCE(v_profile.is_admin, FALSE);

  RETURN jsonb_build_object(
    'signed_in', true,
    'triggers', v_triggers,
    'unread_messages', (SELECT COUNT(*) FROM my_unread_messages(v_uid)),
    'unread_notifications', (
      SELECT COUNT(*) FROM notifications WHERE recipient_id = v_uid AND read_at IS NULL
    ),
    'pending_verifications', CASE WHEN v_admin THEN (
      SELECT COUNT(*) FROM locations
      WHERE verification_status = 'unverified' AND rejected_at IS NULL AND deleted_at IS NULL
    ) ELSE 0 END,
    'pending_reports', CASE WHEN v_admin THEN (
      SELECT COUNT(*) FROM reports WHERE status = 'pending'
    ) ELSE 0 END,
    'listing_reviewed', (SELECT COUNT(*) FROM my_unseen_reviews(v_uid)),
    'listings', (
      SELECT COUNT(DISTINCT l.id) FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id AND om.profile_id = v_uid
      WHERE l.deleted_at IS NULL
        AND (om.role IN ('owner', 'manager')
         OR om.location_ids = '{}'
         OR l.id = ANY (om.location_ids))
    ),
    'vehicles', (SELECT COUNT(*) FROM vehicles WHERE driver_id = v_uid),
    'profile_incomplete', CASE
      WHEN v_profile.id IS NOT NULL AND is_profile_incomplete(v_profile) THEN 1 ELSE 0 END
  );
END;
$function$;
