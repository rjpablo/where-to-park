-- 0084 Driver reservation requests.
-- A driver reservation is a future-start parking session (the same row staff already
-- use). approval_status 'pending' is For Approval; staff approve it to 'approved'.
-- NULL stays a staff walk-in, which is approved as soon as it is saved.
-- Rejecting sets 'rejected' and closes the session. Cancelling also closes it but
-- leaves approval_status alone, so the driver's list can tell Rejected from Cancelled.
-- The driver never picks an area: reservation_area_id assigns the main area when it
-- takes the vehicle, otherwise the first other area that does. Staff can move it
-- later without telling the driver. A request does not count as occupying a space
-- until its start (future sessions already work that way).

ALTER TABLE parking_sessions
  ADD COLUMN IF NOT EXISTS approval_status text;

ALTER TABLE parking_sessions
  DROP CONSTRAINT IF EXISTS parking_sessions_approval_status_check;
ALTER TABLE parking_sessions
  ADD CONSTRAINT parking_sessions_approval_status_check
  CHECK (approval_status IS NULL OR approval_status IN ('pending', 'approved', 'rejected'));

-- Main area first when it takes the vehicle, then the operator's order.
CREATE OR REPLACE FUNCTION public.reservation_area_id(p_location_id uuid, p_vehicle vehicle_type)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id
    FROM areas a
   WHERE a.location_id = p_location_id
     AND area_allows_vehicle(a.vehicle_types, p_vehicle)
   ORDER BY a.is_main DESC, a.sort_order, a.name
   LIMIT 1
$$;

