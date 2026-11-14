-- quote_price fixes (rj: "Price preview is not currently working as expected").
--
-- 1. days_of_week was ignored: a day-limited rate (e.g. SM City's 'Weekend Rate',
--    days 0 and 6) never applied, and could even be picked on the wrong day. A rate
--    with days now only matches when the stay STARTS on one of those days, counted in
--    Asia/Manila (0 = Sunday … 6 = Saturday, as validate_rate_days_of_week).
-- 2. A day-limited rate now ranks above the default (it is more specific); before,
--    the default (rank 4) always beat it (rank 5).
-- 3. A rate with only 'effective to' wasn't treated as dated (only effective_from
--    was checked), so it ranked below undated rates.
-- 4. The last-resort fallback to the default ignored 'active' and could pick a
--    monthly rate (quoting ₱0); it now requires an active, non-monthly default.
-- 5. SECURITY DEFINER without a fixed search_path: now SET search_path = public.
--
-- Rule for a stay crossing midnight (or a date limit): the rate in effect when the
-- stay starts prices the whole stay (unchanged; documented in docs/spec.md).
-- Signature unchanged (session_parking_quote and start_walk_in call it).

CREATE OR REPLACE FUNCTION public.quote_price(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamp with time zone,
  p_hours numeric DEFAULT NULL::numeric,
  p_area_id uuid DEFAULT NULL::uuid,
  p_slot_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rate RECORD;
  v_amount NUMERIC;
  v_billed_hours INTEGER;
  v_dow INTEGER := EXTRACT(DOW FROM (p_start_at AT TIME ZONE 'Asia/Manila'))::int;
BEGIN
  -- Best matching rate, in this order:
  -- 1. dated rates (effective from and/or to)
  -- 2. slot > area > vehicle type > day-of-week limited > default > other
  -- 3. priority, then newest
  SELECT * INTO v_rate
  FROM rates
  WHERE location_id = p_location_id
    AND active = true
    AND rate_type != 'monthly'
    AND (vehicle_type IS NULL OR vehicle_type = p_vehicle_type)
    AND (area_id IS NULL OR area_id = p_area_id)
    AND (slot_id IS NULL OR slot_id = p_slot_id)
    AND (effective_from IS NULL OR effective_from <= p_start_at)
    AND (effective_to IS NULL OR effective_to >= p_start_at)
    AND (days_of_week IS NULL OR cardinality(days_of_week) = 0 OR v_dow = ANY (days_of_week))
  ORDER BY
    CASE WHEN effective_from IS NOT NULL OR effective_to IS NOT NULL THEN 1 ELSE 2 END,
    CASE
      WHEN slot_id IS NOT NULL THEN 1
      WHEN area_id IS NOT NULL THEN 2
      WHEN vehicle_type IS NOT NULL THEN 3
      WHEN days_of_week IS NOT NULL AND cardinality(days_of_week) > 0 THEN 4
      WHEN is_default THEN 5
      ELSE 6
    END,
    priority DESC,
    created_at DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    -- Last resort: the listing's default rate
    SELECT * INTO v_rate
    FROM rates
    WHERE location_id = p_location_id
      AND is_default = true
      AND active = true
      AND rate_type != 'monthly'
    LIMIT 1;
  END IF;

  IF v_rate IS NULL THEN
    RETURN jsonb_build_object('error', 'No rate found');
  END IF;

  v_billed_hours := GREATEST(1, CEIL(COALESCE(p_hours, 1)));

  CASE v_rate.rate_type
    WHEN 'hourly' THEN
      v_amount := v_rate.hourly_amount * v_billed_hours;
    WHEN 'daily' THEN
      v_amount := v_rate.daily_amount * CEIL(v_billed_hours / 24.0);
    WHEN 'flat_then_hourly' THEN
      IF v_billed_hours <= v_rate.first_hours THEN
        v_amount := v_rate.first_amount;
      ELSE
        v_amount := v_rate.first_amount + (v_rate.succeeding_hourly_amount * (v_billed_hours - v_rate.first_hours));
      END IF;
    ELSE
      v_amount := 0;
  END CASE;

  IF v_rate.max_per_day IS NOT NULL THEN
    v_amount := LEAST(v_amount, v_rate.max_per_day * CEIL(v_billed_hours / 24.0));
  END IF;

  RETURN jsonb_build_object(
    'amount', v_amount,
    'rate_id', v_rate.id,
    'rate_name', v_rate.name,
    'rate_type', v_rate.rate_type,
    'billed_hours', v_billed_hours
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
