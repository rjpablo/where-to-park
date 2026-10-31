-- Live parking-so-far (quote_price for elapsed started hours) plus extra fees.
-- end_session posts the parking charge from that quote so the waiver includes it.

CREATE OR REPLACE FUNCTION session_parking_quote(p_session_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_session parking_sessions%ROWTYPE;
  v_hours NUMERIC;
  v_quote JSONB;
  v_amount NUMERIC;
BEGIN
  SELECT * INTO v_session FROM parking_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- Overdue time is not billed unless staff set billed_end_at (or the session ended).
  v_hours := EXTRACT(EPOCH FROM (
    COALESCE(
      v_session.ended_at,
      v_session.billed_end_at,
      CASE
        WHEN v_session.scheduled_end_at IS NOT NULL AND v_session.scheduled_end_at < NOW()
          THEN v_session.scheduled_end_at
        ELSE NOW()
      END
    ) - v_session.started_at
  )) / 3600.0;
  v_quote := quote_price(
    v_session.location_id,
    v_session.vehicle_type,
    v_session.started_at,
    GREATEST(v_hours, 0.0001)
  );
  v_amount := NULLIF(v_quote->>'amount', '')::NUMERIC;
  IF v_amount IS NULL THEN
    v_amount := COALESCE((v_session.rate_snapshot->>'amount')::NUMERIC, 0)
      * GREATEST(1, CEIL(v_hours));
  END IF;
  RETURN COALESCE(v_amount, 0);
END;
$$;

CREATE OR REPLACE FUNCTION session_balance_preview(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session parking_sessions%ROWTYPE;
  v_folio UUID;
  v_parking NUMERIC;
  v_extra NUMERIC;
  v_paid NUMERIC;
BEGIN
  SELECT * INTO v_session FROM parking_sessions WHERE id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  SELECT id INTO v_folio FROM folios WHERE session_id = p_session_id LIMIT 1;
  v_parking := session_parking_quote(p_session_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_extra
  FROM folio_charges
  WHERE folio_id = v_folio AND voided_at IS NULL
    AND type IN ('additional_fee', 'adjustment');
  SELECT COALESCE(SUM(CASE direction WHEN 'refund' THEN -amount ELSE amount END), 0)
    INTO v_paid
  FROM payments WHERE folio_id = v_folio;
  RETURN jsonb_build_object(
    'success', true,
    'parking_so_far', v_parking,
    'extra_fees', v_extra,
    'paid', v_paid,
    'live_balance', v_parking + v_extra - v_paid
  );
END;
$$;

CREATE OR REPLACE FUNCTION end_session(
  p_session_id UUID,
  p_cash_amount NUMERIC DEFAULT NULL,
  p_waive_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_folio RECORD;
  v_balance NUMERIC;
  v_charges_total NUMERIC;
  v_paid_total NUMERIC;
  v_operator RECORD;
  v_can_waive BOOLEAN;
  v_amount NUMERIC;
BEGIN
  SELECT * INTO v_session FROM parking_sessions WHERE id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;

  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id;
  IF v_folio IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_amount := session_parking_quote(p_session_id);

  IF NOT EXISTS (
    SELECT 1 FROM folio_charges
    WHERE folio_id = v_folio.id AND type = 'parking_fee' AND voided_at IS NULL
  ) THEN
    INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
    VALUES (v_folio.id, 'parking_fee', 'Parking fee', v_amount, auth.uid());
  END IF;

  IF p_cash_amount IS NOT NULL AND p_cash_amount > 0 THEN
    INSERT INTO payments (folio_id, amount, method, recorded_by)
    VALUES (v_folio.id, p_cash_amount, 'cash', auth.uid());
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_charges_total
  FROM folio_charges WHERE folio_id = v_folio.id AND voided_at IS NULL;

  SELECT COALESCE(SUM(
    CASE direction WHEN 'payment' THEN amount WHEN 'refund' THEN -amount END
  ), 0) INTO v_paid_total
  FROM payments WHERE folio_id = v_folio.id;

  v_balance := v_charges_total - v_paid_total;

  IF v_balance > 0.01 THEN
    IF p_waive_note IS NULL OR trim(p_waive_note) = '' THEN
      RETURN jsonb_build_object('error', 'waiver_note_required', 'balance', v_balance);
    END IF;

    SELECT o.*, om.role INTO v_operator
    FROM operators o
    JOIN operator_members om ON om.operator_id = o.id
    WHERE o.id = v_folio.operator_id
      AND om.profile_id = auth.uid()
    LIMIT 1;

    v_can_waive := (
      v_operator.role IN ('owner', 'manager') OR
      (v_operator.role = 'staff' AND v_operator.staff_can_waive = true)
    );

    IF NOT v_can_waive THEN
      RETURN jsonb_build_object('error', 'waiver_not_allowed');
    END IF;

    INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
    VALUES (v_folio.id, 'waiver', 'Waived balance', -v_balance, p_waive_note, auth.uid());
  END IF;

  UPDATE parking_sessions
  SET status = 'ended', ended_at = NOW(), ended_by = auth.uid()
  WHERE id = p_session_id;

  UPDATE folios SET status = 'settled' WHERE id = v_folio.id;

  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, v_session.status, 'ended', 'end_session', auth.uid());

  RETURN jsonb_build_object('success', true, 'session_id', p_session_id, 'final_balance', 0);
END;
$$;

GRANT EXECUTE ON FUNCTION session_parking_quote(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION session_balance_preview(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
