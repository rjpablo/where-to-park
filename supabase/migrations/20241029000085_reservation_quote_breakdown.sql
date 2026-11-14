-- 0085 One price calculation for the whole app, and the driver sees it before sending
-- a reservation.
--
-- price_stay is the only function that prices a stay. session_price (walk-ins,
-- sessions, reservations) and quote_price (the Rates preview) both call it.
-- The preview stays hourly: it does not switch a stay onto a monthly rate.
-- reservation_quote returns that same price, including the per-rate breakdown.

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
  v_seg_start integer := 0;
  i integer;
BEGIN
  IF p_rate_id IS NOT NULL THEN
    SELECT * INTO v_pick FROM rates WHERE id = p_rate_id AND location_id = p_location_id;
    IF v_pick.id IS NULL THEN
      RETURN jsonb_build_object('error', 'rate_not_found', 'until', v_end);
    END IF;
  ELSIF NOT COALESCE(p_hourly_only, false) THEN
    -- Automatic: monthly only when no hourly rate applies at the start (0054 rule).
    SELECT * INTO v_pick FROM rates
     WHERE id = walk_in_auto_rate(p_location_id, p_vehicle_type, p_start_at) AND rate_type = 'monthly';
  END IF;

  -- Monthly (picked and active, or Automatic's monthly): whole stay in started months.
  -- The Rates preview asks for hourly only, so it never takes this branch.
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

  -- 1. Each billed hour: the picked rate if it applies then, else the priority rule.
  FOR i IN 0 .. v_billed - 1 LOOP
    v_at := p_start_at + make_interval(hours => i);
    IF rate_applies_at(v_pick, p_vehicle_type, v_at) THEN
      v_id := v_pick.id;
    ELSE
      v_id := rate_in_effect_at(p_location_id, p_vehicle_type, v_at, p_area_id, p_slot_id);
    END IF;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'No rate found', 'uncovered_from', v_at, 'until', v_end);
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  -- 2. Consecutive runs.
  FOR i IN 1 .. v_billed LOOP
    IF i = v_billed OR v_ids[i + 1] <> v_ids[i] THEN
      SELECT * INTO v_rate FROM rates WHERE id = v_ids[i];
      v_segments := v_segments || jsonb_build_array(jsonb_build_object(
        'rate_id', v_rate.id, 'rate_name', v_rate.name,
        'from', p_start_at + make_interval(hours => v_seg_start),
        'to', p_start_at + make_interval(hours => i), 'hours', i - v_seg_start));
      v_seg_start := i;
    END IF;
  END LOOP;

  -- 3. Each rate charged for its own hours, in order of first use.
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
      'from', p_start_at + make_interval(hours => i - 1));
    -- Flat + succeeding: the flat window and the hours after it, already in v_amount.
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
  RETURN jsonb_build_object(
    'amount', v_total,
    'mode', CASE WHEN p_rate_id IS NULL THEN 'auto' ELSE 'rate' END,
    'rate_id', v_first.id, 'rate_name', v_first.name, 'rate_type', v_first.rate_type,
    'billed_hours', v_billed, 'billed_months', NULL, 'until', v_end,
    'breakdown', v_breakdown, 'segments', v_segments);
END;
$function$;

REVOKE ALL ON FUNCTION public.price_stay(uuid, vehicle_type, timestamptz, timestamptz, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Sessions, walk-ins and reservations. Same arguments as before.
CREATE OR REPLACE FUNCTION public.session_price(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_rate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN price_stay(p_location_id, p_vehicle_type, p_start_at, p_end_at, p_rate_id, NULL, NULL, false);
END;
$function$;

-- Rates preview: a number of hours from a start, still hourly, still area/slot aware.
CREATE OR REPLACE FUNCTION public.quote_price(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz,
  p_hours numeric DEFAULT NULL,
  p_area_id uuid DEFAULT NULL,
  p_slot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_billed integer := GREATEST(1, CEIL(COALESCE(p_hours, 1)))::integer;
BEGIN
  RETURN price_stay(
    p_location_id,
    p_vehicle_type,
    p_start_at,
    p_start_at + make_interval(hours => v_billed),
    NULL,
    p_area_id,
    p_slot_id,
    true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reservation_quote(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_started_at timestamptz,
  p_end_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_check jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  v_check := reservation_check(p_location_id, p_vehicle_type, 'QUOTE', p_started_at, p_end_at, false);
  IF v_check ? 'error' THEN
    RETURN v_check;
  END IF;
  RETURN jsonb_build_object('success', true, 'amount', v_check->'amount', 'price', v_check->'price');
END;
$$;

-- Unstarted reservations keep the price they were quoted. Rebuild it with the same
-- calculator so the stored breakdown includes a flat rate's first hours and succeeding hours.
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
