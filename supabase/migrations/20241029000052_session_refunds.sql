-- 0052: refunds (rj, pt100u). Staff/operators who can work the listing (same as
-- payments) record a refund on an ended session that has money to give back:
-- * a cancelled reservation: up to the net paid (payments − refunds);
-- * any other ended session with a credit (paid more than parking + fees −
--   waived, e.g. the End was moved earlier after payment): up to the credit.
-- Refunds are payments rows with direction 'refund' (amount, method, note,
-- recorded_by, received_at); paid/balance already net them out.

CREATE OR REPLACE FUNCTION public.session_refundable(p_session_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_s parking_sessions%ROWTYPE;
  v_b jsonb;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF v_s.id IS NULL OR v_s.status <> 'ended' THEN
    RETURN 0;
  END IF;
  v_b := session_balance_parts(p_session_id);
  IF v_s.cancelled_at IS NOT NULL THEN
    RETURN GREATEST(0, round((v_b->>'paid')::numeric, 2));
  END IF;
  RETURN GREATEST(0, round(-(v_b->>'balance')::numeric, 2));
END;
$function$;
REVOKE ALL ON FUNCTION public.session_refundable(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_session_refund(p_session_id uuid, p_amount numeric,
  p_method payment_method DEFAULT 'cash'::payment_method, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_folio record;
  v_max numeric;
  v_id uuid;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id FOR UPDATE;
  IF v_folio.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_s.status <> 'ended' THEN
    RETURN jsonb_build_object('error', 'refund_needs_ended');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'amount_required');
  END IF;
  v_max := session_refundable(p_session_id);
  IF round(p_amount, 2) > v_max + 0.005 THEN
    RETURN jsonb_build_object('error', 'refund_exceeds_refundable', 'refundable', v_max);
  END IF;
  INSERT INTO payments (folio_id, direction, amount, method, source, recorded_by, received_at, note)
  VALUES (v_folio.id, 'refund', round(p_amount, 2), COALESCE(p_method, 'cash'), 'staff', v_uid, now(),
          NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'payment_id', v_id,
    'refundable', session_refundable(p_session_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.record_session_refund(uuid, numeric, payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_session_refund(uuid, numeric, payment_method, text) TO authenticated;

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
