-- Rate vehicle type in the New/Edit rate form (rj: "Yes" to adding a vehicle-type
-- choice; optional, empty = all vehicles).
--
-- 1. upsert_rate gains p_vehicle_type (NULL = all vehicles). Same rules otherwise
--    (0041/0042). Old signature dropped so PostgREST has one function.
-- 2. The last-resort default fallback in rate_in_effect_at (0043) now also needs
--    the default to match the vehicle (a car-only default doesn't price a
--    motorcycle); before, it ignored the default's vehicle type.

DROP FUNCTION IF EXISTS public.upsert_rate(uuid, text, rate_type, uuid, boolean, numeric, numeric, numeric, integer, numeric, numeric, numeric, uuid, timestamptz, timestamptz, boolean, integer[]);

CREATE OR REPLACE FUNCTION public.upsert_rate(p_location_id uuid, p_name text, p_rate_type rate_type, p_rate_id uuid DEFAULT NULL::uuid, p_is_default boolean DEFAULT false, p_hourly_amount numeric DEFAULT NULL::numeric, p_daily_amount numeric DEFAULT NULL::numeric, p_monthly_amount numeric DEFAULT NULL::numeric, p_first_hours integer DEFAULT NULL::integer, p_first_amount numeric DEFAULT NULL::numeric, p_succeeding_hourly_amount numeric DEFAULT NULL::numeric, p_max_per_day numeric DEFAULT NULL::numeric, p_area_id uuid DEFAULT NULL::uuid, p_effective_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_effective_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_active boolean DEFAULT true, p_days_of_week integer[] DEFAULT NULL::integer[], p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type)
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
      area_id, effective_from, effective_to, active, days_of_week, vehicle_type
    ) VALUES (
      p_location_id, v_is_default, btrim(p_name), p_rate_type,
      p_hourly_amount, p_daily_amount, p_monthly_amount,
      p_first_hours, p_first_amount, p_succeeding_hourly_amount, p_max_per_day,
      p_area_id, p_effective_from, p_effective_to, COALESCE(p_active, true), v_days, p_vehicle_type
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
      days_of_week = v_days,
      vehicle_type = p_vehicle_type
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


GRANT EXECUTE ON FUNCTION public.upsert_rate(uuid, text, rate_type, uuid, boolean, numeric, numeric, numeric, integer, numeric, numeric, numeric, uuid, timestamptz, timestamptz, boolean, integer[], vehicle_type) TO authenticated, service_role;

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
        AND (vehicle_type IS NULL OR vehicle_type = p_vehicle_type)
      LIMIT 1)
  );
$function$;

NOTIFY pgrst, 'reload schema';
