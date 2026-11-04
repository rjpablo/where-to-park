-- 0058: saving a session with a picked rate that equals its stored Automatic rate (e.g.
-- Automatic (Standard Rate) -> Standard Rate) left rate_auto = true, so it kept pricing
-- by priority. update_walk_in_session now sets rate_auto from the choice explicitly
-- (NULL = Automatic, resolved by the trigger).

CREATE OR REPLACE FUNCTION public.update_walk_in_session(
  p_session_id uuid,
  p_started_at timestamptz,
  p_end_at timestamptz,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_rate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_err text;
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

NOTIFY pgrst, 'reload schema';
