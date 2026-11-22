-- rj t239u: a rate's vehicle types come from its area. Rates no longer have their own
-- vehicle type (New/Edit rate drops the field). An area rate applies to exactly the
-- vehicles its area takes; the default applies to every vehicle.
--
-- Existing rate-level vehicle values are cleared, so such a rate now applies to every
-- vehicle its area takes. Pricing order within an area becomes: dated > spot > days >
-- plain (then priority, newest); the "vehicle-specific" step is gone.
-- The rates.vehicle_type column stays (old app versions still send it) but is always NULL.

UPDATE public.rates SET vehicle_type = NULL WHERE vehicle_type IS NOT NULL;
ALTER TABLE public.rates DROP CONSTRAINT IF EXISTS rates_no_vehicle;
ALTER TABLE public.rates ADD CONSTRAINT rates_no_vehicle CHECK (vehicle_type IS NULL);

CREATE OR REPLACE FUNCTION public.rate_fits_vehicle(p_area_id uuid, p_rate_vehicle vehicle_type, p_vehicle vehicle_type)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- p_rate_vehicle is ignored (always NULL since 0098): the area decides.
  SELECT p_area_id IS NULL OR p_vehicle IS NULL OR EXISTS (
           SELECT 1 FROM areas a WHERE a.id = p_area_id
              AND area_allows_vehicle(a.vehicle_types, p_vehicle));
$function$;

CREATE OR REPLACE FUNCTION public.rate_in_effect_at(p_location_id uuid, p_vehicle_type vehicle_type, p_at timestamp with time zone, p_area_id uuid DEFAULT NULL::uuid, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT id
       FROM rates
      WHERE location_id = p_location_id
        AND NOT is_default
        AND active = true
        AND deleted_at IS NULL
        AND rate_type != 'monthly'
        AND area_id = COALESCE(p_area_id, main_area_id(p_location_id))
        AND rate_fits_vehicle(area_id, vehicle_type, p_vehicle_type)
        AND (slot_id IS NULL OR slot_id = p_slot_id)
        AND (effective_from IS NULL OR effective_from <= p_at)
        AND (effective_to IS NULL OR effective_to >= p_at)
        AND (days_of_week IS NULL OR cardinality(days_of_week) = 0
             OR EXTRACT(DOW FROM (p_at AT TIME ZONE 'Asia/Manila'))::int = ANY (days_of_week))
      ORDER BY
        CASE WHEN effective_from IS NOT NULL OR effective_to IS NOT NULL THEN 1 ELSE 2 END,
        CASE
          WHEN slot_id IS NOT NULL THEN 1
          WHEN days_of_week IS NOT NULL AND cardinality(days_of_week) > 0 THEN 4
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

CREATE OR REPLACE FUNCTION public.walk_in_rates(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_area_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF rates
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT *
      FROM rates
     WHERE location_id = p_location_id
       AND is_default
       AND active = true
    UNION
    SELECT *
      FROM rates
     WHERE location_id = p_location_id
       AND active = true
       AND deleted_at IS NULL
       AND area_id = COALESCE(p_area_id, main_area_id(p_location_id))
       AND slot_id IS NULL
       AND rate_fits_vehicle(area_id, vehicle_type, p_vehicle_type)
       AND (effective_from IS NULL OR effective_from <= p_start_at)
       AND (effective_to IS NULL OR effective_to >= p_start_at)
       AND (days_of_week IS NULL OR cardinality(days_of_week) = 0
            OR EXTRACT(DOW FROM (p_start_at AT TIME ZONE 'Asia/Manila'))::int = ANY (days_of_week))
  )
  SELECT *
    FROM base
   WHERE rate_type != 'monthly'
      OR is_default
      OR NOT EXISTS (SELECT 1 FROM base b WHERE b.rate_type != 'monthly')
   ORDER BY
     CASE WHEN effective_from IS NOT NULL OR effective_to IS NOT NULL THEN 1 ELSE 2 END,
     CASE
       WHEN days_of_week IS NOT NULL AND cardinality(days_of_week) > 0 THEN 4
       WHEN is_default THEN 5
       ELSE 6
     END,
     priority DESC,
     created_at DESC;
$function$;

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
  v_area areas%ROWTYPE;
BEGIN
  -- rj t239u (0098): a rate takes its area's vehicle types; any vehicle sent is ignored.
  p_vehicle_type := NULL;
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
    IF p_vehicle_type IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_vehicle');
    END IF;
    IF p_area_id IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'default_cannot_have_area');
    END IF;
    IF p_active IS NOT NULL AND NOT p_active THEN
      RETURN jsonb_build_object('error', 'default_must_be_active');
    END IF;
  END IF;
  -- PAD-6: the default is listing-wide and others need an area, so an old default can't
  -- be turned into a plain rate here: change the default rate itself instead.
  IF v_is_default AND EXISTS (
    SELECT 1 FROM rates WHERE location_id = p_location_id AND is_default
       AND (p_rate_id IS NULL OR id <> p_rate_id)
  ) THEN
    RETURN jsonb_build_object('error', 'default_exists');
  END IF;
  -- PAD-6: every rate except the default belongs to one area of this listing, and its
  -- vehicle limit must be one the area takes. Deleted rates can't be edited.
  IF p_rate_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rates WHERE id = p_rate_id AND location_id = p_location_id AND deleted_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('error', 'rate_deleted');
  END IF;
  IF NOT v_is_default AND NOT (p_rate_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rates WHERE id = p_rate_id AND location_id = p_location_id AND is_default
  )) THEN
    IF p_area_id IS NULL THEN
      RETURN jsonb_build_object('error', 'area_required');
    END IF;
    SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = p_location_id
      AND deleted_at IS NULL;
    IF v_area.id IS NULL THEN
      RETURN jsonb_build_object('error', 'area_not_found');
    END IF;
    IF p_vehicle_type IS NOT NULL AND NOT area_allows_vehicle(v_area.vehicle_types, p_vehicle_type) THEN
      RETURN jsonb_build_object('error', 'vehicle_not_in_area', 'area', v_area.name);
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
$function$;

REVOKE ALL ON FUNCTION public.rate_fits_vehicle(uuid, vehicle_type, vehicle_type) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
