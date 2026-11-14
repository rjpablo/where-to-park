-- 0083 Full areas don't block sessions; staff confirm instead (rj t184u: "Zero slots
-- shouldn't block the creation of a session. If an area has zero slots left or is marked
-- as full, ask staff/operator for confirmation before creating the session. The
-- Availability screen should still show 0 available spaces (not negative value)").
--
-- * start_walk_in / update_walk_in_session gain p_allow_full (default false). When the
--   area has no space left (counted from sessions, held and unavailable spaces) or is
--   switched Full (starting now), they answer
--   {error: 'area_full', reason: 'no_spaces' | 'marked_full', area, area_id, available?}
--   and the app asks "Create the session anyway?"; with p_allow_full = true the session is
--   created. Every other check stays (permission, plate already parked, vehicle not
--   allowed, deleted listing, a taken slot).
--   Before: no space left blocked with no_longer_available; Full only showed a warning.
-- * Free-space counts were already floored at 0 on the server (area_counted_spaces uses
--   GREATEST(0, …)); occupancy (area_occupied_spaces) stays the real count.
-- * set_area_counts: when an area is over capacity, lowering held/unavailable spaces is
--   allowed again (it used to fail because the space left was already below 0); raising
--   them past the free spaces is still refused.

DROP FUNCTION IF EXISTS public.start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS public.update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid, uuid);

CREATE FUNCTION public.start_walk_in(p_location_id uuid, p_vehicle_type vehicle_type, p_plate text, p_note text DEFAULT NULL::text, p_scheduled_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_allow_full boolean DEFAULT false)
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

CREATE FUNCTION public.update_walk_in_session(p_session_id uuid, p_started_at timestamp with time zone, p_end_at timestamp with time zone, p_vehicle_type vehicle_type, p_plate text, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_allow_full boolean DEFAULT false)
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

REVOKE ALL ON FUNCTION public.start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid, uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid, uuid, boolean) TO authenticated, service_role;

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
