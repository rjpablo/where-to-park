-- Staff can add an extra fee that is not one of the listing's saved fees.
-- It is an additional charge on the open folio, with no fee preset behind it.

CREATE OR REPLACE FUNCTION public.add_session_fee(
  p_session_id uuid,
  p_description text,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_folio_id uuid;
  v_charge_id uuid;
  v_name text := btrim(COALESCE(p_description, ''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'amount_required');
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
  IF v_s.started_at > now() AND v_s.approval_status = 'pending' THEN
    RETURN jsonb_build_object('error', 'not_approved');
  END IF;
  SELECT id INTO v_folio_id FROM folios WHERE session_id = p_session_id AND status = 'open';
  IF v_folio_id IS NULL THEN
    RETURN jsonb_build_object('error', 'folio_not_open');
  END IF;
  INSERT INTO folio_charges (folio_id, type, fee_preset_id, description, amount, added_by)
  VALUES (v_folio_id, 'additional_fee', NULL, v_name, p_amount, v_uid)
  RETURNING id INTO v_charge_id;
  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge_id,
    'description', v_name,
    'amount', p_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.add_session_fee(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_session_fee(uuid, text, numeric) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
