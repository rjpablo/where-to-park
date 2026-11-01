-- 0067 Areas (rj t139u): every listing has an undeletable, non-renameable 'Main' area.
-- Total spots, vehicle types, monitoring, Reserved/Unavailable, the Full flag and sessions
-- now belong to an area. One source per area (area_free_spaces) plus the listing aggregate
-- (location_free_spaces / location_is_full), used by search, Location details, check-in
-- and the operator screens. The listing is Full only when every (applicable) area is full.
-- Unmonitored areas give no number: they are full only when their Available/Full toggle
-- says Full.

-- 1. Area settings (extends the existing areas table).
ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  -- NULL = every vehicle type.
  ADD COLUMN IF NOT EXISTS vehicle_types vehicle_type[],
  ADD COLUMN IF NOT EXISTS monitored boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manual_reserved_count integer NOT NULL DEFAULT 0
    CHECK (manual_reserved_count >= 0),
  ADD COLUMN IF NOT EXISTS unavailable_count integer NOT NULL DEFAULT 0
    CHECK (unavailable_count >= 0),
  ADD COLUMN IF NOT EXISTS marked_full boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS areas_one_main ON areas (location_id) WHERE is_main;
CREATE UNIQUE INDEX IF NOT EXISTS areas_name_unique ON areas (location_id, lower(btrim(name)));

-- 2. Migrate: every listing gets Main with its current spots, held counts and Full flag.
-- (Listings had no vehicle restrictions, so Main takes every vehicle type.)
INSERT INTO areas (location_id, name, sort_order, is_main, capacity,
                   manual_reserved_count, unavailable_count, marked_full)
SELECT l.id, 'Main', 0, true, GREATEST(0, COALESCE(l.capacity, 0)),
       GREATEST(0, COALESCE(l.manual_reserved_count, 0)),
       GREATEST(0, COALESCE(l.unavailable_count, 0)), COALESCE(l.marked_full, false)
FROM locations l
WHERE NOT EXISTS (SELECT 1 FROM areas a WHERE a.location_id = l.id AND a.is_main);

