-- 0049: a session with a future start is a reservation (rj, pt97u/pt98u).
-- * walk_in_input_error: no more 5-minute future-start limit.
-- * walk_in_quote / session_details: 'reservation' flag; until_now is false for a
--   reservation (its amount is the planned stay: start -> planned end, or the
--   minimum billing unit when there's no end).
-- * end_session refuses a reservation ('not_started'); cancel it instead with
--   cancel_reservation_session (status ended, cancelled_at/by, no parking fee,
--   booking event 'cancel_reservation'). Payments (deposits) stay recorded.
-- * set_manual_counts counts only started sessions as occupying a space.
--   claim_capacity already checks overlap in time, so a reservation holds its
--   window (start -> planned end, or open-ended) without blocking earlier stays.

ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES profiles(id);

CREATE OR REPLACE FUNCTION public.walk_in_input_error(p_location_id uuid, p_vehicle_type vehicle_type, p_plate text, p_started_at timestamp with time zone, p_end_at timestamp with time zone, p_rate_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_plate IS NULL OR btrim(p_plate) = '' THEN RETURN 'plate_required'; END IF;
  IF p_vehicle_type IS NULL THEN RETURN 'vehicle_required'; END IF;
  IF p_started_at IS NULL THEN RETURN 'start_required'; END IF;
  -- 0049: a future start is a reservation (no 5-minute limit any more).
  IF p_end_at IS NOT NULL AND p_end_at <= p_started_at THEN RETURN 'end_before_start'; END IF;
  IF NOT EXISTS (SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_started_at)) THEN
    RETURN 'no_applicable_rate';
  END IF;
  IF p_rate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_started_at) r WHERE r.id = p_rate_id
  ) THEN
    RETURN 'rate_not_applicable';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.walk_in_quote(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rate_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_err text;
BEGIN
  IF NOT can_work_location(p_location_id, auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, 'x', p_start_at, p_end_at, p_rate_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  RETURN session_price(p_location_id, p_vehicle_type, p_start_at, p_end_at, p_rate_id)
    || jsonb_build_object('until_now', p_end_at IS NULL AND p_start_at <= now(),
      'reservation', p_start_at > now());
END;
$function$;

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
      'ended_at', v_s.ended_at, 'cancelled_at', v_s.cancelled_at,
      'reservation', v_s.status IN ('active', 'overdue') AND v_s.started_at > now()),
    'price', session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
      COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()), v_s.rate_id)
      || jsonb_build_object('until_now', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at) IS NULL
        AND v_s.started_at <= now()),
    'parking', v_b->'parking', 'extra_fees', v_b->'extra_fees', 'paid', v_b->'paid',
    'balance', v_b->'balance', 'waived', v_b->'waived',
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

