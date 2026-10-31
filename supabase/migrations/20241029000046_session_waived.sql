-- Waived amounts on sessions (rj: "Waivers stay. The sessions list must indicate
-- when an amount is waived for a session.")
--
-- session_balance_parts (0045) now also returns 'waived' (the waived amount, as a
-- positive number) and, once a session has ended, uses the final 'Parking fee'
-- charge instead of re-pricing (open sessions are still priced live). Balance = parking + extra fees − payments − waived,
-- so an ended, waived session shows ₱0.00 instead of the waived amount again.
-- session_details passes 'waived' and 'ended_at' through.

CREATE OR REPLACE FUNCTION public.session_balance_parts(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_folio uuid;
  v_parking numeric;
  v_extra numeric;
  v_paid numeric;
  v_waived numeric;
BEGIN
  SELECT id INTO v_folio FROM folios WHERE session_id = p_session_id LIMIT 1;
  -- Ended sessions: the final Parking fee charge. Open ones: priced live (an open
  -- session can carry a stale parking_fee row left by a refused close before 0045).
  IF EXISTS (SELECT 1 FROM parking_sessions WHERE id = p_session_id AND status = 'ended') THEN
    SELECT SUM(amount) INTO v_parking FROM folio_charges
     WHERE folio_id = v_folio AND voided_at IS NULL AND type = 'parking_fee';
  END IF;
  v_parking := COALESCE(v_parking, session_parking_quote(p_session_id));
  SELECT COALESCE(SUM(amount), 0) INTO v_extra FROM folio_charges
   WHERE folio_id = v_folio AND voided_at IS NULL AND type IN ('additional_fee', 'adjustment');
  SELECT COALESCE(-SUM(amount), 0) INTO v_waived FROM folio_charges
   WHERE folio_id = v_folio AND voided_at IS NULL AND type = 'waiver';
  SELECT COALESCE(SUM(CASE direction WHEN 'refund' THEN -amount ELSE amount END), 0) INTO v_paid
    FROM payments WHERE folio_id = v_folio;
  RETURN jsonb_build_object('folio_id', v_folio, 'parking', v_parking, 'extra_fees', v_extra,
    'paid', v_paid, 'waived', v_waived, 'balance', v_parking + v_extra - v_paid - v_waived);
END;
$function$;
REVOKE ALL ON FUNCTION public.session_balance_parts(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.session_details(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
      'ended_at', v_s.ended_at),
    'price', session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
      COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()), v_s.rate_id)
      || jsonb_build_object('until_now', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at) IS NULL),
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

NOTIFY pgrst, 'reload schema';
