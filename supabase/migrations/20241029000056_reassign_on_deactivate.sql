-- 0056 (rj): when a rate is deactivated, every open open-ended session on it (no
-- billed/planned end, so 0055 didn't block it) switches, in the same transaction,
-- to what Automatic resolves to now (next applicable rate by priority), falling back
-- to the location's default. The new rate is stored on the session and the old one in
-- parking_sessions.rate_changed_from so the Session page can say
-- "Rate changed from X (deactivated)".
-- Billing decision (flagged to rj): the WHOLE session reprices at the new rate (a
-- session has one rate, no split at the deactivation time). Any payment already taken
-- stays; the balance just follows the new charge.
-- rate_changed_from clears whenever the session's rate is changed some other way.

ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS rate_changed_from uuid REFERENCES rates(id);

CREATE OR REPLACE FUNCTION public.rates_reassign_open_ended()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(OLD.active, false) AND NOT COALESCE(NEW.active, false) THEN
    UPDATE parking_sessions s
       SET rate_changed_from = NEW.id,
           rate_id = COALESCE(
             walk_in_auto_rate(s.location_id, COALESCE(s.vehicle_type, 'car'), s.started_at),
             (SELECT d.id FROM rates d WHERE d.location_id = s.location_id AND d.is_default
                AND d.active AND d.id <> NEW.id LIMIT 1))
     WHERE s.rate_id = NEW.id
       AND s.status IN ('active', 'overdue')
       AND COALESCE(s.billed_end_at, s.scheduled_end_at) IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.rates_reassign_open_ended() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rates_reassign_open_ended ON rates;
CREATE TRIGGER rates_reassign_open_ended
  AFTER UPDATE OF active ON rates
  FOR EACH ROW EXECUTE FUNCTION public.rates_reassign_open_ended();

CREATE OR REPLACE FUNCTION public.parking_sessions_set_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rate_id IS DISTINCT FROM OLD.rate_id
     AND NEW.rate_changed_from IS NOT DISTINCT FROM OLD.rate_changed_from THEN
    NEW.rate_changed_from := NULL;
  END IF;
  IF NEW.rate_id IS NULL AND NEW.status IN ('active', 'overdue') AND NEW.started_at IS NOT NULL THEN
    NEW.rate_id := walk_in_auto_rate(NEW.location_id, COALESCE(NEW.vehicle_type, 'car'), NEW.started_at);
  END IF;
  RETURN NEW;
END;
$$;

-- Existing open-ended sessions already sitting on an inactive rate (from 0055) move now.
UPDATE parking_sessions s
   SET rate_changed_from = s.rate_id,
       rate_id = COALESCE(
         walk_in_auto_rate(s.location_id, COALESCE(s.vehicle_type, 'car'), s.started_at),
         (SELECT d.id FROM rates d WHERE d.location_id = s.location_id AND d.is_default AND d.active LIMIT 1))
  FROM rates r
 WHERE r.id = s.rate_id AND NOT r.active
   AND s.status IN ('active', 'overdue')
   AND COALESCE(s.billed_end_at, s.scheduled_end_at) IS NULL;

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
      'rate_active', (SELECT r.active FROM rates r WHERE r.id = v_s.rate_id),
      'rate_changed_from', CASE WHEN v_s.rate_changed_from IS NULL THEN NULL ELSE
        (SELECT jsonb_build_object('id', r.id, 'name', r.name) FROM rates r WHERE r.id = v_s.rate_changed_from) END,
      'ended_at', v_s.ended_at, 'cancelled_at', v_s.cancelled_at,
      'reservation', v_s.status IN ('active', 'overdue') AND v_s.started_at > now()),
    'price', session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
      COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()), v_s.rate_id)
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

NOTIFY pgrst, 'reload schema';