CREATE OR REPLACE FUNCTION public.end_session(p_session_id uuid, p_cash_amount numeric DEFAULT NULL::numeric, p_waive_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session parking_sessions%ROWTYPE;
  v_folio record;
  v_b jsonb;
  v_cash numeric := CASE WHEN p_cash_amount > 0 THEN p_cash_amount ELSE 0 END;
  v_balance numeric;
  v_role text;
  v_staff_can_waive boolean;
  v_notify jsonb;
BEGIN
  SELECT * INTO v_session FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;
  IF NOT can_work_location(v_session.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_session.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  -- 0049: a reservation (start still in the future) is cancelled, not ended.
  IF v_session.started_at > now() THEN
    RETURN jsonb_build_object('error', 'not_started');
  END IF;
  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id FOR UPDATE;
  IF v_folio.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_b := session_balance_parts(p_session_id);
  v_balance := (v_b->>'balance')::numeric - v_cash;

  IF v_balance > 0.01 THEN
    IF p_waive_note IS NULL OR btrim(p_waive_note) = '' THEN
      RETURN jsonb_build_object('error', 'balance_due', 'balance', v_balance);
    END IF;
    SELECT om.role::text, o.staff_can_waive INTO v_role, v_staff_can_waive
      FROM operator_members om JOIN operators o ON o.id = om.operator_id
     WHERE om.operator_id = v_folio.operator_id AND om.profile_id = v_uid LIMIT 1;
    IF NOT (v_role IN ('owner', 'manager') OR (v_role = 'staff' AND v_staff_can_waive)) THEN
      RETURN jsonb_build_object('error', 'waiver_not_allowed', 'balance', v_balance);
    END IF;
  END IF;

  -- Only now write: the parking fee at its final amount, any cash, any waiver.
  UPDATE folio_charges SET voided_at = now()
   WHERE folio_id = v_folio.id AND type = 'parking_fee' AND voided_at IS NULL;
  INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
  VALUES (v_folio.id, 'parking_fee', 'Parking fee', (v_b->>'parking')::numeric, v_uid);
  IF v_cash > 0 THEN
    INSERT INTO payments (folio_id, amount, method, source, recorded_by)
    VALUES (v_folio.id, v_cash, 'cash', 'staff', v_uid);
  END IF;
  IF v_balance > 0.01 THEN
    INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
    VALUES (v_folio.id, 'waiver', 'Waived balance', -v_balance, btrim(p_waive_note), v_uid);
  END IF;

  UPDATE parking_sessions
     SET status = 'ended', ended_at = now(), ended_by = v_uid,
         billed_end_at = COALESCE(billed_end_at, scheduled_end_at, now())
   WHERE id = p_session_id;
  UPDATE folios SET status = 'settled' WHERE id = v_folio.id;

  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, v_session.status, 'ended', 'end_session', v_uid);

  v_notify := notify_session_staff(p_session_id, 'session_ended', 'Session ended',
    COALESCE(v_session.plate, 'Session') || ' was closed');

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'amount', (v_b->>'parking')::numeric + (v_b->>'extra_fees')::numeric,
    'final_balance', LEAST(v_balance, 0),
    'push_tokens', COALESCE(v_notify->'push_tokens', '[]'::jsonb)
  );
END;
$function$;

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
    AND started_at <= now(); -- 0049: reservations don't occupy a space yet

  v_available := v_location.capacity - v_occupied - v_reserved - v_unavailable;
  IF v_available < 0 THEN
    RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available);
  END IF;

  UPDATE locations
  SET manual_reserved_count = v_reserved,
      unavailable_count = v_unavailable,
      available_count = v_available,
      availability_updated_at = NOW()
  WHERE id = p_location_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (
    p_location_id,
    'manual_reserved=' || v_reserved || ',unavailable=' || v_unavailable,
    v_uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'available_count', v_available,
    'manual_reserved_count', v_reserved,
    'unavailable_count', v_unavailable
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_reservation_session(p_session_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  IF v_s.started_at <= now() THEN
    RETURN jsonb_build_object('error', 'already_started');
  END IF;

  UPDATE folio_charges SET voided_at = now()
   WHERE folio_id IN (SELECT id FROM folios WHERE session_id = p_session_id)
     AND type = 'parking_fee' AND voided_at IS NULL;
  -- A ₱0 parking fee: ended sessions read their final fee from this charge.
  INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
  SELECT id, 'parking_fee', 'Parking fee (reservation cancelled)', 0, v_uid
    FROM folios WHERE session_id = p_session_id;
  UPDATE parking_sessions
     SET status = 'ended', ended_at = now(), ended_by = v_uid,
         cancelled_at = now(), cancelled_by = v_uid,
         override_reason = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), override_reason)
   WHERE id = p_session_id;
  UPDATE folios SET status = 'settled' WHERE session_id = p_session_id;
  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, v_s.status, 'ended', 'cancel_reservation', v_uid);
  RETURN jsonb_build_object('success', true, 'session_id', p_session_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_reservation_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_session(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
