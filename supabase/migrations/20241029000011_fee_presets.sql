-- Reusable extra-fee presets: operator CRUD, members may apply to a session ledger.

CREATE POLICY "Operators can manage fee presets"
  ON fee_presets FOR ALL
  USING (is_operator_admin(auth.uid(), operator_id));

CREATE OR REPLACE FUNCTION upsert_fee_preset(
  p_operator_id UUID,
  p_name TEXT,
  p_amount NUMERIC,
  p_preset_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT is_operator_admin(v_uid, p_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'amount_required');
  END IF;

  IF p_preset_id IS NULL THEN
    INSERT INTO fee_presets (operator_id, location_id, name, amount, active, created_by)
    VALUES (p_operator_id, p_location_id, btrim(p_name), p_amount, COALESCE(p_active, true), v_uid)
    RETURNING id INTO v_id;
  ELSE
    UPDATE fee_presets
    SET name = btrim(p_name),
        amount = p_amount,
        location_id = p_location_id,
        active = COALESCE(p_active, active)
    WHERE id = p_preset_id AND operator_id = p_operator_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'preset_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION delete_fee_preset(p_preset_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
BEGIN
  SELECT operator_id INTO v_operator_id FROM fee_presets WHERE id = p_preset_id;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  DELETE FROM fee_presets WHERE id = p_preset_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION apply_fee_preset(
  p_session_id UUID,
  p_preset_id UUID,
  p_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_preset RECORD;
  v_folio RECORD;
  v_amount NUMERIC;
  v_charge_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_preset FROM fee_presets WHERE id = p_preset_id AND active = true;
  IF v_preset IS NULL THEN
    RETURN jsonb_build_object('error', 'preset_not_found');
  END IF;
  IF NOT is_operator_member(v_uid, v_preset.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id AND status = 'open';
  IF v_folio IS NULL THEN
    RETURN jsonb_build_object('error', 'folio_not_open');
  END IF;
  IF v_folio.operator_id <> v_preset.operator_id THEN
    RETURN jsonb_build_object('error', 'preset_wrong_operator');
  END IF;

  v_amount := COALESCE(p_amount, v_preset.amount);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'amount_required');
  END IF;

  INSERT INTO folio_charges (folio_id, type, fee_preset_id, description, amount, added_by)
  VALUES (v_folio.id, 'additional_fee', v_preset.id, v_preset.name, v_amount, v_uid)
  RETURNING id INTO v_charge_id;

  RETURN jsonb_build_object(
    'success', true,
    'charge_id', v_charge_id,
    'amount', v_amount,
    'description', v_preset.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_fee_preset(UUID, TEXT, NUMERIC, UUID, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_fee_preset(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION apply_fee_preset(UUID, UUID, NUMERIC) TO authenticated, service_role;
