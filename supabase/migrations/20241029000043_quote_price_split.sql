-- Split pricing across rates (rj: "Let's split across rates. The staff/operator has
-- the option to add additional charges, such as overnight parking fee, if they wish to.")
--
-- Before: the rate in effect when the stay started priced the whole stay.
-- Now each part of the stay is priced at the rate in effect for that time:
--
-- * Billing unit: the stay is billed in started hours, billed_hours =
--   max(1, ceil(hours)) (unchanged). Billed hour i runs from start + i hours.
-- * Each billed hour belongs to the rate in effect at that hour's START, picked
--   with the same rules as before (active, non-monthly, vehicle/area/slot match,
--   effective dates, days of week in Asia/Manila; dated first, then slot > area >
--   vehicle > day-limited > default > other, then priority, then newest; last
--   resort the active non-monthly default).
--   Example: Sunday 22:00 for 4 h with Weekend ₱60/h (Sat, Sun) and a weekday
--   ₱40/h default = 2 h × ₱60 + 2 h × ₱40 = ₱200.
-- * Each rate is then charged for the hours it got, with its own formula, as if
--   those hours were one stay: hourly × hours; daily × ceil(hours / 24);
--   flat_then_hourly = first amount for the first 'first hours' of THAT rate's
--   hours (charged once per stay per rate), then the succeeding hourly amount;
--   max_per_day caps that rate's amount at max_per_day × ceil(its hours / 24).
-- * If any billed hour has no rate (e.g. only a monthly default and no other rate
--   for that time), the quote fails with 'No rate found' (as before for the whole
--   stay), plus 'uncovered_from' = the start of the first such hour.
-- * Result: amount and billed_hours as before; rate_id, rate_name and rate_type
--   are the rate of the FIRST billed hour (start_walk_in stores them as the
--   snapshot); new 'breakdown' = one entry per rate, in order of first use:
--   {rate_id, rate_name, rate_type, hours, amount, from} ('from' = the first hour
--   start of that rate), and 'segments' = consecutive runs
--   {rate_id, rate_name, from, to, hours}.
-- * Extra charges such as an overnight fee are NOT automatic: staff add them as
--   folio charges (Fee presets / additional charges), on top of this quote.
-- Signature unchanged (start_walk_in and session_parking_quote call it).

CREATE OR REPLACE FUNCTION public.rate_in_effect_at(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_at timestamp with time zone,
  p_area_id uuid DEFAULT NULL,
  p_slot_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT id
       FROM rates
      WHERE location_id = p_location_id
        AND active = true
        AND rate_type != 'monthly'
        AND (vehicle_type IS NULL OR vehicle_type = p_vehicle_type)
        AND (area_id IS NULL OR area_id = p_area_id)
        AND (slot_id IS NULL OR slot_id = p_slot_id)
        AND (effective_from IS NULL OR effective_from <= p_at)
        AND (effective_to IS NULL OR effective_to >= p_at)
        AND (days_of_week IS NULL OR cardinality(days_of_week) = 0
             OR EXTRACT(DOW FROM (p_at AT TIME ZONE 'Asia/Manila'))::int = ANY (days_of_week))
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
      LIMIT 1),
    (SELECT id
       FROM rates
      WHERE location_id = p_location_id
        AND is_default = true
        AND active = true
        AND rate_type != 'monthly'
      LIMIT 1)
  );
$function$;

REVOKE ALL ON FUNCTION public.rate_in_effect_at(uuid, vehicle_type, timestamptz, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rate_amount_for_hours(p_rate rates, p_hours integer)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_amount numeric;
BEGIN
  CASE p_rate.rate_type
    WHEN 'hourly' THEN
      v_amount := COALESCE(p_rate.hourly_amount, 0) * p_hours;
    WHEN 'daily' THEN
      v_amount := COALESCE(p_rate.daily_amount, 0) * CEIL(p_hours / 24.0);
    WHEN 'flat_then_hourly' THEN
      IF p_hours <= COALESCE(p_rate.first_hours, 0) THEN
        v_amount := COALESCE(p_rate.first_amount, 0);
      ELSE
        v_amount := COALESCE(p_rate.first_amount, 0)
          + COALESCE(p_rate.succeeding_hourly_amount, 0) * (p_hours - COALESCE(p_rate.first_hours, 0));
      END IF;
    ELSE
      v_amount := 0;
  END CASE;
  IF p_rate.max_per_day IS NOT NULL THEN
    v_amount := LEAST(v_amount, p_rate.max_per_day * CEIL(p_hours / 24.0));
  END IF;
  RETURN v_amount;
END;
$function$;

REVOKE ALL ON FUNCTION public.rate_amount_for_hours(rates, integer) FROM PUBLIC, anon, authenticated;

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
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_billed_hours integer := GREATEST(1, CEIL(COALESCE(p_hours, 1)));
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_at timestamptz;
  v_first rates%ROWTYPE;
  v_rate rates%ROWTYPE;
  v_total numeric := 0;
  v_amount numeric;
  v_hours integer;
  v_breakdown jsonb := '[]'::jsonb;
  v_segments jsonb := '[]'::jsonb;
  v_seg_start integer := 0;
  i integer;
BEGIN
  -- 1. The rate in effect at the start of each billed hour.
  FOR i IN 0 .. v_billed_hours - 1 LOOP
    v_at := p_start_at + make_interval(hours => i);
    v_id := rate_in_effect_at(p_location_id, p_vehicle_type, v_at, p_area_id, p_slot_id);
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'No rate found', 'uncovered_from', v_at);
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  -- 2. Consecutive runs of the same rate.
  FOR i IN 1 .. v_billed_hours LOOP
    IF i = v_billed_hours OR v_ids[i + 1] <> v_ids[i] THEN
      SELECT * INTO v_rate FROM rates WHERE id = v_ids[i];
      v_segments := v_segments || jsonb_build_array(jsonb_build_object(
        'rate_id', v_rate.id,
        'rate_name', v_rate.name,
        'from', p_start_at + make_interval(hours => v_seg_start),
        'to', p_start_at + make_interval(hours => i),
        'hours', i - v_seg_start
      ));
      v_seg_start := i;
    END IF;
  END LOOP;

  -- 3. Each rate charged for its own hours, in order of first use.
  FOR v_id IN
    SELECT u.id FROM unnest(v_ids) WITH ORDINALITY AS u(id, n)
    GROUP BY u.id ORDER BY min(u.n)
  LOOP
    SELECT * INTO v_rate FROM rates WHERE id = v_id;
    SELECT count(*), min(n) INTO v_hours, i
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, n) WHERE u.id = v_id;
    v_amount := rate_amount_for_hours(v_rate, v_hours);
    v_total := v_total + v_amount;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'rate_id', v_rate.id,
      'rate_name', v_rate.name,
      'rate_type', v_rate.rate_type,
      'hours', v_hours,
      'amount', v_amount,
      'from', p_start_at + make_interval(hours => i - 1)
    ));
  END LOOP;

  SELECT * INTO v_first FROM rates WHERE id = v_ids[1];

  RETURN jsonb_build_object(
    'amount', v_total,
    'rate_id', v_first.id,
    'rate_name', v_first.name,
    'rate_type', v_first.rate_type,
    'billed_hours', v_billed_hours,
    'breakdown', v_breakdown,
    'segments', v_segments
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
