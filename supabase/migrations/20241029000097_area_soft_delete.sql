-- PAD-6 follow-up (rj t237u): deleting an area is a soft delete.
--
-- areas.deleted_at marks a deleted area. A deleted area is hidden everywhere: the app
-- can't read it (RLS), and it is left out of availability counts, capacity totals,
-- Full, search vehicle matching, reservation area assignment, check-in and session
-- area choices, rate pricing and rate editing. Its rates are soft-deleted with it (as in
-- 0096). Ended sessions and other history keep pointing at the deleted area (they are no
-- longer moved to Main). The Main area still can't be deleted. A deleted area's name can
-- be used again.

ALTER TABLE public.areas ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Names are unique among the areas still in use only.
DROP INDEX IF EXISTS public.areas_name_unique;
CREATE UNIQUE INDEX areas_name_unique ON public.areas (location_id, lower(btrim(name)))
  WHERE deleted_at IS NULL;

-- Main can never be deleted (hard or soft).
ALTER TABLE public.areas DROP CONSTRAINT IF EXISTS areas_main_not_deleted;
ALTER TABLE public.areas ADD CONSTRAINT areas_main_not_deleted
  CHECK (NOT (is_main AND deleted_at IS NOT NULL));

-- The app (anon, signed-in users, staff, operators, admins) never sees deleted areas,
-- including embedded areas on a listing. Server functions read the table directly.
DROP POLICY IF EXISTS "Deleted areas are hidden" ON public.areas;
CREATE POLICY "Deleted areas are hidden" ON public.areas AS RESTRICTIVE FOR ALL
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);

-- Soft- or hard-deleting an area soft-deletes its rates.
CREATE OR REPLACE FUNCTION public.areas_retire_rates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    UPDATE rates
       SET deleted_at = now(), active = false, archived_at = COALESCE(archived_at, now())
     WHERE area_id = OLD.id AND deleted_at IS NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS areas_retire_rates ON public.areas;
CREATE TRIGGER areas_retire_rates BEFORE DELETE OR UPDATE OF deleted_at ON public.areas
  FOR EACH ROW EXECUTE FUNCTION areas_retire_rates();