-- Existing extra areas (e.g. SM City Baguio's levels) start with 0 spots, monitored.

-- 3. Sessions belong to an area; existing sessions go to Main.
ALTER TABLE parking_sessions
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES areas(id) ON DELETE SET NULL;
ALTER TABLE parking_sessions DISABLE TRIGGER USER;
UPDATE parking_sessions s SET area_id = a.id
  FROM areas a WHERE a.location_id = s.location_id AND a.is_main AND s.area_id IS NULL;
ALTER TABLE parking_sessions ENABLE TRIGGER USER;
CREATE INDEX IF NOT EXISTS parking_sessions_area_open
  ON parking_sessions (area_id, status) WHERE status IN ('active', 'overdue');

ALTER TABLE availability_events
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES areas(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION main_area_id(p_location_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM areas WHERE location_id = p_location_id AND is_main;
$$;

-- 4. Guards: Main can't be deleted, renamed or un-mained (any path, not just the RPCs).
CREATE OR REPLACE FUNCTION areas_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A listing being hard-deleted takes its Main with it.
    IF OLD.is_main AND EXISTS (SELECT 1 FROM locations WHERE id = OLD.location_id) THEN
      RAISE EXCEPTION 'main_area_locked';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.is_main IS DISTINCT FROM OLD.is_main
     OR (OLD.is_main AND NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'main_area_locked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS areas_guard ON areas;
CREATE TRIGGER areas_guard BEFORE UPDATE OR DELETE ON areas
  FOR EACH ROW EXECUTE FUNCTION areas_guard();

-- New listings get Main with the spots they were created with.
CREATE OR REPLACE FUNCTION locations_create_main_area()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO areas (location_id, name, sort_order, is_main, capacity)
  VALUES (NEW.id, 'Main', 0, true, GREATEST(0, COALESCE(NEW.capacity, 0)))
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS locations_create_main_area ON locations;
CREATE TRIGGER locations_create_main_area AFTER INSERT ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_create_main_area();

-- A session without an area goes to Main; an area must belong to the session's listing.
CREATE OR REPLACE FUNCTION parking_sessions_area()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.area_id IS NULL THEN
    NEW.area_id := main_area_id(NEW.location_id);
  ELSIF NOT EXISTS (SELECT 1 FROM areas WHERE id = NEW.area_id AND location_id = NEW.location_id) THEN
    RAISE EXCEPTION 'area_not_in_listing';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS parking_sessions_area ON parking_sessions;
CREATE TRIGGER parking_sessions_area BEFORE INSERT OR UPDATE OF area_id, location_id
  ON parking_sessions FOR EACH ROW EXECUTE FUNCTION parking_sessions_area();

-- 5. The one source: per area, then the listing aggregate.
CREATE OR REPLACE FUNCTION area_allows_vehicle(p_types vehicle_type[], p_vehicle vehicle_type)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_vehicle IS NULL OR p_types IS NULL OR cardinality(p_types) = 0 OR p_vehicle = ANY (p_types);
$$;

-- Started, open sessions in an area (reservations don't hold a space before their start).
CREATE OR REPLACE FUNCTION area_occupied_spaces(p_area_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::int FROM parking_sessions s
   WHERE s.area_id = p_area_id AND s.status IN ('active', 'overdue') AND s.started_at <= now();
$$;

-- The real count (ignores the Full flag); NULL when the area isn't monitored.
CREATE OR REPLACE FUNCTION area_counted_spaces(p_area_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN a.monitored THEN GREATEST(0,
    a.capacity - area_occupied_spaces(a.id) - a.manual_reserved_count - a.unavailable_count) END
  FROM areas a WHERE a.id = p_area_id;
$$;

-- What drivers get: 0 when marked Full; NULL when not monitored.
CREATE OR REPLACE FUNCTION area_free_spaces(p_area_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT a.monitored THEN NULL WHEN a.marked_full THEN 0
    ELSE area_counted_spaces(a.id) END
  FROM areas a WHERE a.id = p_area_id;
$$;

-- Full: switched Full, or (monitored) no free space left.
CREATE OR REPLACE FUNCTION area_is_full(p_area_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.marked_full OR (a.monitored AND COALESCE(area_counted_spaces(a.id), 0) <= 0)
  FROM areas a WHERE a.id = p_area_id;
$$;

DROP FUNCTION IF EXISTS location_free_spaces(uuid);
DROP FUNCTION IF EXISTS location_counted_spaces(uuid);

-- Listing total over monitored areas that take the vehicle (all areas when NULL);
-- NULL when no such area is monitored.
CREATE OR REPLACE FUNCTION location_free_spaces(p_location_id uuid, p_vehicle_type vehicle_type DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT SUM(area_free_spaces(a.id))::int FROM areas a
   WHERE a.location_id = p_location_id AND a.monitored
     AND area_allows_vehicle(a.vehicle_types, p_vehicle_type);
$$;

CREATE OR REPLACE FUNCTION location_counted_spaces(p_location_id uuid, p_vehicle_type vehicle_type DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT SUM(area_counted_spaces(a.id))::int FROM areas a
   WHERE a.location_id = p_location_id AND a.monitored
     AND area_allows_vehicle(a.vehicle_types, p_vehicle_type);
$$;

-- Full only when every area (that takes the vehicle) is full; no such area = Full.
CREATE OR REPLACE FUNCTION location_is_full(p_location_id uuid, p_vehicle_type vehicle_type DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bool_and(area_is_full(a.id)), true) FROM areas a
   WHERE a.location_id = p_location_id AND area_allows_vehicle(a.vehicle_types, p_vehicle_type);
$$;

-- PostgREST computed fields.
CREATE OR REPLACE FUNCTION free_spaces(l locations)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT location_free_spaces(l.id);
$$;
CREATE OR REPLACE FUNCTION counted_spaces(l locations)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT location_counted_spaces(l.id);
$$;
CREATE OR REPLACE FUNCTION listing_full(l locations)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT location_is_full(l.id);
$$;
CREATE OR REPLACE FUNCTION area_free(a areas)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT area_free_spaces(a.id);
$$;
CREATE OR REPLACE FUNCTION area_counted(a areas)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT area_counted_spaces(a.id);
$$;
CREATE OR REPLACE FUNCTION area_occupied(a areas)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT area_occupied_spaces(a.id);
$$;
CREATE OR REPLACE FUNCTION area_full(a areas)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT area_is_full(a.id);
$$;

-- 6. Listing columns become caches of the areas (capacity = monitored spots, held sums,
-- marked_full = the listing is Full, available_count = monitored free total).
CREATE OR REPLACE FUNCTION refresh_location_availability(p_location_ids uuid[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE locations l SET
    capacity = COALESCE((SELECT SUM(a.capacity) FROM areas a WHERE a.location_id = l.id AND a.monitored), 0),
    manual_reserved_count = COALESCE((SELECT SUM(a.manual_reserved_count) FROM areas a
      WHERE a.location_id = l.id AND a.monitored), 0),
    unavailable_count = COALESCE((SELECT SUM(a.unavailable_count) FROM areas a
      WHERE a.location_id = l.id AND a.monitored), 0),
    marked_full = location_is_full(l.id),
    available_count = COALESCE(location_free_spaces(l.id), 0),
    availability_updated_at = now()
  WHERE l.id = ANY (p_location_ids);
$$;

CREATE OR REPLACE FUNCTION sync_location_free_spaces()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM refresh_location_availability(ARRAY[OLD.location_id]);
  ELSIF TG_OP = 'INSERT' THEN PERFORM refresh_location_availability(ARRAY[NEW.location_id]);
  ELSE PERFORM refresh_location_availability(ARRAY[OLD.location_id, NEW.location_id]);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS parking_sessions_sync_free_spaces ON parking_sessions;
CREATE TRIGGER parking_sessions_sync_free_spaces
  AFTER INSERT OR DELETE OR UPDATE OF status, started_at, location_id, area_id ON parking_sessions
  FOR EACH ROW EXECUTE FUNCTION sync_location_free_spaces();
DROP TRIGGER IF EXISTS areas_sync_location ON areas;
CREATE TRIGGER areas_sync_location AFTER INSERT OR DELETE OR UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION sync_location_free_spaces();

SELECT refresh_location_availability(ARRAY(SELECT id FROM locations));

-- Staff assigned to a listing can read its areas (also unpublished listings). Inline (not
-- can_work_location, which clients can't execute) and for signed-in users only.
DROP POLICY IF EXISTS "Staff can view areas" ON areas;
CREATE POLICY "Staff can view areas" ON areas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id
    WHERE l.id = areas.location_id
      AND om.profile_id = auth.uid()
      AND (om.role IN ('owner', 'manager') OR areas.location_id = ANY (om.location_ids))
  ));

-- 7. Area RPCs. Owners/managers manage areas and their settings; anyone who works the
-- listing (owner, manager, assigned staff) sets Reserved/Unavailable and Full.
CREATE OR REPLACE FUNCTION upsert_area(
  p_location_id UUID,
  p_name TEXT,
  p_area_id UUID DEFAULT NULL,
  p_sort_order INTEGER DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_area areas%ROWTYPE;
  v_area_id UUID;
  v_name TEXT := btrim(COALESCE(p_name, ''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id AND deleted_at IS NULL;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
  END IF;
  IF p_area_id IS NOT NULL THEN
    SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = p_location_id FOR UPDATE;
    IF v_area.id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
    -- rj t139u: Main can't be renamed (for now).
    IF v_area.is_main AND v_name <> v_area.name THEN
      RETURN jsonb_build_object('error', 'main_area_locked');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM areas WHERE location_id = p_location_id
             AND lower(btrim(name)) = lower(v_name) AND id IS DISTINCT FROM p_area_id) THEN
    RETURN jsonb_build_object('error', 'area_name_taken');
  END IF;

  IF p_area_id IS NULL THEN
    INSERT INTO areas (location_id, name, sort_order)
    VALUES (p_location_id, v_name, COALESCE(NULLIF(p_sort_order, 0),
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM areas WHERE location_id = p_location_id)))
    RETURNING id INTO v_area_id;
  ELSE
    UPDATE areas SET name = v_name, sort_order = COALESCE(NULLIF(p_sort_order, 0), sort_order)
     WHERE id = p_area_id RETURNING id INTO v_area_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'area_id', v_area_id);
END;
$$;

CREATE OR REPLACE FUNCTION delete_area(p_area_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_area areas%ROWTYPE;
  v_operator_id UUID;
BEGIN
  SELECT * INTO v_area FROM areas WHERE id = p_area_id FOR UPDATE;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  SELECT operator_id INTO v_operator_id FROM locations WHERE id = v_area.location_id;
  IF v_uid IS NULL OR NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_area.is_main THEN
    RETURN jsonb_build_object('error', 'main_area_locked');
  END IF;
  IF EXISTS (SELECT 1 FROM parking_sessions WHERE area_id = p_area_id AND status IN ('active', 'overdue')) THEN
    RETURN jsonb_build_object('error', 'area_has_sessions');
  END IF;
  -- Ended sessions keep their history under Main.
  UPDATE parking_sessions SET area_id = main_area_id(v_area.location_id) WHERE area_id = p_area_id;
  DELETE FROM areas WHERE id = p_area_id;
  INSERT INTO availability_events (location_id, change, actor)
  VALUES (v_area.location_id, 'area_deleted:' || v_area.name, v_uid);
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Total spots, vehicle types (NULL or empty = all) and monitoring. Owners/managers only.
CREATE OR REPLACE FUNCTION set_area_settings(
  p_area_id uuid,
  p_capacity integer,
  p_vehicle_types vehicle_type[],
  p_monitored boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_area areas%ROWTYPE;
  v_operator_id uuid;
  v_types vehicle_type[];
  v_in_use integer;
  v_monitored boolean := COALESCE(p_monitored, true);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_area FROM areas WHERE id = p_area_id FOR UPDATE;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  SELECT operator_id INTO v_operator_id FROM locations WHERE id = v_area.location_id AND deleted_at IS NULL;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_monitored AND (p_capacity IS NULL OR p_capacity < 0) THEN
    RETURN jsonb_build_object('error', 'capacity_invalid');
  END IF;
  -- Spots in use (parked cars + held) must still fit.
  v_in_use := area_occupied_spaces(p_area_id) + v_area.manual_reserved_count + v_area.unavailable_count;
  IF v_monitored AND p_capacity < v_in_use THEN
    RETURN jsonb_build_object('error', 'capacity_below_in_use', 'in_use', v_in_use);
  END IF;
  SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE array_agg(DISTINCT t ORDER BY t) END
    INTO v_types FROM unnest(COALESCE(p_vehicle_types, '{}'::vehicle_type[])) t;
  -- Every type listed = all (stored as NULL).
  IF v_types IS NOT NULL AND cardinality(v_types) = cardinality(enum_range(NULL::vehicle_type)) THEN
    v_types := NULL;
  END IF;

  UPDATE areas SET
    capacity = CASE WHEN v_monitored THEN p_capacity ELSE COALESCE(p_capacity, capacity) END,
    vehicle_types = v_types,
    monitored = v_monitored
  WHERE id = p_area_id;
  INSERT INTO availability_events (location_id, area_id, change, actor)
  VALUES (v_area.location_id, p_area_id, 'area_settings:capacity=' ||
    COALESCE(p_capacity, v_area.capacity) || ',monitored=' || v_monitored ||
    ',vehicles=' || COALESCE(array_to_string(v_types, '|'), 'all'), v_uid);
  RETURN jsonb_build_object('success', true, 'area_id', p_area_id);
END;
$$;

-- Reserved / Unavailable for a monitored area (replaces set_manual_counts).
CREATE OR REPLACE FUNCTION set_area_counts(p_area_id uuid, p_reserved integer DEFAULT NULL, p_unavailable integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_area areas%ROWTYPE;
  v_reserved integer;
  v_unavailable integer;
  v_left integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_area FROM areas WHERE id = p_area_id FOR UPDATE;
  IF v_area.id IS NULL OR NOT EXISTS (SELECT 1 FROM locations WHERE id = v_area.location_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_area.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF NOT v_area.monitored THEN
    RETURN jsonb_build_object('error', 'area_not_monitored');
  END IF;
  v_reserved := GREATEST(0, COALESCE(p_reserved, v_area.manual_reserved_count));
  v_unavailable := GREATEST(0, COALESCE(p_unavailable, v_area.unavailable_count));
  v_left := v_area.capacity - area_occupied_spaces(p_area_id) - v_reserved - v_unavailable;
  IF v_left < 0 THEN
    RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_left);
  END IF;
  UPDATE areas SET manual_reserved_count = v_reserved, unavailable_count = v_unavailable
   WHERE id = p_area_id;
  INSERT INTO availability_events (location_id, area_id, change, actor)
  VALUES (v_area.location_id, p_area_id,
    'manual_reserved=' || v_reserved || ',unavailable=' || v_unavailable, v_uid);
  RETURN jsonb_build_object('success', true, 'manual_reserved_count', v_reserved,
    'unavailable_count', v_unavailable, 'counted_spaces', area_counted_spaces(p_area_id),
    'free_spaces', area_free_spaces(p_area_id));
END;
$$;

-- The Full switch (monitored areas) / Available-Full toggle (unmonitored), per area.
CREATE OR REPLACE FUNCTION set_area_full(p_area_id uuid, p_full boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_area areas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_area FROM areas WHERE id = p_area_id FOR UPDATE;
  IF v_area.id IS NULL OR NOT EXISTS (SELECT 1 FROM locations WHERE id = v_area.location_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_area.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_area.marked_full IS DISTINCT FROM COALESCE(p_full, false) THEN
    UPDATE areas SET marked_full = COALESCE(p_full, false) WHERE id = p_area_id;
    INSERT INTO availability_events (location_id, area_id, change, actor)
    VALUES (v_area.location_id, p_area_id,
      CASE WHEN p_full THEN 'marked_full' ELSE 'unmarked_full' END, v_uid);
  END IF;
  RETURN jsonb_build_object('success', true, 'marked_full', COALESCE(p_full, false),
    'free_spaces', area_free_spaces(p_area_id), 'counted_spaces', area_counted_spaces(p_area_id),
    'listing_full', location_is_full(v_area.location_id));
END;
$$;

-- Listing-level setters are replaced by the per-area ones (one source of truth).
DROP FUNCTION IF EXISTS set_manual_counts(uuid, integer, integer);
DROP FUNCTION IF EXISTS set_listing_full(uuid, boolean);

-- Edit listing / onboarding 'spaces' now means Main's total spots.
CREATE OR REPLACE FUNCTION update_location(p_location_id uuid, p_name text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_capacity integer DEFAULT NULL::integer, p_rules text DEFAULT NULL::text, p_listing_type listing_type DEFAULT NULL::listing_type, p_hours text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_geog GEOGRAPHY;
  v_main areas%ROWTYPE;
  v_in_use integer;
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
  UPDATE locations
  SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    address = COALESCE(NULLIF(btrim(p_address), ''), address),
    geog = COALESCE(v_geog, geog),
    rules = CASE WHEN p_rules IS NULL THEN rules ELSE NULLIF(btrim(p_rules), '') END,
    listing_type = COALESCE(p_listing_type, listing_type),
    hours = CASE WHEN p_hours IS NULL THEN hours ELSE NULLIF(btrim(p_hours), '') END
  WHERE id = p_location_id;
  RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$function$;

-- 8. Check-in capacity per area.
DROP FUNCTION IF EXISTS claim_capacity(uuid, uuid, timestamptz, timestamptz, text);
CREATE OR REPLACE FUNCTION claim_capacity(
  p_location_id uuid,
  p_slot_id uuid DEFAULT NULL,
  p_start_at timestamptz DEFAULT now(),
  p_end_at timestamptz DEFAULT NULL,
  p_kind text DEFAULT 'session',
  p_area_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_location RECORD;
  v_area areas%ROWTYPE;
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

  -- 0067: the space comes from one area (Main when none is given). The area row lock
  -- serialises check-ins into the same area.
  SELECT * INTO v_area FROM areas
   WHERE id = COALESCE(p_area_id, main_area_id(p_location_id)) AND location_id = p_location_id
   FOR UPDATE;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;

  -- Not monitored: sessions are recorded as normal, no count to check.
  IF NOT v_area.monitored THEN
    RETURN jsonb_build_object('success', true, 'area_id', v_area.id, 'monitored', false,
      'marked_full', v_area.marked_full);
  END IF;

  IF p_start_at <= now() THEN
    -- A walk-in starting now (or backdated) takes a space only if the area has one free
    -- right now. Future reservations don't hold a space before their start. The Full
    -- switch doesn't block staff check-ins (the app warns); the real count does.
    v_available := area_counted_spaces(v_area.id);
    IF v_available < 1 THEN
      RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available,
        'area_id', v_area.id);
    END IF;
    RETURN jsonb_build_object('success', true, 'available', v_available, 'area_id', v_area.id,
      'monitored', true, 'marked_full', v_area.marked_full);
  END IF;

  -- A future reservation: spaces held over its stay by sessions (started or reserved) in the area.
  SELECT COUNT(*) INTO v_overlapping
  FROM parking_sessions
  WHERE area_id = v_area.id
  AND status IN ('active', 'overdue')
  AND (p_end_at IS NULL OR started_at < p_end_at)
  AND (ended_at IS NULL OR ended_at > p_start_at);
  v_available := v_area.capacity - v_overlapping - v_area.manual_reserved_count - v_area.unavailable_count;
  IF v_available < 1 THEN
    RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available,
      'area_id', v_area.id);
  END IF;
  RETURN jsonb_build_object('success', true, 'available', v_available, 'area_id', v_area.id,
    'monitored', true);
END;
$function$;

DROP FUNCTION IF EXISTS start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid);
CREATE OR REPLACE FUNCTION start_walk_in(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_note text DEFAULT NULL,
  p_scheduled_end_at timestamptz DEFAULT NULL,
  p_started_at timestamptz DEFAULT NULL,
  p_rate_id uuid DEFAULT NULL,
  p_area_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_start timestamptz := COALESCE(p_started_at, now());
  v_err text;
  v_claim jsonb;
  v_session_id uuid;
  v_folio_id uuid;
  v_operator_id uuid;
  v_conflict jsonb;
  v_area areas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT can_work_location(p_location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, p_plate, v_start, p_scheduled_end_at, p_rate_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  -- 0067: the session's area (Main by default) must be this listing's and take the vehicle.
  SELECT * INTO v_area FROM areas
   WHERE id = COALESCE(p_area_id, main_area_id(p_location_id)) AND location_id = p_location_id;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;
  IF NOT area_allows_vehicle(v_area.vehicle_types, p_vehicle_type) THEN
    RETURN jsonb_build_object('error', 'vehicle_not_allowed', 'area', v_area.name);
  END IF;

  -- 0062: one started, open session per plate per listing (rj; still per listing, not per
  -- area, 0067). Reservations (future start) don't count and aren't blocked.
  IF v_start <= now() THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_location_id::text || ':' || plate_key(p_plate), 0));
    v_conflict := active_plate_conflict(p_location_id, p_plate, NULL);
    IF v_conflict IS NOT NULL THEN
      RETURN v_conflict;
    END IF;
  END IF;

  v_claim := claim_capacity(p_location_id, NULL, v_start, p_scheduled_end_at, 'session', v_area.id);
  IF v_claim->>'error' IS NOT NULL THEN
    RETURN v_claim;
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;

  INSERT INTO parking_sessions (
    location_id, area_id, plate, vehicle_type, note, scheduled_end_at,
    started_at, status, rate_id, rate_snapshot
  ) VALUES (
    p_location_id, v_area.id, upper(btrim(p_plate)), p_vehicle_type, NULLIF(btrim(p_note), ''), p_scheduled_end_at,
    v_start, 'active', p_rate_id,
    session_price(p_location_id, p_vehicle_type, v_start,
      COALESCE(p_scheduled_end_at, v_start + interval '1 hour'), p_rate_id)
  ) RETURNING id INTO v_session_id;

  INSERT INTO folios (operator_id, location_id, session_id, status)
  VALUES (v_operator_id, p_location_id, v_session_id, 'open')
  RETURNING id INTO v_folio_id;

  INSERT INTO availability_events (location_id, area_id, change, actor)
  VALUES (p_location_id, v_area.id, 'walk_in_started', v_uid);

  RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'folio_id', v_folio_id,
    'area_id', v_area.id);
END;
$function$;

DROP FUNCTION IF EXISTS update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid);
CREATE OR REPLACE FUNCTION update_walk_in_session(
  p_session_id uuid,
  p_started_at timestamptz,
  p_end_at timestamptz,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_rate_id uuid DEFAULT NULL,
  p_area_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_err text;
  v_conflict jsonb;
  v_area areas%ROWTYPE;
  v_claim jsonb;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  v_err := walk_in_input_error(v_s.location_id, p_vehicle_type, p_plate, p_started_at, p_end_at, p_rate_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;

  -- 0067: area (NULL keeps the current one). A new area or vehicle must be allowed there;
  -- unchanged area + vehicle are never blocked (an existing session can always be fixed).
  SELECT * INTO v_area FROM areas
   WHERE id = COALESCE(p_area_id, v_s.area_id, main_area_id(v_s.location_id))
     AND location_id = v_s.location_id;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;
  IF (v_area.id IS DISTINCT FROM v_s.area_id OR p_vehicle_type IS DISTINCT FROM v_s.vehicle_type)
     AND NOT area_allows_vehicle(v_area.vehicle_types, p_vehicle_type) THEN
    RETURN jsonb_build_object('error', 'vehicle_not_allowed', 'area', v_area.name);
  END IF;

  -- 0062: the session is (or becomes) started and its plate changes, or a reservation is
  -- moved to start now/earlier: no other started, open session with the same plate here.
  IF p_started_at <= now()
     AND (plate_key(p_plate) <> plate_key(v_s.plate) OR v_s.started_at > now()) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_s.location_id::text || ':' || plate_key(p_plate), 0));
    v_conflict := active_plate_conflict(v_s.location_id, p_plate, p_session_id);
    IF v_conflict IS NOT NULL THEN
      RETURN v_conflict;
    END IF;
  END IF;

  -- Moving a started session to another area takes a space there (per-area capacity).
  IF v_area.id IS DISTINCT FROM v_s.area_id THEN
    v_claim := claim_capacity(v_s.location_id, NULL,
      CASE WHEN p_started_at <= now() THEN now() ELSE p_started_at END, p_end_at, 'session', v_area.id);
    IF v_claim->>'error' IS NOT NULL THEN
      RETURN v_claim;
    END IF;
  END IF;

  UPDATE parking_sessions
     SET started_at = p_started_at,
         scheduled_end_at = p_end_at,
         billed_end_at = p_end_at,
         vehicle_type = p_vehicle_type,
         plate = upper(btrim(p_plate)),
         rate_id = p_rate_id,
         rate_auto = (p_rate_id IS NULL),
         area_id = v_area.id,
         status = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN 'active'::session_status ELSE status END,
         overdue_minutes = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN NULL ELSE overdue_minutes END,
         updated_at = now()
   WHERE id = p_session_id;

  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'edit_session', v_uid, jsonb_build_object(
    'started_at', p_started_at, 'end_at', p_end_at, 'vehicle_type', p_vehicle_type,
    'plate', upper(btrim(p_plate)), 'rate_id', p_rate_id, 'area_id', v_area.id));

  RETURN jsonb_build_object('success', true, 'parking', session_parking_quote(p_session_id));
END;
$function$;

-- 9. Session details carry the area; search uses the per-area aggregate.
CREATE OR REPLACE FUNCTION public.session_details(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_b jsonb;
  v_loc record;
  v_role text;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT l.name, l.operator_id, o.staff_can_waive INTO v_loc
    FROM locations l JOIN operators o ON o.id = l.operator_id WHERE l.id = v_s.location_id;
  SELECT role::text INTO v_role FROM operator_members
   WHERE operator_id = v_loc.operator_id AND profile_id = v_uid LIMIT 1;
  v_b := session_balance_parts(p_session_id);
  RETURN jsonb_build_object(
    'success', true,
    'session', jsonb_build_object(
      'id', v_s.id, 'location_id', v_s.location_id, 'location_name', v_loc.name,
      'plate', v_s.plate, 'vehicle_type', v_s.vehicle_type, 'note', v_s.note,
      'started_at', v_s.started_at, 'end_at', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at),
      'status', v_s.status, 'rate_id', v_s.rate_id, 'driver_id', v_s.driver_id,
      'rate_auto', v_s.rate_auto,
      'set_rate_name', (SELECT r.name FROM rates r WHERE r.id = v_s.rate_id),
      'rate_active', (SELECT r.active FROM rates r WHERE r.id = v_s.rate_id),
      'rate_changed_from', CASE WHEN v_s.rate_changed_from IS NULL THEN NULL ELSE
        (SELECT jsonb_build_object('id', r.id, 'name', r.name) FROM rates r WHERE r.id = v_s.rate_changed_from) END,
      'ended_at', v_s.ended_at, 'cancelled_at', v_s.cancelled_at,
      'area_id', v_s.area_id,
      'area_name', (SELECT a.name FROM areas a WHERE a.id = v_s.area_id),
      'reservation', v_s.status IN ('active', 'overdue') AND v_s.started_at > now()),
    'price', session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
      COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()),
      CASE WHEN v_s.rate_auto THEN NULL ELSE v_s.rate_id END)
      || jsonb_build_object('until_now', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at) IS NULL
        AND v_s.started_at <= now()),
    'parking', v_b->'parking', 'extra_fees', v_b->'extra_fees', 'paid', v_b->'paid',
    'balance', v_b->'balance', 'waived', v_b->'waived',
    'refunded', COALESCE((SELECT SUM(p.amount) FROM payments p
      WHERE p.folio_id = (v_b->>'folio_id')::uuid AND p.direction = 'refund'), 0),
    'refundable', session_refundable(p_session_id),
    'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type,
        'description', c.description, 'amount', c.amount, 'created_at', c.created_at) ORDER BY c.created_at)
      FROM folio_charges c WHERE c.folio_id = (v_b->>'folio_id')::uuid AND c.voided_at IS NULL
        AND c.type IN ('additional_fee', 'adjustment')), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount,
        'direction', p.direction, 'method', p.method, 'note', p.note, 'received_at', p.received_at,
        'recorded_by', COALESCE(pr.display_name, pr.phone, 'Staff')) ORDER BY p.received_at)
      FROM payments p LEFT JOIN profiles pr ON pr.id = p.recorded_by
      WHERE p.folio_id = (v_b->>'folio_id')::uuid), '[]'::jsonb),
    'can_waive', v_role IN ('owner', 'manager') OR (v_role = 'staff' AND COALESCE(v_loc.staff_can_waive, false))
  );
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
    -- 0067: free spaces over the monitored areas that take the vehicle (NULL = none monitored).
    location_free_spaces(l.id, p_vehicle_type) AS available_count,
    l.capacity,
    -- 0067: open_status = not Full (Full only when every area taking the vehicle is full).
    NOT location_is_full(l.id, p_vehicle_type) AS open_status,
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
  -- 0067: a vehicle filter only keeps listings with an area that takes it.
  AND (p_vehicle_type IS NULL OR EXISTS (
    SELECT 1 FROM areas a WHERE a.location_id = l.id
    AND area_allows_vehicle(a.vehicle_types, p_vehicle_type)))
  AND (NOT p_hide_full OR NOT location_is_full(l.id, p_vehicle_type))
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
      WHEN 'availability' THEN CASE WHEN location_is_full(l.id, p_vehicle_type) THEN 1000000000
        ELSE -COALESCE(location_free_spaces(l.id, p_vehicle_type), 0) END
      WHEN 'rating' THEN -lrs.avg_rating
      ELSE ST_Distance(l.geog, v_origin)
    END
  LIMIT p_limit;
END;
$function$;

-- 10. Grants. Read functions stay public (search, Location details); writers need a login;
-- internal helpers aren't callable by clients at all.
GRANT EXECUTE ON FUNCTION public.location_free_spaces(uuid, vehicle_type) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.location_counted_spaces(uuid, vehicle_type) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.location_is_full(uuid, vehicle_type) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refresh_location_availability(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_capacity(uuid, uuid, timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_area_settings(uuid, integer, vehicle_type[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_area_settings(uuid, integer, vehicle_type[], boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_area_counts(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_area_counts(uuid, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_area_full(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_area_full(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid, uuid) TO authenticated, service_role;
