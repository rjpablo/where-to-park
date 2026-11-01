-- One active session per plate per listing (rj t129u/t130u).
-- Active = started (started_at <= now()) and not ended or cancelled (status active/overdue).
-- Future-start reservations don't count. Plates compare case- and space-insensitively.
-- Different listings are independent. Enforced in start_walk_in, update_walk_in_session
-- and override_session_start; the error names the existing session so the app can open it.
-- A reservation whose start passes while the same plate is already parked is not blocked
-- automatically (no background job): both show on the board and staff end one.

CREATE OR REPLACE FUNCTION public.plate_key(p_plate text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT upper(regexp_replace(COALESCE(p_plate, ''), '\s', '', 'g')) $$;

CREATE OR REPLACE FUNCTION public.active_plate_conflict(p_location_id uuid, p_plate text, p_exclude uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'error', 'plate_active',
           'session_id', s.id,
           'plate', s.plate,
           'started_at', s.started_at)
    FROM parking_sessions s
   WHERE s.location_id = p_location_id
     AND s.status IN ('active', 'overdue')
     AND s.started_at <= now()
     AND plate_key(s.plate) = plate_key(p_plate)
     AND plate_key(p_plate) <> ''
     AND (p_exclude IS NULL OR s.id <> p_exclude)
   ORDER BY s.started_at DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.active_plate_conflict(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS parking_sessions_open_plate_idx
  ON parking_sessions (location_id, plate_key(plate))
  WHERE status IN ('active', 'overdue');

CREATE OR REPLACE FUNCTION public.start_walk_in(p_location_id uuid, p_vehicle_type vehicle_type, p_plate text, p_note text DEFAULT NULL::text, p_scheduled_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rate_id uuid DEFAULT NULL::uuid)
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

  -- 0062: one started, open session per plate per listing (rj). Reservations (future start)
  -- don't count and aren't blocked. The lock serialises check-ins of the same plate here.
  IF v_start <= now() THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_location_id::text || ':' || plate_key(p_plate), 0));
    v_conflict := active_plate_conflict(p_location_id, p_plate, NULL);
    IF v_conflict IS NOT NULL THEN
      RETURN v_conflict;
    END IF;
  END IF;

  v_claim := claim_capacity(p_location_id, NULL, v_start, p_scheduled_end_at, 'session');
  IF v_claim->>'error' IS NOT NULL THEN
    RETURN v_claim;
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;

  INSERT INTO parking_sessions (
    location_id, plate, vehicle_type, note, scheduled_end_at,
    started_at, status, rate_id, rate_snapshot
  ) VALUES (
    p_location_id, upper(btrim(p_plate)), p_vehicle_type, NULLIF(btrim(p_note), ''), p_scheduled_end_at,
    v_start, 'active', p_rate_id,
    session_price(p_location_id, p_vehicle_type, v_start,
      COALESCE(p_scheduled_end_at, v_start + interval '1 hour'), p_rate_id)
  ) RETURNING id INTO v_session_id;

  INSERT INTO folios (operator_id, location_id, session_id, status)
  VALUES (v_operator_id, p_location_id, v_session_id, 'open')
  RETURNING id INTO v_folio_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, 'walk_in_started', v_uid);

  RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'folio_id', v_folio_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_walk_in_session(p_session_id uuid, p_started_at timestamp with time zone, p_end_at timestamp with time zone, p_vehicle_type vehicle_type, p_plate text, p_rate_id uuid DEFAULT NULL::uuid)
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

  -- 0062: the session is (or becomes) started and its plate changes, or a reservation is
  -- moved to start now/earlier: no other started, open session with the same plate here.
  -- Edits that keep the plate and an already-past start (end time, rate, vehicle) are
  -- never blocked, so an existing overlap can still be fixed or ended.
  IF p_started_at <= now()
     AND (plate_key(p_plate) <> plate_key(v_s.plate) OR v_s.started_at > now()) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_s.location_id::text || ':' || plate_key(p_plate), 0));
    v_conflict := active_plate_conflict(v_s.location_id, p_plate, p_session_id);
    IF v_conflict IS NOT NULL THEN
      RETURN v_conflict;
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
         status = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN 'active'::session_status ELSE status END,
         overdue_minutes = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN NULL ELSE overdue_minutes END,
         updated_at = now()
   WHERE id = p_session_id;

  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'edit_session', v_uid, jsonb_build_object(
    'started_at', p_started_at, 'end_at', p_end_at, 'vehicle_type', p_vehicle_type,
    'plate', upper(btrim(p_plate)), 'rate_id', p_rate_id));

  RETURN jsonb_build_object('success', true, 'parking', session_parking_quote(p_session_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.override_session_start(p_session_id uuid, p_started_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_session RECORD;
  v_conflict jsonb;
BEGIN
  SELECT s.*, l.operator_id INTO v_session
  FROM parking_sessions s
  JOIN locations l ON l.id = s.location_id
  WHERE s.id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_uid IS NULL OR NOT is_operator_member(v_uid, v_session.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'reason_required');
  END IF;
  -- 0062: moving a reservation's start to now/earlier must not create a second started
  -- session for the plate here.
  IF p_started_at <= now() AND v_session.started_at > now()
     AND v_session.status IN ('active', 'overdue') THEN
    v_conflict := active_plate_conflict(v_session.location_id, v_session.plate, p_session_id);
    IF v_conflict IS NOT NULL THEN
      RETURN v_conflict;
    END IF;
  END IF;
  UPDATE parking_sessions
  SET started_at = p_started_at,
      start_overridden_by = v_uid,
      override_reason = btrim(p_reason)
  WHERE id = p_session_id;
  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'override_start', v_uid, jsonb_build_object('started_at', p_started_at, 'reason', p_reason));
  RETURN jsonb_build_object('success', true, 'parking_so_far', session_parking_quote(p_session_id));
END;
$function$;