CREATE OR REPLACE FUNCTION public.location_free_spaces(p_location_id uuid, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT SUM(area_free_spaces(a.id))::int FROM areas a
   WHERE a.location_id = p_location_id AND a.monitored AND a.deleted_at IS NULL
     AND area_allows_vehicle(a.vehicle_types, p_vehicle_type);
$function$;

CREATE OR REPLACE FUNCTION public.location_counted_spaces(p_location_id uuid, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT SUM(area_counted_spaces(a.id))::int FROM areas a
   WHERE a.location_id = p_location_id AND a.monitored AND a.deleted_at IS NULL
     AND area_allows_vehicle(a.vehicle_types, p_vehicle_type);
$function$;

CREATE OR REPLACE FUNCTION public.location_is_full(p_location_id uuid, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(bool_and(area_is_full(a.id)), true) FROM areas a
   WHERE a.location_id = p_location_id AND a.deleted_at IS NULL AND area_allows_vehicle(a.vehicle_types, p_vehicle_type);
$function$;

CREATE OR REPLACE FUNCTION public.reservation_area_id(p_location_id uuid, p_vehicle vehicle_type)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.id
    FROM areas a
   WHERE a.location_id = p_location_id
     AND a.deleted_at IS NULL
     AND area_allows_vehicle(a.vehicle_types, p_vehicle)
   ORDER BY a.is_main DESC, a.sort_order, a.name
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.refresh_location_availability(p_location_ids uuid[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE locations l SET
    capacity = COALESCE((SELECT SUM(a.capacity) FROM areas a WHERE a.location_id = l.id AND a.monitored AND a.deleted_at IS NULL), 0),
    manual_reserved_count = COALESCE((SELECT SUM(a.manual_reserved_count) FROM areas a
      WHERE a.location_id = l.id AND a.monitored AND a.deleted_at IS NULL), 0),
    unavailable_count = COALESCE((SELECT SUM(a.unavailable_count) FROM areas a
      WHERE a.location_id = l.id AND a.monitored AND a.deleted_at IS NULL), 0),
    marked_full = location_is_full(l.id),
    available_count = COALESCE(location_free_spaces(l.id), 0),
    availability_updated_at = now()
  WHERE l.id = ANY (p_location_ids);
$function$;

CREATE OR REPLACE FUNCTION public.search_nearby(p_lat numeric, p_lng numeric, p_radius_m integer DEFAULT 1000, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type, p_monthly_only boolean DEFAULT false, p_hide_full boolean DEFAULT false, p_sort_by text DEFAULT 'distance'::text, p_limit integer DEFAULT 50, p_rate_type rate_type DEFAULT NULL::rate_type, p_free_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, name text, listing_type listing_type, address text, lat numeric, lng numeric, distance_m integer, available_count integer, capacity integer, open_status boolean, tracking_mode tracking_mode, availability_updated_at timestamp with time zone, stale_after_min integer, verification_status verification_status, cover_photo_url text, starting_rate numeric, avg_rating numeric, review_count integer, has_monthly boolean, starting_rate_info jsonb, is_free boolean)
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
    CASE WHEN l.is_free THEN NULL ELSE (
      SELECT r.hourly_amount
      FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND r.deleted_at IS NULL
      AND rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type)
      AND r.rate_type = 'hourly'
      ORDER BY r.is_default DESC
      LIMIT 1
    ) END AS starting_rate,
    lrs.avg_rating,
    lrs.review_count,
    (NOT l.is_free AND EXISTS (
      SELECT 1 FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND r.deleted_at IS NULL
      AND (p_vehicle_type IS NULL OR rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type))
      AND r.rate_type = 'monthly'
    )) AS has_monthly,
    -- PAD-6: rates of any area count, if the area (and the rate) takes the vehicle.
    -- 0061: the rate a result card shows when there is no hourly rate (flat then hourly,
    -- daily or monthly): the default first, then the oldest; NULL when none applies.
    CASE WHEN l.is_free THEN NULL ELSE (
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
      AND r.deleted_at IS NULL
      AND rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type)
      ORDER BY r.is_default DESC, r.created_at
      LIMIT 1
    ) END AS starting_rate_info,
    l.is_free
  FROM locations l
  LEFT JOIN location_rating_stats lrs ON lrs.location_id = l.id
  WHERE l.published = true
  AND l.deleted_at IS NULL
  AND ST_DWithin(l.geog, v_origin, p_radius_m)
  AND (NOT p_monthly_only OR EXISTS (
    SELECT 1 FROM rates r
    WHERE r.location_id = l.id
    AND r.active = true
    AND r.deleted_at IS NULL
    AND (p_vehicle_type IS NULL OR rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type))
    AND r.rate_type = 'monthly'
  ))
  AND (NOT COALESCE(p_free_only, false) OR l.is_free)
  AND (COALESCE(p_free_only, false) OR p_rate_type IS NULL OR EXISTS (
    SELECT 1 FROM rates r
    WHERE r.location_id = l.id
    AND r.active = true
    AND r.deleted_at IS NULL
    AND (p_vehicle_type IS NULL OR rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type))
    AND r.rate_type = p_rate_type
  ))
  -- 0067: a vehicle filter only keeps listings with an area that takes it.
  AND (p_vehicle_type IS NULL OR EXISTS (
    SELECT 1 FROM areas a WHERE a.location_id = l.id AND a.deleted_at IS NULL
    AND area_allows_vehicle(a.vehicle_types, p_vehicle_type)))
  AND (NOT p_hide_full OR NOT location_is_full(l.id, p_vehicle_type))
  ORDER BY
    CASE p_sort_by
      WHEN 'price' THEN CASE WHEN l.is_free THEN 0 ELSE (
        SELECT r.hourly_amount
        FROM rates r
        WHERE r.location_id = l.id
        AND r.active = true
        AND r.deleted_at IS NULL
        AND rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type)
        AND r.rate_type = 'hourly'
        ORDER BY r.is_default DESC
        LIMIT 1
      ) END
      WHEN 'availability' THEN CASE WHEN location_is_full(l.id, p_vehicle_type) THEN 1000000000
        ELSE -COALESCE(location_free_spaces(l.id, p_vehicle_type), 0) END
      WHEN 'rating' THEN -lrs.avg_rating
      ELSE ST_Distance(l.geog, v_origin)
    END
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_capacity(p_location_id uuid, p_slot_id uuid DEFAULT NULL::uuid, p_start_at timestamp with time zone DEFAULT now(), p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_kind text DEFAULT 'session'::text, p_area_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     AND deleted_at IS NULL
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

CREATE OR REPLACE FUNCTION public.start_walk_in(p_location_id uuid, p_vehicle_type vehicle_type, p_plate text, p_note text DEFAULT NULL::text, p_scheduled_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_allow_full boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, p_plate, v_start, p_scheduled_end_at, p_rate_id,
    COALESCE(p_area_id, main_area_id(p_location_id)));
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  -- 0067: the session's area (Main by default) must be this listing's and take the vehicle.
  SELECT * INTO v_area FROM areas
   WHERE id = COALESCE(p_area_id, main_area_id(p_location_id)) AND location_id = p_location_id
     AND deleted_at IS NULL;
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

  -- 0083 (rj t184u): a full area (no spaces left, or switched Full) no longer blocks a
  -- session; the staff member must confirm (p_allow_full). Other errors still block.
  v_claim := claim_capacity(p_location_id, NULL, v_start, p_scheduled_end_at, 'session', v_area.id);
  IF v_claim->>'error' = 'no_longer_available' AND v_claim ? 'area_id' THEN
    IF NOT COALESCE(p_allow_full, false) THEN
      RETURN jsonb_build_object('error', 'area_full', 'reason', 'no_spaces', 'area', v_area.name,
        'area_id', v_area.id, 'available', GREATEST(0, COALESCE((v_claim->>'available')::int, 0)));
    END IF;
  ELSIF v_claim->>'error' IS NOT NULL THEN
    RETURN v_claim;
  ELSIF v_start <= now() AND v_area.marked_full AND NOT COALESCE(p_allow_full, false) THEN
    RETURN jsonb_build_object('error', 'area_full', 'reason', 'marked_full', 'area', v_area.name,
      'area_id', v_area.id);
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;

  INSERT INTO parking_sessions (
    location_id, area_id, plate, vehicle_type, note, scheduled_end_at,
    started_at, status, rate_id, rate_snapshot
  ) VALUES (
    p_location_id, v_area.id, upper(btrim(p_plate)), p_vehicle_type, NULLIF(btrim(p_note), ''), p_scheduled_end_at,
    v_start, 'active', p_rate_id,
    session_price(p_location_id, p_vehicle_type, v_start,
      COALESCE(p_scheduled_end_at, v_start + interval '1 hour'), p_rate_id, v_area.id)
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

CREATE OR REPLACE FUNCTION public.update_walk_in_session(p_session_id uuid, p_started_at timestamp with time zone, p_end_at timestamp with time zone, p_vehicle_type vehicle_type, p_plate text, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_allow_full boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_err := walk_in_input_error(v_s.location_id, p_vehicle_type, p_plate, p_started_at, p_end_at, p_rate_id,
    COALESCE(p_area_id, v_s.area_id, main_area_id(v_s.location_id)));
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;

  -- 0067: area (NULL keeps the current one). A new area or vehicle must be allowed there;
  -- unchanged area + vehicle are never blocked (an existing session can always be fixed).
  SELECT * INTO v_area FROM areas
   WHERE id = COALESCE(p_area_id, v_s.area_id, main_area_id(v_s.location_id))
     AND location_id = v_s.location_id AND deleted_at IS NULL;
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

  -- Moving a session to another area takes a space there (per-area capacity). 0083: a full
  -- area (no spaces left, or switched Full) needs the staff member's confirmation
  -- (p_allow_full) instead of blocking. Staying in the same area is never checked.
  IF v_area.id IS DISTINCT FROM v_s.area_id THEN
    v_claim := claim_capacity(v_s.location_id, NULL,
      CASE WHEN p_started_at <= now() THEN now() ELSE p_started_at END, p_end_at, 'session', v_area.id);
    IF v_claim->>'error' = 'no_longer_available' AND v_claim ? 'area_id' THEN
      IF NOT COALESCE(p_allow_full, false) THEN
        RETURN jsonb_build_object('error', 'area_full', 'reason', 'no_spaces', 'area', v_area.name,
          'area_id', v_area.id, 'available', GREATEST(0, COALESCE((v_claim->>'available')::int, 0)));
      END IF;
    ELSIF v_claim->>'error' IS NOT NULL THEN
      RETURN v_claim;
    ELSIF p_started_at <= now() AND v_area.marked_full AND NOT COALESCE(p_allow_full, false) THEN
      RETURN jsonb_build_object('error', 'area_full', 'reason', 'marked_full', 'area', v_area.name,
        'area_id', v_area.id);
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

CREATE OR REPLACE FUNCTION public.set_reservation_area(p_session_id uuid, p_area_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_area areas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.cancelled_at IS NOT NULL OR v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  IF v_s.started_at <= now() THEN
    RETURN jsonb_build_object('error', 'already_started');
  END IF;
  SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = v_s.location_id
     AND deleted_at IS NULL;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;
  IF NOT area_allows_vehicle(v_area.vehicle_types, v_s.vehicle_type) THEN
    RETURN jsonb_build_object('error', 'vehicle_not_allowed', 'area', v_area.name);
  END IF;
  -- PAD-6: rates are per area. An auto rate is picked again for the new area, and a chosen
  -- rate that doesn't apply there goes back to auto.
  UPDATE parking_sessions
     SET area_id = v_area.id,
         rate_id = CASE
           WHEN rate_auto OR rate_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM walk_in_rates(v_s.location_id, v_s.vehicle_type, v_s.started_at, v_area.id) r
              WHERE r.id = v_s.rate_id) THEN NULL
           ELSE rate_id END,
         updated_at = now()
   WHERE id = p_session_id;
  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'set_reservation_area', v_uid, jsonb_build_object('area_id', v_area.id));
  RETURN jsonb_build_object('success', true, 'area_id', v_area.id, 'area_name', v_area.name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_rate(p_location_id uuid, p_name text, p_rate_type rate_type, p_rate_id uuid DEFAULT NULL::uuid, p_is_default boolean DEFAULT false, p_hourly_amount numeric DEFAULT NULL::numeric, p_daily_amount numeric DEFAULT NULL::numeric, p_monthly_amount numeric DEFAULT NULL::numeric, p_first_hours integer DEFAULT NULL::integer, p_first_amount numeric DEFAULT NULL::numeric, p_succeeding_hourly_amount numeric DEFAULT NULL::numeric, p_max_per_day numeric DEFAULT NULL::numeric, p_area_id uuid DEFAULT NULL::uuid, p_effective_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_effective_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_active boolean DEFAULT true, p_days_of_week integer[] DEFAULT NULL::integer[], p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_rate_id UUID;
  v_is_default BOOLEAN;
  v_days INTEGER[];
  v_area areas%ROWTYPE;
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

  -- Days of week (0 = Sunday … 6 = Saturday, Asia/Manila); empty = every day (NULL).
  IF p_days_of_week IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_days_of_week) d WHERE d IS NULL OR d < 0 OR d > 6) THEN
    RETURN jsonb_build_object('error', 'days_of_week_invalid');
  END IF;
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE array_agg(d ORDER BY d) END
    INTO v_days
    FROM (SELECT DISTINCT unnest(p_days_of_week) d) x;

  v_is_default := COALESCE(p_is_default, false);

  -- The default rate applies every day with no dates (any rate type is fine).
  IF v_is_default OR (p_rate_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rates WHERE id = p_rate_id AND location_id = p_location_id AND is_default
  )) THEN
    IF p_effective_from IS NOT NULL OR p_effective_to IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_dates');
    END IF;
    IF v_days IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_days');
    END IF;
    IF p_vehicle_type IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_vehicle');
    END IF;
    IF p_area_id IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_area');
    END IF;
    IF p_active IS NOT NULL AND NOT p_active THEN
      RETURN jsonb_build_object('error', 'default_must_be_active');
    END IF;
  END IF;
  -- PAD-6: the default is listing-wide and others need an area, so an old default can't
  -- be turned into a plain rate here: change the default rate itself instead.
  IF v_is_default AND EXISTS (
    SELECT 1 FROM rates WHERE location_id = p_location_id AND is_default
       AND (p_rate_id IS NULL OR id <> p_rate_id)
  ) THEN
    RETURN jsonb_build_object('error', 'default_exists');
  END IF;
  -- PAD-6: every rate except the default belongs to one area of this listing, and its
  -- vehicle limit must be one the area takes. Deleted rates can't be edited.
  IF p_rate_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rates WHERE id = p_rate_id AND location_id = p_location_id AND deleted_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('error', 'rate_deleted');
  END IF;
  IF NOT v_is_default AND NOT (p_rate_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rates WHERE id = p_rate_id AND location_id = p_location_id AND is_default
  )) THEN
    IF p_area_id IS NULL THEN
      RETURN jsonb_build_object('error', 'area_required');
    END IF;
    SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = p_location_id
      AND deleted_at IS NULL;
    IF v_area.id IS NULL THEN
      RETURN jsonb_build_object('error', 'area_not_found');
    END IF;
    IF p_vehicle_type IS NOT NULL AND NOT area_allows_vehicle(v_area.vehicle_types, p_vehicle_type) THEN
      RETURN jsonb_build_object('error', 'vehicle_not_in_area', 'area', v_area.name);
    END IF;
  END IF;

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
      area_id, effective_from, effective_to, active, days_of_week, vehicle_type
    ) VALUES (
      p_location_id, v_is_default, btrim(p_name), p_rate_type,
      p_hourly_amount, p_daily_amount, p_monthly_amount,
      p_first_hours, p_first_amount, p_succeeding_hourly_amount, p_max_per_day,
      p_area_id, p_effective_from, p_effective_to, COALESCE(p_active, true), v_days, p_vehicle_type
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
      active = COALESCE(p_active, active),
      days_of_week = v_days,
      vehicle_type = p_vehicle_type
    WHERE id = p_rate_id AND location_id = p_location_id
    RETURNING id INTO v_rate_id;
    IF v_rate_id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'rate_id', v_rate_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_area_full(p_area_id uuid, p_full boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_area areas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_area FROM areas WHERE id = p_area_id AND deleted_at IS NULL FOR UPDATE;
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
$function$;

CREATE OR REPLACE FUNCTION public.set_area_counts(p_area_id uuid, p_reserved integer DEFAULT NULL::integer, p_unavailable integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT * INTO v_area FROM areas WHERE id = p_area_id AND deleted_at IS NULL FOR UPDATE;
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
  -- 0083: refuse only when this change holds MORE spaces than are free; lowering them is
  -- always allowed (an area over capacity after a confirmed extra session).
  IF v_left < 0 AND v_reserved + v_unavailable > v_area.manual_reserved_count + v_area.unavailable_count THEN
    RETURN jsonb_build_object('error', 'no_longer_available', 'available', GREATEST(0, v_left));
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
$function$;

CREATE OR REPLACE FUNCTION public.set_area_settings(p_area_id uuid, p_capacity integer, p_vehicle_types vehicle_type[], p_monitored boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT * INTO v_area FROM areas WHERE id = p_area_id AND deleted_at IS NULL FOR UPDATE;
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
$function$;

CREATE OR REPLACE FUNCTION public.upsert_area(p_location_id uuid, p_name text, p_area_id uuid DEFAULT NULL::uuid, p_sort_order integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = p_location_id
      AND deleted_at IS NULL FOR UPDATE;
    IF v_area.id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
    -- rj t139u: Main can't be renamed (for now).
    IF v_area.is_main AND v_name <> v_area.name THEN
      RETURN jsonb_build_object('error', 'main_area_locked');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM areas WHERE location_id = p_location_id AND deleted_at IS NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.parking_sessions_area()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.area_id IS NULL THEN
    NEW.area_id := main_area_id(NEW.location_id);
  ELSIF NOT EXISTS (SELECT 1 FROM areas WHERE id = NEW.area_id AND location_id = NEW.location_id
                     AND (deleted_at IS NULL
                          OR (TG_OP = 'UPDATE' AND NEW.area_id = OLD.area_id))) THEN
    RAISE EXCEPTION 'area_not_in_listing';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_area(p_area_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_area areas%ROWTYPE;
  v_operator_id UUID;
BEGIN
  SELECT * INTO v_area FROM areas WHERE id = p_area_id AND deleted_at IS NULL FOR UPDATE;
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
  -- PAD-6: not while the area has reservations (future or awaiting approval).
  IF EXISTS (SELECT 1 FROM parking_sessions WHERE area_id = p_area_id AND status IN ('active', 'overdue')
              AND cancelled_at IS NULL
              AND (started_at > now() OR approval_status = 'pending'))
     OR EXISTS (SELECT 1 FROM reservations WHERE area_id = p_area_id
              AND status IN ('awaiting_payment', 'pending_approval', 'confirmed', 'active')) THEN
    RETURN jsonb_build_object('error', 'area_has_reservations');
  END IF;
  IF EXISTS (SELECT 1 FROM parking_sessions WHERE area_id = p_area_id AND status IN ('active', 'overdue')) THEN
    RETURN jsonb_build_object('error', 'area_has_sessions');
  END IF;
  -- PAD-6 (rj t237u): a soft delete. Ended sessions and history keep pointing at the
  -- area; its rates are soft-deleted (areas_retire_rates) and stop showing and pricing.
  UPDATE areas SET deleted_at = now() WHERE id = p_area_id;
  INSERT INTO availability_events (location_id, change, actor)
  VALUES (v_area.location_id, 'area_deleted:' || v_area.name, v_uid);
  RETURN jsonb_build_object('success', true);
END;
$function$;

NOTIFY pgrst, 'reload schema';
