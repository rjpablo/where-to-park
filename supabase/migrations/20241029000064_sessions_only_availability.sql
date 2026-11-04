-- 🟧 Sessions-only availability (rj t135u/t136u, Option B; the Count tab and -/+ are gone).
-- ONE source for a listing's free spaces:
--   free = capacity - started open sessions (active/overdue, start <= now)
--          - Reserved - Unavailable            (never below 0)
-- location_free_spaces() is used by the walk-in check-in capacity check (claim_capacity),
-- search_nearby (results sheet / pins 'n spots', hide-full, sort), set_manual_counts and,
-- through the free_spaces computed field, the Availability screen, Location details, the
-- listing page and My listings. locations.available_count is kept as a cache only (synced
-- by trigger; nothing reads it for count listings any more).
-- Bug fix: future-start reservations no longer block walk-ins before their start.

CREATE OR REPLACE FUNCTION public.location_free_spaces(p_location_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    l.capacity
    - (SELECT COUNT(*) FROM parking_sessions s
        WHERE s.location_id = l.id AND s.status IN ('active', 'overdue') AND s.started_at <= now())::int
    - COALESCE(l.manual_reserved_count, 0)
    - COALESCE(l.unavailable_count, 0))
  FROM locations l WHERE l.id = p_location_id;
$$;
GRANT EXECUTE ON FUNCTION public.location_free_spaces(uuid) TO anon, authenticated, service_role;

-- PostgREST computed field: select=*,free_spaces
CREATE OR REPLACE FUNCTION public.free_spaces(l public.locations)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT location_free_spaces(l.id); $$;
GRANT EXECUTE ON FUNCTION public.free_spaces(public.locations) TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS parking_sessions_open_location_idx
  ON parking_sessions (location_id, started_at) WHERE status IN ('active', 'overdue');

-- Keep the cached column and 'Updated …' time in step when sessions change.
CREATE OR REPLACE FUNCTION public.sync_location_free_spaces()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ids uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN v_ids := ARRAY[OLD.location_id];
  ELSIF TG_OP = 'INSERT' THEN v_ids := ARRAY[NEW.location_id];
  ELSE v_ids := ARRAY[OLD.location_id, NEW.location_id];
  END IF;
  UPDATE locations SET available_count = location_free_spaces(id), availability_updated_at = now()
   WHERE id = ANY (v_ids) AND tracking_mode = 'count';
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS parking_sessions_sync_free_spaces ON parking_sessions;
CREATE TRIGGER parking_sessions_sync_free_spaces
  AFTER INSERT OR DELETE OR UPDATE OF status, started_at, location_id ON parking_sessions
  FOR EACH ROW EXECUTE FUNCTION sync_location_free_spaces();

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

  IF v_location.tracking_mode = 'count' AND p_start_at <= now() THEN
    -- 0064: a walk-in starting now (or backdated) takes a space only if one is free right
    -- now, from the one source. Future reservations don't hold a space before their start
    -- (bug fix: they used to block walk-ins), and the legacy reservations table is not used.
    v_available := location_free_spaces(p_location_id);
    IF v_available < 1 THEN
      RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available);
    END IF;
    RETURN jsonb_build_object('success', true, 'available', v_available);
  END IF;

  IF v_location.tracking_mode = 'count' THEN
    -- A future reservation: spaces held over its stay by sessions (started or reserved).
    SELECT COUNT(*) INTO v_overlapping
    FROM (
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

  RETURN jsonb_build_object('error', 'Invalid tracking mode or missing spot');
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_nearby(p_lat numeric, p_lng numeric, p_radius_m integer DEFAULT 1000, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type, p_monthly_only boolean DEFAULT false, p_hide_full boolean DEFAULT false, p_sort_by text DEFAULT 'distance'::text, p_limit integer DEFAULT 50, p_rate_type rate_type DEFAULT NULL::rate_type)
 RETURNS TABLE(id uuid, name text, listing_type listing_type, address text, lat numeric, lng numeric, distance_m integer, available_count integer, capacity integer, open_status boolean, tracking_mode tracking_mode, availability_updated_at timestamp with time zone, stale_after_min integer, verification_status verification_status, cover_photo_url text, starting_rate numeric, avg_rating numeric, review_count integer, has_monthly boolean, starting_rate_info jsonb)
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
    CASE WHEN l.tracking_mode = 'count' THEN location_free_spaces(l.id) ELSE l.available_count END AS available_count,
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
    ) AS has_monthly,
    -- 0061: the rate a result card shows when there is no hourly rate (flat then hourly,
    -- daily or monthly): the default first, then the oldest; NULL when none applies.
    (
      SELECT jsonb_build_object(
        'rate_type', r.rate_type,
        'hourly_amount', r.hourly_amount,
        'daily_amount', r.daily_amount,
        'monthly_amount', r.monthly_amount,
        'first_hours', r.first_hours,
        'first_amount', r.first_amount,
        'succeeding_hourly_amount', r.succeeding_hourly_amount)
      FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND r.archived_at IS NULL
      AND (r.vehicle_type IS NULL OR r.vehicle_type = p_vehicle_type)
      ORDER BY r.is_default DESC, r.created_at
      LIMIT 1
    ) AS starting_rate_info
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
    (l.tracking_mode = 'count' AND location_free_spaces(l.id) > 0) OR
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
      WHEN 'availability' THEN -location_free_spaces(l.id)
      WHEN 'rating' THEN -lrs.avg_rating
      ELSE ST_Distance(l.geog, v_origin)
    END
  LIMIT p_limit;
END;
$function$;

-- Reserved / Unavailable (now on the Sessions tab): same checks, total from the one source.
CREATE OR REPLACE FUNCTION public.set_manual_counts(p_location_id uuid, p_reserved integer DEFAULT NULL::integer, p_unavailable integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE location_id = p_location_id AND status IN ('active', 'overdue')
    AND started_at <= now();

  IF v_location.capacity - v_occupied - v_reserved - v_unavailable < 0 THEN
    RETURN jsonb_build_object('error', 'no_longer_available',
      'available', v_location.capacity - v_occupied - v_reserved - v_unavailable);
  END IF;

  UPDATE locations
  SET manual_reserved_count = v_reserved,
      unavailable_count = v_unavailable,
      availability_updated_at = NOW()
  WHERE id = p_location_id;
  v_available := location_free_spaces(p_location_id);
  UPDATE locations SET available_count = v_available WHERE id = p_location_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, 'manual_reserved=' || v_reserved || ',unavailable=' || v_unavailable, v_uid);

  RETURN jsonb_build_object(
    'success', true,
    'available_count', v_available,
    'manual_reserved_count', v_reserved,
    'unavailable_count', v_unavailable
  );
END;
$function$;

-- Switching an Open/Full listing back to sessions, or the reverse, uses the same source.
CREATE OR REPLACE FUNCTION public.set_tracking_mode(p_location_id uuid, p_mode tracking_mode)
RETURNS jsonb
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
        WHEN p_mode = 'open_full' THEN COALESCE(open_status, location_free_spaces(id) > 0)
        ELSE open_status
      END,
      available_count = location_free_spaces(id),
      availability_updated_at = NOW()
  WHERE id = p_location_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, 'tracking_mode=' || p_mode::TEXT, v_uid);

  RETURN jsonb_build_object('success', true, 'tracking_mode', p_mode);
END;
$$;

-- Bring the cache in line now.
UPDATE locations SET available_count = location_free_spaces(id)
 WHERE tracking_mode = 'count' AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
