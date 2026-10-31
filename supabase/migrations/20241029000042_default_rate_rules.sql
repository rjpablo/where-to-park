-- Default rate rules, revised (rj: "The default rate should not have a date limit or a
-- day-of-week assignment, but setting it to monthly or any other rate type should
-- still be allowed"). Replaces the 0039 rule that refused monthly and dated defaults.
--
-- 1. A default rate has no effective dates and no days of week (check constraint;
--    none on staging break it).
-- 2. set_default_rate: any rate type, including monthly; refuses rates with dates,
--    days of week, or inactive.
-- 3. upsert_rate: refuses dates/days on the default (new or edited), same codes.
--
-- Pricing with a monthly default: monthly rates never price a stay (quote_price skips
-- them), so the default only prices short stays when it is hourly/daily/flat. With a
-- monthly default, stays are priced by the listing's other matching rates; if none
-- match, quote_price returns its 'No rate found' error (the preview explains it; a
-- walk-in still starts, billed 0 until staff add a charge). See docs/spec.md.

ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_default_no_limits;
ALTER TABLE rates ADD CONSTRAINT rates_default_no_limits CHECK (
  NOT is_default OR (
    effective_from IS NULL AND effective_to IS NULL
    AND (days_of_week IS NULL OR cardinality(days_of_week) = 0)
  )
);

CREATE OR REPLACE FUNCTION public.set_default_rate(p_rate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rate RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT r.*, l.operator_id
    INTO v_rate
    FROM rates r
    JOIN locations l ON l.id = r.location_id
   WHERE r.id = p_rate_id
     FOR UPDATE OF r;

  IF v_rate IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_rate.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_rate.is_default THEN
    RETURN jsonb_build_object('success', true, 'rate_id', v_rate.id, 'unchanged', true);
  END IF;
  IF v_rate.effective_from IS NOT NULL OR v_rate.effective_to IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'default_cannot_have_dates');
  END IF;
  IF v_rate.days_of_week IS NOT NULL AND cardinality(v_rate.days_of_week) > 0 THEN
    RETURN jsonb_build_object('error', 'default_cannot_have_days');
  END IF;
  IF NOT v_rate.active THEN
    RETURN jsonb_build_object('error', 'default_must_be_active');
  END IF;

  PERFORM 1 FROM locations WHERE id = v_rate.location_id FOR UPDATE;

  UPDATE rates SET is_default = false
   WHERE location_id = v_rate.location_id AND is_default AND id <> p_rate_id;
  UPDATE rates SET is_default = true WHERE id = p_rate_id;

  RETURN jsonb_build_object('success', true, 'rate_id', p_rate_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_rate(p_location_id uuid, p_name text, p_rate_type rate_type, p_rate_id uuid DEFAULT NULL::uuid, p_is_default boolean DEFAULT false, p_hourly_amount numeric DEFAULT NULL::numeric, p_daily_amount numeric DEFAULT NULL::numeric, p_monthly_amount numeric DEFAULT NULL::numeric, p_first_hours integer DEFAULT NULL::integer, p_first_amount numeric DEFAULT NULL::numeric, p_succeeding_hourly_amount numeric DEFAULT NULL::numeric, p_max_per_day numeric DEFAULT NULL::numeric, p_area_id uuid DEFAULT NULL::uuid, p_effective_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_effective_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_active boolean DEFAULT true, p_days_of_week integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_rate_id UUID;
  v_is_default BOOLEAN;
  v_days INTEGER[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  -- Validate fields per type
  IF p_rate_type = 'hourly' AND (p_hourly_amount IS NULL OR p_hourly_amount < 0) THEN
    RETURN jsonb_build_object('error', 'hourly_amount_required');
  END IF;
  IF p_rate_type = 'daily' AND (p_daily_amount IS NULL OR p_daily_amount < 0) THEN
    RETURN jsonb_build_object('error', 'daily_amount_required');
  END IF;
  IF p_rate_type = 'monthly' AND (p_monthly_amount IS NULL OR p_monthly_amount < 0) THEN
    RETURN jsonb_build_object('error', 'monthly_amount_required');
  END IF;
  IF p_rate_type = 'flat_then_hourly' AND (
    p_first_hours IS NULL OR p_first_hours < 1
    OR p_first_amount IS NULL OR p_succeeding_hourly_amount IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'flat_then_hourly_fields_required');
  END IF;

  -- Days of week (0 = Sunday … 6 = Saturday, Asia/Manila); empty = every day (NULL).
  IF p_days_of_week IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_days_of_week) d WHERE d IS NULL OR d < 0 OR d > 6) THEN
    RETURN jsonb_build_object('error', 'days_of_week_invalid');
  END IF;
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE array_agg(d ORDER BY d) END
    INTO v_days
    FROM (SELECT DISTINCT unnest(p_days_of_week) d) x;

  v_is_default := COALESCE(p_is_default, false);

  -- The default rate applies every day with no dates (any rate type is fine).
  IF v_is_default OR (p_rate_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rates WHERE id = p_rate_id AND location_id = p_location_id AND is_default
  )) THEN
    IF p_effective_from IS NOT NULL OR p_effective_to IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_dates');
    END IF;
    IF v_days IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_days');
    END IF;
  END IF;
  IF v_is_default THEN
    UPDATE rates SET is_default = false
    WHERE location_id = p_location_id
      AND is_default = true
      AND (p_rate_id IS NULL OR id <> p_rate_id);
  END IF;

  IF p_rate_id IS NULL THEN
    INSERT INTO rates (
      location_id, is_default, name, rate_type,
      hourly_amount, daily_amount, monthly_amount,
      first_hours, first_amount, succeeding_hourly_amount, max_per_day,
      area_id, effective_from, effective_to, active, days_of_week
    ) VALUES (
      p_location_id, v_is_default, btrim(p_name), p_rate_type,
      p_hourly_amount, p_daily_amount, p_monthly_amount,
      p_first_hours, p_first_amount, p_succeeding_hourly_amount, p_max_per_day,
      p_area_id, p_effective_from, p_effective_to, COALESCE(p_active, true), v_days
    ) RETURNING id INTO v_rate_id;
  ELSE
    UPDATE rates
    SET
      name = btrim(p_name),
      rate_type = p_rate_type,
      is_default = CASE WHEN is_default THEN true ELSE v_is_default END,
      hourly_amount = p_hourly_amount,
      daily_amount = p_daily_amount,
      monthly_amount = p_monthly_amount,
      first_hours = p_first_hours,
      first_amount = p_first_amount,
      succeeding_hourly_amount = p_succeeding_hourly_amount,
      max_per_day = p_max_per_day,
      area_id = p_area_id,
      effective_from = p_effective_from,
      effective_to = p_effective_to,
      active = COALESCE(p_active, active),
      days_of_week = v_days
    WHERE id = p_rate_id AND location_id = p_location_id
    RETURNING id INTO v_rate_id;
    IF v_rate_id IS NULL THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'rate_id', v_rate_id);
END;
$function$
;

NOTIFY pgrst, 'reload schema';
