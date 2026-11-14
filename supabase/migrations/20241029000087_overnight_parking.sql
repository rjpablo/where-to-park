-- A listing can charge one overnight fee instead of the hourly rate for the hours
-- that fall inside its overnight window. price_stay remains the only calculator.

ALTER TABLE public.location_policies
  ADD COLUMN IF NOT EXISTS overnight_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overnight_start time,
  ADD COLUMN IF NOT EXISTS overnight_end time,
  ADD COLUMN IF NOT EXISTS overnight_amount numeric(12, 2);

CREATE OR REPLACE FUNCTION public.set_overnight(
  p_location_id uuid,
  p_enabled boolean,
  p_start time,
  p_end time,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_operator uuid;
  v_enabled boolean := COALESCE(p_enabled, false);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT operator_id INTO v_operator FROM locations WHERE id = p_location_id AND deleted_at IS NULL;
  IF v_operator IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_enabled THEN
    IF p_start IS NULL THEN
      RETURN jsonb_build_object('error', 'overnight_start_required');
    END IF;
    IF p_end IS NULL THEN
      RETURN jsonb_build_object('error', 'overnight_end_required');
    END IF;
    IF p_start = p_end THEN
      RETURN jsonb_build_object('error', 'overnight_times');
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('error', 'overnight_amount_required');
    END IF;
  END IF;
  INSERT INTO location_policies (
    location_id, overnight_enabled, overnight_start, overnight_end, overnight_amount
  )
  VALUES (p_location_id, v_enabled, p_start, p_end, p_amount)
  ON CONFLICT (location_id) DO UPDATE
    SET overnight_enabled = EXCLUDED.overnight_enabled,
        overnight_start = EXCLUDED.overnight_start,
        overnight_end = EXCLUDED.overnight_end,
        overnight_amount = EXCLUDED.overnight_amount;
  RETURN jsonb_build_object('success', true, 'overnight_enabled', v_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.set_overnight(uuid, boolean, time, time, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_overnight(uuid, boolean, time, time, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.price_stay(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_rate_id uuid DEFAULT NULL,
  p_area_id uuid DEFAULT NULL,
  p_slot_id uuid DEFAULT NULL,
  p_hourly_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_end timestamptz := COALESCE(p_end_at, now());
  v_hours numeric := GREATEST(EXTRACT(EPOCH FROM (v_end - p_start_at)) / 3600.0, 0.0001);
  v_billed integer := GREATEST(1, CEIL(v_hours));
  v_pick rates%ROWTYPE;
  v_rate rates%ROWTYPE;
  v_first rates%ROWTYPE;
  v_months integer;
  v_amount numeric;
  v_total numeric := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_bill_i integer[] := ARRAY[]::integer[];
  v_nights text[] := ARRAY[]::text[];
  v_id uuid;
  v_at timestamptz;
  v_n integer;
  v_breakdown jsonb := '[]'::jsonb;
  v_segments jsonb := '[]'::jsonb;
  v_part jsonb;
  v_flat_hours integer;
  v_succ_hours integer;
  v_flat_amount numeric;
  v_succ_amount numeric;
  v_seg_from integer;
  v_rate_hours integer;
  v_ov_on boolean := false;
  v_ov_start time;
  v_ov_end time;
  v_ov_price numeric;
  v_local timestamp;
  v_tod time;
  v_night text;
  v_night_count integer := 0;
  v_covered boolean;
  v_rate_id uuid;
  v_rate_name text;
  v_rate_kind text;
  i integer;
BEGIN
  IF p_rate_id IS NOT NULL THEN
    SELECT * INTO v_pick FROM rates WHERE id = p_rate_id AND location_id = p_location_id;
    IF v_pick.id IS NULL THEN
      RETURN jsonb_build_object('error', 'rate_not_found', 'until', v_end);
    END IF;
  ELSIF NOT COALESCE(p_hourly_only, false) THEN
    SELECT * INTO v_pick FROM rates
     WHERE id = walk_in_auto_rate(p_location_id, p_vehicle_type, p_start_at) AND rate_type = 'monthly';
  END IF;

  IF NOT COALESCE(p_hourly_only, false)
     AND v_pick.id IS NOT NULL AND v_pick.rate_type = 'monthly' AND v_pick.active THEN
    v_months := started_months(p_start_at, v_end);
    v_amount := COALESCE(v_pick.monthly_amount, 0) * v_months;
    RETURN jsonb_build_object(
      'amount', v_amount, 'mode', CASE WHEN p_rate_id IS NULL THEN 'auto' ELSE 'rate' END,
      'rate_id', v_pick.id, 'rate_name', v_pick.name, 'rate_type', v_pick.rate_type,
      'billed_hours', NULL, 'billed_months', v_months, 'until', v_end,
      'breakdown', jsonb_build_array(jsonb_build_object(
        'rate_id', v_pick.id, 'rate_name', v_pick.name, 'rate_type', v_pick.rate_type,
        'hours', NULL, 'months', v_months, 'amount', v_amount, 'from', p_start_at)),
      'segments', jsonb_build_array(jsonb_build_object('rate_id', v_pick.id, 'rate_name', v_pick.name,
        'from', p_start_at, 'to', v_end, 'hours', NULL)));
  END IF;
  IF p_rate_id IS NULL THEN
    v_pick := NULL;
  END IF;

  SELECT COALESCE(overnight_enabled, false), overnight_start, overnight_end, overnight_amount
    INTO v_ov_on, v_ov_start, v_ov_end, v_ov_price
    FROM location_policies WHERE location_id = p_location_id;
  v_ov_on := COALESCE(v_ov_on, false)
    AND v_ov_start IS NOT NULL AND v_ov_end IS NOT NULL AND v_ov_start <> v_ov_end
    AND COALESCE(v_ov_price, 0) > 0;

  -- Each billed hour is either inside the overnight window or priced by the rate in effect.
  FOR i IN 0 .. v_billed - 1 LOOP
    v_at := p_start_at + make_interval(hours => i);
    v_covered := false;
    IF v_ov_on THEN
      v_local := v_at AT TIME ZONE 'Asia/Manila';
      v_tod := v_local::time;
      IF v_ov_start < v_ov_end THEN
        v_covered := v_tod >= v_ov_start AND v_tod < v_ov_end;
        v_night := v_local::date::text;
      ELSE
        v_covered := v_tod >= v_ov_start OR v_tod < v_ov_end;
        v_night := (CASE WHEN v_tod >= v_ov_start THEN v_local::date ELSE v_local::date - 1 END)::text;
      END IF;
    END IF;
    IF v_covered THEN
      v_nights := v_nights || v_night;
    ELSE
      IF rate_applies_at(v_pick, p_vehicle_type, v_at) THEN
        v_id := v_pick.id;
      ELSE
        v_id := rate_in_effect_at(p_location_id, p_vehicle_type, v_at, p_area_id, p_slot_id);
      END IF;
      IF v_id IS NULL THEN
        RETURN jsonb_build_object('error', 'No rate found', 'uncovered_from', v_at, 'until', v_end);
      END IF;
      v_bill_i := v_bill_i || i;
      v_ids := v_ids || v_id;
    END IF;
  END LOOP;

  v_rate_hours := COALESCE(cardinality(v_ids), 0);
  IF v_rate_hours > 0 THEN
    v_seg_from := v_bill_i[1];
    FOR i IN 1 .. v_rate_hours LOOP
      IF i = v_rate_hours
         OR v_ids[i + 1] IS DISTINCT FROM v_ids[i]
         OR v_bill_i[i + 1] <> v_bill_i[i] + 1 THEN
        SELECT * INTO v_rate FROM rates WHERE id = v_ids[i];
        v_segments := v_segments || jsonb_build_array(jsonb_build_object(
          'rate_id', v_rate.id, 'rate_name', v_rate.name,
          'from', p_start_at + make_interval(hours => v_seg_from),
          'to', p_start_at + make_interval(hours => v_bill_i[i] + 1),
          'hours', v_bill_i[i] - v_seg_from + 1));
        IF i < v_rate_hours THEN
          v_seg_from := v_bill_i[i + 1];
        END IF;
      END IF;
    END LOOP;

    FOR v_id IN
      SELECT u.id FROM unnest(v_ids) WITH ORDINALITY AS u(id, n) GROUP BY u.id ORDER BY min(u.n)
    LOOP
      SELECT * INTO v_rate FROM rates WHERE id = v_id;
      SELECT count(*), min(n) INTO v_n, i FROM unnest(v_ids) WITH ORDINALITY AS u(id, n) WHERE u.id = v_id;
      v_amount := rate_amount_for_hours(v_rate, v_n);
      v_total := v_total + v_amount;
      v_part := jsonb_build_object(
        'rate_id', v_rate.id, 'rate_name', v_rate.name, 'rate_type', v_rate.rate_type,
        'hours', v_n, 'months', NULL, 'amount', v_amount,
        'from', p_start_at + make_interval(hours => v_bill_i[i]));
      IF v_rate.rate_type = 'flat_then_hourly' THEN
        v_flat_hours := COALESCE(v_rate.first_hours, 0);
        IF v_n <= v_flat_hours THEN
          v_flat_amount := v_amount;
          v_succ_hours := 0;
          v_succ_amount := 0;
        ELSE
          v_succ_hours := v_n - v_flat_hours;
          v_flat_amount := LEAST(COALESCE(v_rate.first_amount, 0), v_amount);
          v_succ_amount := v_amount - v_flat_amount;
        END IF;
        v_part := v_part || jsonb_build_object(
          'first_hours', v_flat_hours,
          'first_amount', v_flat_amount,
          'succeeding_hours', v_succ_hours,
          'succeeding_amount', v_succ_amount);
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(v_part);
    END LOOP;
    SELECT * INTO v_first FROM rates WHERE id = v_ids[1];
    v_rate_id := v_first.id;
    v_rate_name := v_first.name;
    v_rate_kind := v_first.rate_type::text;
  END IF;

  IF COALESCE(cardinality(v_nights), 0) > 0 THEN
    SELECT count(DISTINCT x) INTO v_night_count FROM unnest(v_nights) AS x;
    v_amount := v_ov_price * v_night_count;
    v_total := v_total + v_amount;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'rate_name', 'Overnight', 'rate_type', 'overnight',
      'hours', cardinality(v_nights), 'nights', v_night_count, 'months', NULL,
      'amount', v_amount));
  END IF;

  RETURN jsonb_build_object(
    'amount', v_total,
    'mode', CASE WHEN p_rate_id IS NULL THEN 'auto' ELSE 'rate' END,
    'rate_id', v_rate_id,
    'rate_name', COALESCE(v_rate_name, CASE WHEN v_night_count > 0 THEN 'Overnight' ELSE NULL END),
    'rate_type', CASE
      WHEN v_rate_kind IS NOT NULL THEN v_rate_kind
      WHEN v_night_count > 0 THEN 'overnight'
      ELSE NULL END,
    'billed_hours', v_rate_hours, 'billed_months', NULL, 'until', v_end,
    'breakdown', v_breakdown, 'segments', v_segments);
END;
$function$;

-- Rebuild quotes that have not started so the stored breakdown includes the overnight split.
UPDATE parking_sessions AS s
SET rate_snapshot = q.price
FROM (
  SELECT id,
    public.session_price(location_id, vehicle_type, started_at, scheduled_end_at, rate_id) AS price
  FROM parking_sessions
  WHERE approval_status IS NOT NULL
    AND cancelled_at IS NULL
    AND status IN ('active', 'overdue')
    AND started_at > now()
    AND scheduled_end_at IS NOT NULL
    AND vehicle_type IS NOT NULL
) AS q
WHERE s.id = q.id
  AND q.price ? 'amount'
  AND NOT (q.price ? 'error');

NOTIFY pgrst, 'reload schema';
