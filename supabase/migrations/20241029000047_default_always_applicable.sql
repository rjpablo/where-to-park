-- The default rate is always applicable (rj: "The default rate should always be
-- applicable.").
--
-- 1. A default rate is for all vehicles, not limited to an area or spot, active, and
--    (0042) without dates or days of week. Existing defaults that break this are
--    fixed first (vehicle/area/spot cleared, made active; none on staging), then a
--    check constraint enforces it.
-- 2. set_default_rate refuses vehicle-specific ('default_cannot_have_vehicle'),
--    area/spot-limited ('default_cannot_have_area') and inactive rates.
-- 3. upsert_rate refuses a vehicle type, an area or 'inactive' on a new or edited
--    default (same codes).
-- 4. walk_in_rates (0045) always includes the listing's default, so it is always in
--    the rate dropdown and Automatic can always price a session (the default is the
--    last-resort rate in quote_price for every hour). 'no_applicable_rate' stays as a
--    guard (it can only fire for a listing with no default at all).
-- Every staging listing has an active all-vehicle default (checked 2026-11-01).

UPDATE rates
   SET vehicle_type = NULL, area_id = NULL, slot_id = NULL, active = true
 WHERE is_default
   AND (vehicle_type IS NOT NULL OR area_id IS NOT NULL OR slot_id IS NOT NULL OR NOT COALESCE(active, false));

ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_default_no_limits;
ALTER TABLE rates ADD CONSTRAINT rates_default_no_limits CHECK (
  NOT is_default OR (
    effective_from IS NULL AND effective_to IS NULL
    AND (days_of_week IS NULL OR cardinality(days_of_week) = 0)
    AND vehicle_type IS NULL AND area_id IS NULL AND slot_id IS NULL
    AND active IS TRUE
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
  IF v_rate.vehicle_type IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'default_cannot_have_vehicle');
  END IF;
  IF v_rate.area_id IS NOT NULL OR v_rate.slot_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'default_cannot_have_area');
  END IF;

  PERFORM 1 FROM locations WHERE id = v_rate.location_id FOR UPDATE;

  UPDATE rates SET is_default = false
   WHERE location_id = v_rate.location_id AND is_default AND id <> p_rate_id;
  UPDATE rates SET is_default = true WHERE id = p_rate_id;

  RETURN jsonb_build_object('success', true, 'rate_id', p_rate_id);
END;
$$;


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



CREATE OR REPLACE FUNCTION public.walk_in_rates(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz
)
RETURNS SETOF rates
LANGUAGE sql
STABLE
SECURITY DEFINER
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
       AND area_id IS NULL
       AND slot_id IS NULL
       AND (vehicle_type IS NULL OR vehicle_type = p_vehicle_type)
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
       WHEN vehicle_type IS NOT NULL THEN 3
       WHEN days_of_week IS NOT NULL AND cardinality(days_of_week) > 0 THEN 4
       WHEN is_default THEN 5
       ELSE 6
     END,
     priority DESC,
     created_at DESC;
$function$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Every listing always has exactly one default rate. create_location inserts
-- the listing and its default in one transaction; the RPCs refuse deleting or
-- unsetting the default. These deferred checks also cover direct table writes
-- (operators have RLS write access to rates and locations), checked at commit
-- so set_default_rate's swap and create_location's two inserts pass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_location_has_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'locations' THEN
    v_location_id := NEW.id;
  ELSE
    v_location_id := OLD.location_id;
  END IF;
  -- A listing being deleted takes its rates with it.
  IF NOT EXISTS (SELECT 1 FROM locations WHERE id = v_location_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM rates WHERE location_id = v_location_id AND is_default
  ) THEN
    RAISE EXCEPTION 'listing_needs_default_rate' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_location_has_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS locations_need_default_rate ON locations;
CREATE CONSTRAINT TRIGGER locations_need_default_rate
  AFTER INSERT ON locations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ensure_location_has_default();

DROP TRIGGER IF EXISTS rates_keep_default ON rates;
CREATE CONSTRAINT TRIGGER rates_keep_default
  AFTER UPDATE OF is_default, location_id OR DELETE ON rates
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.is_default)
  EXECUTE FUNCTION public.ensure_location_has_default();