-- Another future reservation at this listing for the same plate (case and spaces
-- ignored) whose stay crosses this window. Pending requests count. NULL when clear.
CREATE OR REPLACE FUNCTION public.reservation_same_plate_conflict(
  p_location_id uuid,
  p_plate text,
  p_start timestamptz,
  p_end timestamptz,
  p_except uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('session_id', s.id, 'plate', s.plate, 'started_at', s.started_at)
    FROM parking_sessions s
   WHERE s.location_id = p_location_id
     AND s.id IS DISTINCT FROM p_except
     AND s.cancelled_at IS NULL
     AND s.status IN ('active', 'overdue')
     AND s.started_at > now()
     AND plate_key(s.plate) = plate_key(p_plate)
     AND plate_key(p_plate) <> ''
     AND s.started_at < COALESCE(p_end, 'infinity'::timestamptz)
     AND p_start < COALESCE(s.scheduled_end_at, 'infinity'::timestamptz)
   ORDER BY s.started_at
   LIMIT 1
$$;

-- Shared checks for a quote, a new request and an edit. Does not write.
CREATE OR REPLACE FUNCTION public.reservation_check(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_started_at timestamptz,
  p_end_at timestamptz,
  p_require_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plate text := upper(btrim(COALESCE(p_plate, '')));
  v_err text;
  v_area uuid;
  v_price jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM locations WHERE id = p_location_id AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_require_enabled AND NOT COALESCE(
    (SELECT reservations_enabled FROM location_policies WHERE location_id = p_location_id),
    false
  ) THEN
    RETURN jsonb_build_object('error', 'reservations_disabled');
  END IF;
  IF p_started_at IS NULL OR p_started_at <= now() THEN
    RETURN jsonb_build_object('error', 'start_not_future');
  END IF;
  IF p_end_at IS NULL THEN
    RETURN jsonb_build_object('error', 'end_required');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, v_plate, p_started_at, p_end_at, NULL);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  v_area := reservation_area_id(p_location_id, p_vehicle_type);
  IF v_area IS NULL THEN
    RETURN jsonb_build_object('error', 'no_area');
  END IF;
  v_price := session_price(p_location_id, p_vehicle_type, p_started_at, p_end_at, NULL);
  IF v_price ? 'error' THEN
    RETURN jsonb_build_object('error', 'no_applicable_rate');
  END IF;
  RETURN jsonb_build_object(
    'plate', v_plate,
    'area_id', v_area,
    'price', v_price,
    'amount', v_price->'amount'
  );
END;
$$;

-- Saved vehicle supplies type and plate. "Input details" uses the arguments and,
-- when a nickname is present, saves a vehicle without changing the default.
CREATE OR REPLACE FUNCTION public.reservation_vehicle(
  p_vehicle_id uuid,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_save_nickname text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_type vehicle_type;
  v_plate text;
  v_saved jsonb;
BEGIN
  IF p_vehicle_id IS NOT NULL THEN
    SELECT vehicle_type, NULLIF(btrim(COALESCE(plate, '')), '')
      INTO v_type, v_plate
      FROM vehicles
     WHERE id = p_vehicle_id AND driver_id = v_uid;
    IF v_type IS NULL THEN
      RETURN jsonb_build_object('error', 'vehicle_not_found');
    END IF;
    IF v_plate IS NULL THEN
      RETURN jsonb_build_object('error', 'plate_required');
    END IF;
    RETURN jsonb_build_object('vehicle_type', v_type, 'plate', v_plate);
  END IF;
  IF p_save_nickname IS NOT NULL THEN
    IF btrim(p_save_nickname) = '' THEN
      RETURN jsonb_build_object('error', 'nickname_required');
    END IF;
    v_saved := upsert_vehicle(btrim(p_save_nickname), p_vehicle_type, p_plate, NULL, false);
    IF v_saved->>'error' IS NOT NULL THEN
      RETURN v_saved;
    END IF;
  END IF;
  RETURN jsonb_build_object('vehicle_type', p_vehicle_type, 'plate', p_plate);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_reservation_requests(p_location_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_operator uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT operator_id INTO v_operator FROM locations WHERE id = p_location_id AND deleted_at IS NULL;
  IF v_operator IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  INSERT INTO location_policies (location_id, reservations_enabled)
  VALUES (p_location_id, COALESCE(p_enabled, false))
  ON CONFLICT (location_id) DO UPDATE
    SET reservations_enabled = EXCLUDED.reservations_enabled;
  RETURN jsonb_build_object('success', true, 'reservations_enabled', COALESCE(p_enabled, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_quote(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_started_at timestamptz,
  p_end_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_check jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  -- Plate is only needed by the input check; the price does not depend on it.
  v_check := reservation_check(p_location_id, p_vehicle_type, 'QUOTE', p_started_at, p_end_at, false);
  IF v_check ? 'error' THEN
    RETURN v_check;
  END IF;
  RETURN jsonb_build_object('success', true, 'amount', v_check->'amount');
END;
$$;

CREATE OR REPLACE FUNCTION public.request_reservation(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_started_at timestamptz,
  p_end_at timestamptz,
  p_vehicle_id uuid DEFAULT NULL,
  p_save_nickname text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_choice jsonb;
  v_check jsonb;
  v_type vehicle_type;
  v_session uuid;
  v_operator uuid;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  v_choice := reservation_vehicle(p_vehicle_id, p_vehicle_type, p_plate, p_save_nickname);
  IF v_choice ? 'error' THEN
    RETURN v_choice;
  END IF;
  v_type := (v_choice->>'vehicle_type')::vehicle_type;
  v_check := reservation_check(
    p_location_id, v_type, v_choice->>'plate', p_started_at, p_end_at, true
  );
  IF v_check ? 'error' THEN
    RETURN v_check;
  END IF;

  SELECT operator_id, name INTO v_operator, v_name FROM locations WHERE id = p_location_id;

  INSERT INTO parking_sessions (
    location_id, area_id, driver_id, plate, vehicle_type,
    started_at, scheduled_end_at, billed_end_at,
    status, approval_status, rate_auto, rate_snapshot
  ) VALUES (
    p_location_id, (v_check->>'area_id')::uuid, v_uid, v_check->>'plate', v_type,
    p_started_at, p_end_at, p_end_at,
    'active', 'pending', true, v_check->'price'
  ) RETURNING id INTO v_session;

  INSERT INTO folios (operator_id, location_id, session_id, status)
  VALUES (v_operator, p_location_id, v_session, 'open');

  INSERT INTO availability_events (location_id, area_id, change, actor)
  VALUES (p_location_id, (v_check->>'area_id')::uuid, 'reservation_requested', v_uid);

  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (v_session, NULL, 'pending', 'request_reservation', v_uid);

  PERFORM notify_session_staff(
    v_session,
    'reservation_request',
    'New reservation request',
    v_check->>'plate' || ' requested a reservation at ' || COALESCE(v_name, 'your listing')
  );
  PERFORM post_system_chat_event(
    p_location_id, v_uid, 'Reservation made', 'reservation_made', v_session
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session,
    'amount', v_check->'amount'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_reservation_request(
  p_session_id uuid,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_started_at timestamptz,
  p_end_at timestamptz,
  p_vehicle_id uuid DEFAULT NULL,
  p_save_nickname text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_choice jsonb;
  v_check jsonb;
  v_type vehicle_type;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_s.driver_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.approval_status IS DISTINCT FROM 'pending'
     OR v_s.cancelled_at IS NOT NULL
     OR v_s.status NOT IN ('active', 'overdue')
     OR v_s.started_at <= now() THEN
    RETURN jsonb_build_object('error', 'not_pending');
  END IF;
  v_choice := reservation_vehicle(p_vehicle_id, p_vehicle_type, p_plate, p_save_nickname);
  IF v_choice ? 'error' THEN
    RETURN v_choice;
  END IF;
  v_type := (v_choice->>'vehicle_type')::vehicle_type;
  -- Editing stays allowed after the listing turns requests off.
  v_check := reservation_check(
    v_s.location_id, v_type, v_choice->>'plate', p_started_at, p_end_at, false
  );
  IF v_check ? 'error' THEN
    RETURN v_check;
  END IF;

  UPDATE parking_sessions
     SET vehicle_type = v_type,
         plate = v_check->>'plate',
         started_at = p_started_at,
         scheduled_end_at = p_end_at,
         billed_end_at = p_end_at,
         area_id = (v_check->>'area_id')::uuid,
         rate_id = NULL,
         rate_auto = true,
         rate_snapshot = v_check->'price',
         updated_at = now()
   WHERE id = p_session_id;

  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'edit_reservation', v_uid, jsonb_build_object(
    'plate', v_check->>'plate', 'vehicle_type', v_type,
    'started_at', p_started_at, 'end_at', p_end_at
  ));

  RETURN jsonb_build_object('success', true, 'session_id', p_session_id, 'amount', v_check->'amount');
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_reservation(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_conflict jsonb;
  v_name text;
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
  IF v_s.approval_status IS DISTINCT FROM 'pending'
     OR v_s.cancelled_at IS NOT NULL
     OR v_s.started_at <= now() THEN
    RETURN jsonb_build_object('error', 'not_pending');
  END IF;
  v_conflict := reservation_same_plate_conflict(
    v_s.location_id, v_s.plate, v_s.started_at, v_s.scheduled_end_at, v_s.id
  );
  IF v_conflict IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'same_plate_overlap', 'plate', v_conflict->>'plate');
  END IF;

  UPDATE parking_sessions
     SET approval_status = 'approved', updated_at = now()
   WHERE id = p_session_id;
  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, 'pending', 'approved', 'approve_reservation', v_uid);

  IF v_s.driver_id IS NOT NULL THEN
    SELECT name INTO v_name FROM locations WHERE id = v_s.location_id;
    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
    VALUES (
      v_s.driver_id, 'reservation_decision', 'Reservation approved',
      'Your reservation at ' || COALESCE(v_name, 'the listing') || ' was approved',
      'session', p_session_id,
      jsonb_build_object('location_id', v_s.location_id, 'audience', 'driver')
    );
  END IF;
  RETURN jsonb_build_object('success', true, 'session_id', p_session_id);
END;
$$;

-- Closes a reservation that has not started: no parking fee, payments stay recorded.
CREATE OR REPLACE FUNCTION public.close_reservation(
  p_session_id uuid,
  p_uid uuid,
  p_reason text,
  p_action text,
  p_approval text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM parking_sessions WHERE id = p_session_id;
  UPDATE folio_charges SET voided_at = now()
   WHERE folio_id IN (SELECT id FROM folios WHERE session_id = p_session_id)
     AND type = 'parking_fee' AND voided_at IS NULL;
  INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
  SELECT id, 'parking_fee',
         CASE WHEN p_action = 'reject_reservation'
              THEN 'Parking fee (reservation rejected)'
              ELSE 'Parking fee (reservation cancelled)' END,
         0, p_uid
    FROM folios WHERE session_id = p_session_id;
  UPDATE parking_sessions
     SET status = 'ended', ended_at = now(), ended_by = p_uid,
         cancelled_at = now(), cancelled_by = p_uid,
         approval_status = COALESCE(p_approval, approval_status),
         override_reason = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), override_reason)
   WHERE id = p_session_id;
  UPDATE folios SET status = 'settled' WHERE session_id = p_session_id;
  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, v_status, 'ended', p_action, p_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_reservation(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_name text;
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
  IF v_s.approval_status IS DISTINCT FROM 'pending'
     OR v_s.cancelled_at IS NOT NULL
     OR v_s.started_at <= now() THEN
    RETURN jsonb_build_object('error', 'not_pending');
  END IF;
  PERFORM close_reservation(p_session_id, v_uid, NULL, 'reject_reservation', 'rejected');
  IF v_s.driver_id IS NOT NULL THEN
    SELECT name INTO v_name FROM locations WHERE id = v_s.location_id;
    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
    VALUES (
      v_s.driver_id, 'reservation_decision', 'Reservation rejected',
      'Your reservation at ' || COALESCE(v_name, 'the listing') || ' was rejected',
      'session', p_session_id,
      jsonb_build_object('location_id', v_s.location_id, 'audience', 'driver')
    );
  END IF;
  RETURN jsonb_build_object('success', true, 'session_id', p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_reservation_area(p_session_id uuid, p_area_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = v_s.location_id;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;
  IF NOT area_allows_vehicle(v_area.vehicle_types, v_s.vehicle_type) THEN
    RETURN jsonb_build_object('error', 'vehicle_not_allowed', 'area', v_area.name);
  END IF;
  UPDATE parking_sessions SET area_id = v_area.id, updated_at = now() WHERE id = p_session_id;
  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'set_reservation_area', v_uid, jsonb_build_object('area_id', v_area.id));
  RETURN jsonb_build_object('success', true, 'area_id', v_area.id, 'area_name', v_area.name);
END;
$$;

-- The driver who made the reservation can cancel it too. Staff cancelling tells
-- the driver; the driver cancelling tells the listing's staff. An area change
-- does not notify anyone.
CREATE OR REPLACE FUNCTION public.cancel_reservation_session(p_session_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_staff boolean;
  v_name text;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;
  v_staff := can_work_location(v_s.location_id, v_uid);
  IF NOT v_staff AND v_s.driver_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.status NOT IN ('active', 'overdue') OR v_s.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  IF v_s.started_at <= now() THEN
    RETURN jsonb_build_object('error', 'already_started');
  END IF;
  -- A rejected request is already closed. Cancelling a waiting or approved one
  -- leaves approval_status as it is, so it stays Cancelled rather than Rejected.
  IF v_s.approval_status = 'rejected' THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;

  PERFORM close_reservation(p_session_id, v_uid, p_reason, 'cancel_reservation', NULL);

  SELECT name INTO v_name FROM locations WHERE id = v_s.location_id;
  IF v_staff AND v_s.driver_id IS NOT NULL AND v_s.driver_id IS DISTINCT FROM v_uid THEN
    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
    VALUES (
      v_s.driver_id, 'reservation_decision', 'Reservation cancelled',
      'Your reservation at ' || COALESCE(v_name, 'the listing') || ' was cancelled',
      'session', p_session_id,
      jsonb_build_object('location_id', v_s.location_id, 'audience', 'driver')
    );
  ELSIF NOT v_staff THEN
    PERFORM notify_session_staff(
      p_session_id,
      'reservation_decision',
      'Reservation cancelled',
      COALESCE(v_s.plate, 'A driver') || ' cancelled a reservation at ' || COALESCE(v_name, 'your listing')
    );
  END IF;
  RETURN jsonb_build_object('success', true, 'session_id', p_session_id);
END;
$$;

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
      'approval_status', v_s.approval_status,
      'same_plate_overlap', CASE
        WHEN v_s.approval_status = 'pending' AND v_s.cancelled_at IS NULL AND v_s.started_at > now()
        THEN reservation_same_plate_conflict(
          v_s.location_id, v_s.plate, v_s.started_at, v_s.scheduled_end_at, v_s.id)
        ELSE NULL END,
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

REVOKE ALL ON FUNCTION public.reservation_area_id(uuid, vehicle_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_same_plate_conflict(uuid, text, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_check(uuid, vehicle_type, text, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservation_vehicle(uuid, vehicle_type, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_reservation(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_reservation_requests(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reservation_requests(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reservation_quote(uuid, vehicle_type, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservation_quote(uuid, vehicle_type, timestamptz, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_reservation(uuid, vehicle_type, text, timestamptz, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_reservation(uuid, vehicle_type, text, timestamptz, timestamptz, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_reservation_request(uuid, vehicle_type, text, timestamptz, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_reservation_request(uuid, vehicle_type, text, timestamptz, timestamptz, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_reservation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_reservation(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_reservation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_reservation(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_reservation_area(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reservation_area(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
