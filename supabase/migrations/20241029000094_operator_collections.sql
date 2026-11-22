-- Collections report for an owner or a manager (their listings only).
-- Payments and refunds use received_at. Extra fees and waivers use the charge time.
-- Still to collect is the unpaid balance of sessions that are still open, as of now,
-- priced with session_balance_parts (the same calculator as a session).

CREATE OR REPLACE FUNCTION public.operator_collections_report(
  p_operator_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_collected NUMERIC;
  v_refunded NUMERIC;
  v_extra NUMERIC;
  v_waived NUMERIC;
  v_methods JSONB;
  v_lines JSONB;
  v_more BOOLEAN;
  v_open NUMERIC := 0;
  v_session UUID;
  v_balance NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT is_operator_admin(v_uid, p_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RETURN jsonb_build_object('error', 'range_required');
  END IF;
  IF p_from >= p_to THEN
    RETURN jsonb_build_object('error', 'range_invalid');
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM locations
    WHERE id = p_location_id
      AND operator_id = p_operator_id
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT COALESCE(SUM(CASE WHEN p.direction = 'refund' THEN -p.amount ELSE p.amount END), 0),
         COALESCE(SUM(CASE WHEN p.direction = 'refund' THEN p.amount ELSE 0 END), 0)
    INTO v_collected, v_refunded
  FROM payments p
  JOIN folios f ON f.id = p.folio_id
  JOIN locations l ON l.id = f.location_id
  WHERE f.operator_id = p_operator_id
    AND l.deleted_at IS NULL
    AND (p_location_id IS NULL OR l.id = p_location_id)
    AND p.received_at >= p_from
    AND p.received_at < p_to;

  SELECT COALESCE(jsonb_object_agg(m.method, COALESCE(paid.amount, 0)), '{}'::jsonb)
    INTO v_methods
  FROM (SELECT unnest(enum_range(NULL::payment_method))::text AS method) m
  LEFT JOIN (
    SELECT p.method::text AS method, SUM(p.amount) AS amount
    FROM payments p
    JOIN folios f ON f.id = p.folio_id
    JOIN locations l ON l.id = f.location_id
    WHERE f.operator_id = p_operator_id
      AND l.deleted_at IS NULL
      AND (p_location_id IS NULL OR l.id = p_location_id)
      AND p.direction = 'payment'
      AND p.received_at >= p_from
      AND p.received_at < p_to
    GROUP BY p.method
  ) paid ON paid.method = m.method;

  SELECT COALESCE(SUM(c.amount), 0)
    INTO v_extra
  FROM folio_charges c
  JOIN folios f ON f.id = c.folio_id
  JOIN locations l ON l.id = f.location_id
  WHERE f.operator_id = p_operator_id
    AND l.deleted_at IS NULL
    AND (p_location_id IS NULL OR l.id = p_location_id)
    AND c.voided_at IS NULL
    AND c.type = 'additional_fee'
    AND c.created_at >= p_from
    AND c.created_at < p_to;

  -- Waiver rows are stored as a negative amount.
  SELECT COALESCE(-SUM(c.amount), 0)
    INTO v_waived
  FROM folio_charges c
  JOIN folios f ON f.id = c.folio_id
  JOIN locations l ON l.id = f.location_id
  WHERE f.operator_id = p_operator_id
    AND l.deleted_at IS NULL
    AND (p_location_id IS NULL OR l.id = p_location_id)
    AND c.voided_at IS NULL
    AND c.type = 'waiver'
    AND c.created_at >= p_from
    AND c.created_at < p_to;

  SELECT EXISTS (
    SELECT 1
    FROM payments p
    JOIN folios f ON f.id = p.folio_id
    JOIN locations l ON l.id = f.location_id
    WHERE f.operator_id = p_operator_id
      AND l.deleted_at IS NULL
      AND (p_location_id IS NULL OR l.id = p_location_id)
      AND p.received_at >= p_from
      AND p.received_at < p_to
    OFFSET 200
  ) INTO v_more;

  SELECT COALESCE(jsonb_agg(line ORDER BY line->>'at' DESC, line->>'id' DESC), '[]'::jsonb)
    INTO v_lines
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'at', p.received_at,
      'listing', l.name,
      'plate', COALESCE(s.plate, ''),
      'direction', p.direction,
      'method', p.method,
      'amount', p.amount,
      'recorded_by', COALESCE(NULLIF(btrim(pr.display_name), ''), '')
    ) AS line
    FROM payments p
    JOIN folios f ON f.id = p.folio_id
    JOIN locations l ON l.id = f.location_id
    LEFT JOIN parking_sessions s ON s.id = f.session_id
    LEFT JOIN profiles pr ON pr.id = p.recorded_by
    WHERE f.operator_id = p_operator_id
      AND l.deleted_at IS NULL
      AND (p_location_id IS NULL OR l.id = p_location_id)
      AND p.received_at >= p_from
      AND p.received_at < p_to
    ORDER BY p.received_at DESC, p.id DESC
    LIMIT 200
  ) lines;

  FOR v_session IN
    SELECT s.id
    FROM parking_sessions s
    JOIN locations l ON l.id = s.location_id
    WHERE l.operator_id = p_operator_id
      AND l.deleted_at IS NULL
      AND (p_location_id IS NULL OR l.id = p_location_id)
      AND s.status IN ('active', 'overdue')
  LOOP
    v_balance := (session_balance_parts(v_session)->>'balance')::NUMERIC;
    IF v_balance > 0 THEN
      v_open := v_open + v_balance;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'collected', v_collected,
    'by_method', v_methods,
    'extra_fees', v_extra,
    'waived', v_waived,
    'refunded', v_refunded,
    'open_balance', v_open,
    'lines', v_lines,
    'lines_truncated', v_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.operator_collections_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_collections_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
