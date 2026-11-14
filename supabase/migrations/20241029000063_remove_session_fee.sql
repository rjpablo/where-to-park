-- Remove an applied extra fee from an open session (rj t132u).
-- The charge is voided (kept for the record, with who removed it), so every balance
-- calculation (which already skips voided charges) drops it. Only operators and the
-- listing's staff (can_work_location) and only while the session is open (active or
-- overdue, reservations included). If payments now exceed what is due the balance goes
-- negative (a credit); this is not blocked.
ALTER TABLE folio_charges ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES profiles(id);

CREATE OR REPLACE FUNCTION public.remove_session_fee(p_session_id uuid, p_charge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_c folio_charges%ROWTYPE;
  v_b jsonb;
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
  IF v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_closed');
  END IF;
  SELECT c.* INTO v_c FROM folio_charges c JOIN folios f ON f.id = c.folio_id
   WHERE c.id = p_charge_id AND f.session_id = p_session_id
     AND c.type = 'additional_fee' AND c.voided_at IS NULL
   FOR UPDATE OF c;
  IF v_c.id IS NULL THEN
    RETURN jsonb_build_object('error', 'fee_not_found');
  END IF;
  UPDATE folio_charges SET voided_at = now(), voided_by = v_uid WHERE id = v_c.id;
  v_b := session_balance_parts(p_session_id);
  RETURN jsonb_build_object(
    'success', true, 'charge_id', v_c.id, 'description', v_c.description,
    'amount', v_c.amount, 'balance', v_b->'balance');
END;
$$;
REVOKE ALL ON FUNCTION public.remove_session_fee(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_session_fee(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
