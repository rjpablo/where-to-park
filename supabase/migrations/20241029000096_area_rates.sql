-- PAD-6 (rj t234u/t236u): area-specific rates.
--
-- Every rate except the listing's default now belongs to exactly one area. The default
-- still applies to any day and any vehicle. An area rate applies to sessions in that area
-- and inherits the area's vehicle types (plus its own vehicle limit, if any).
--
-- Pricing: first the rates of the session's area (Main when none is given), in the same
-- order as before (dated > slot > vehicle > days > plain, then priority, newest), then the
-- default.
--
-- Existing listing-wide non-default rates are moved to the listing's Main area. That keeps
-- their prices for Main sessions, so this file is safe to run where real data exists.
-- (Staging test rates and reservations were deleted separately, not here.)
--
-- Deleting an area soft-deletes its rates (rates.deleted_at; they also become inactive
-- and archived). Deleted rates never show and are never used. delete_area is also blocked
-- while the area has reservations.

-- 1. Soft delete for rates.
ALTER TABLE public.rates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2. Listing-wide non-default rates move to the Main area.
UPDATE public.rates r
   SET area_id = main_area_id(r.location_id)
 WHERE NOT r.is_default AND r.area_id IS NULL AND r.deleted_at IS NULL
   AND main_area_id(r.location_id) IS NOT NULL;

-- Any left without an area (a listing with no Main area) are retired.
UPDATE public.rates r
   SET deleted_at = now(), archived_at = COALESCE(r.archived_at, now())
 WHERE NOT r.is_default AND r.area_id IS NULL AND r.deleted_at IS NULL AND NOT r.active;

-- 3. Only the default is listing-wide.
ALTER TABLE public.rates DROP CONSTRAINT IF EXISTS rates_area_required;
ALTER TABLE public.rates ADD CONSTRAINT rates_area_required
  CHECK (is_default OR area_id IS NOT NULL OR deleted_at IS NOT NULL) NOT VALID;
ALTER TABLE public.rates VALIDATE CONSTRAINT rates_area_required;
ALTER TABLE public.rates DROP CONSTRAINT IF EXISTS rates_deleted_inactive;
ALTER TABLE public.rates ADD CONSTRAINT rates_deleted_inactive
  CHECK (deleted_at IS NULL OR (NOT active AND NOT is_default AND archived_at IS NOT NULL));

-- 4. Whether a rate applies to a vehicle: its own limit (if any) and its area's vehicle
--    types (the default has no area: any vehicle). A NULL vehicle matches only rates with
--    no vehicle limit (as before).
CREATE OR REPLACE FUNCTION public.rate_fits_vehicle(p_area_id uuid, p_rate_vehicle vehicle_type, p_vehicle vehicle_type)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(p_rate_vehicle IS NULL OR p_rate_vehicle = p_vehicle, false)
     AND (p_area_id IS NULL OR p_vehicle IS NULL OR EXISTS (
           SELECT 1 FROM areas a WHERE a.id = p_area_id
              AND area_allows_vehicle(a.vehicle_types, p_vehicle)));
$function$;

-- 5. Deleting an area (any path) soft-deletes its rates first.
CREATE OR REPLACE FUNCTION public.areas_retire_rates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE rates
     SET deleted_at = now(), active = false, archived_at = COALESCE(archived_at, now())
   WHERE area_id = OLD.id AND deleted_at IS NULL;
  RETURN OLD;
END;
$function$;
DROP TRIGGER IF EXISTS areas_retire_rates ON public.areas;
CREATE TRIGGER areas_retire_rates BEFORE DELETE ON public.areas
  FOR EACH ROW EXECUTE FUNCTION areas_retire_rates();

-- 6. Rate in effect: the area's rates first, then the default.
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
          WHEN vehicle_type IS NOT NULL THEN 3
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

-- 7. The rates staff can pick for a session: the default plus the area's rates. The old
--    signatures (no area) are replaced; NULL area = Main.
DROP FUNCTION IF EXISTS public.walk_in_rates(uuid, vehicle_type, timestamp with time zone);
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
       WHEN vehicle_type IS NOT NULL THEN 3
       WHEN days_of_week IS NOT NULL AND cardinality(days_of_week) > 0 THEN 4
       WHEN is_default THEN 5
       ELSE 6
     END,
     priority DESC,
     created_at DESC;
$function$;

DROP FUNCTION IF EXISTS public.walk_in_auto_rate(uuid, vehicle_type, timestamp with time zone);
CREATE OR REPLACE FUNCTION public.walk_in_auto_rate(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_area_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eff uuid := rate_in_effect_at(p_location_id, p_vehicle_type, p_start_at, p_area_id);
  v_any_hourly boolean;
  v_id uuid;
BEGIN
  v_any_hourly := EXISTS (SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at, p_area_id) r
                           WHERE r.rate_type <> 'monthly');
  SELECT r.id INTO v_id FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at, p_area_id) r
   WHERE r.id = v_eff AND (r.rate_type <> 'monthly' OR NOT v_any_hourly);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT r.id INTO v_id FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at, p_area_id) r
   WHERE r.rate_type <> 'monthly' OR NOT v_any_hourly
   LIMIT 1;
  RETURN v_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.walk_in_rate_options(uuid, vehicle_type, timestamp with time zone);
CREATE OR REPLACE FUNCTION public.walk_in_rate_options(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_area_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rates jsonb;
  v_top rates%ROWTYPE;
BEGIN
  IF NOT can_work_location(p_location_id, auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'rate_type', r.rate_type, 'is_default', r.is_default,
           'hourly_amount', r.hourly_amount, 'daily_amount', r.daily_amount,
           'monthly_amount', r.monthly_amount, 'first_hours', r.first_hours,
           'first_amount', r.first_amount, 'succeeding_hourly_amount', r.succeeding_hourly_amount,
           'vehicle_type', r.vehicle_type, 'days_of_week', r.days_of_week)), '[]'::jsonb)
    INTO v_rates
    FROM walk_in_rates(p_location_id, p_vehicle_type, COALESCE(p_start_at, now()), p_area_id) r;
  SELECT * INTO v_top FROM rates
   WHERE id = walk_in_auto_rate(p_location_id, p_vehicle_type, COALESCE(p_start_at, now()), p_area_id);
  RETURN jsonb_build_object(
    'success', true,
    'rates', v_rates,
    'auto', CASE
      WHEN v_top.id IS NULL THEN NULL
      ELSE jsonb_build_object('mode', CASE WHEN v_top.rate_type = 'monthly' THEN 'monthly' ELSE 'rate' END,
                              'rate_id', v_top.id, 'rate_name', v_top.name, 'rate_type', v_top.rate_type)
    END
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.walk_in_input_error(uuid, vehicle_type, text, timestamp with time zone, timestamp with time zone, uuid);
CREATE OR REPLACE FUNCTION public.walk_in_input_error(p_location_id uuid, p_vehicle_type vehicle_type, p_plate text, p_started_at timestamp with time zone, p_end_at timestamp with time zone, p_rate_id uuid, p_area_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_plate IS NULL OR btrim(p_plate) = '' THEN RETURN 'plate_required'; END IF;
  IF p_vehicle_type IS NULL THEN RETURN 'vehicle_required'; END IF;
  IF p_started_at IS NULL THEN RETURN 'start_required'; END IF;
  -- 0049: a future start is a reservation (no 5-minute limit any more).
  IF p_end_at IS NOT NULL AND p_end_at <= p_started_at THEN RETURN 'end_before_start'; END IF;
  IF NOT EXISTS (SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_started_at, p_area_id)) THEN
    RETURN 'no_applicable_rate';
  END IF;
  IF p_rate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_started_at, p_area_id) r WHERE r.id = p_rate_id
  ) THEN
    RETURN 'rate_not_applicable';
  END IF;
  RETURN NULL;
END;
$function$;

DROP FUNCTION IF EXISTS public.session_price(uuid, vehicle_type, timestamp with time zone, timestamp with time zone, uuid);
CREATE OR REPLACE FUNCTION public.session_price(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_rate_id uuid, p_area_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN price_stay(p_location_id, p_vehicle_type, p_start_at, p_end_at, p_rate_id, p_area_id, NULL, false);
END;
$function$;

DROP FUNCTION IF EXISTS public.walk_in_quote(uuid, vehicle_type, timestamp with time zone, timestamp with time zone, uuid);
CREATE OR REPLACE FUNCTION public.walk_in_quote(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_err text;
BEGIN
  IF NOT can_work_location(p_location_id, auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, 'x', p_start_at, p_end_at, p_rate_id, p_area_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  RETURN session_price(p_location_id, p_vehicle_type, p_start_at, p_end_at, p_rate_id, p_area_id)
    || jsonb_build_object('until_now', p_end_at IS NULL AND p_start_at <= now(),
      'reservation', p_start_at > now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.price_stay(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_slot_id uuid DEFAULT NULL::uuid, p_hourly_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  IF COALESCE((SELECT is_free FROM locations WHERE id = p_location_id), false) THEN
    RETURN jsonb_build_object(
      'amount', 0, 'mode', 'free', 'rate_name', 'Free', 'rate_type', 'free',
      'billed_hours', v_billed, 'billed_months', NULL, 'until', v_end,
      'breakdown', jsonb_build_array(jsonb_build_object(
        'rate_name', 'Free', 'rate_type', 'free', 'hours', v_billed, 'months', NULL, 'amount', 0)),
      'segments', '[]'::jsonb);
  END IF;

  IF p_rate_id IS NOT NULL THEN
    SELECT * INTO v_pick FROM rates WHERE id = p_rate_id AND location_id = p_location_id;
    IF v_pick.id IS NULL THEN
      RETURN jsonb_build_object('error', 'rate_not_found', 'until', v_end);
    END IF;
  ELSIF NOT COALESCE(p_hourly_only, false) THEN
    SELECT * INTO v_pick FROM rates
     WHERE id = walk_in_auto_rate(p_location_id, p_vehicle_type, p_start_at, p_area_id) AND rate_type = 'monthly';
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

CREATE OR REPLACE FUNCTION public.start_walk_in(p_location_id uuid, p_vehicle_type vehicle_type, p_plate text, p_note text DEFAULT NULL::text, p_scheduled_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_allow_full boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_start timestamptz := COALESCE(p_started_at, now());
  v_err text;
  v_claim jsonb;
  v_session_id uuid;
  v_folio_id uuid;
  v_operator_id uuid;
  v_conflict jsonb;
  v_area areas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT can_work_location(p_location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, p_plate, v_start, p_scheduled_end_at, p_rate_id,
    COALESCE(p_area_id, main_area_id(p_location_id)));
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  -- 0067: the session's area (Main by default) must be this listing's and take the vehicle.
  SELECT * INTO v_area FROM areas
   WHERE id = COALESCE(p_area_id, main_area_id(p_location_id)) AND location_id = p_location_id;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;
  IF NOT area_allows_vehicle(v_area.vehicle_types, p_vehicle_type) THEN
    RETURN jsonb_build_object('error', 'vehicle_not_allowed', 'area', v_area.name);
  END IF;

  -- 0062: one started, open session per plate per listing (rj; still per listing, not per
  -- area, 0067). Reservations (future start) don't count and aren't blocked.
  IF v_start <= now() THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_location_id::text || ':' || plate_key(p_plate), 0));
    v_conflict := active_plate_conflict(p_location_id, p_plate, NULL);
    IF v_conflict IS NOT NULL THEN
      RETURN v_conflict;
    END IF;
  END IF;

  -- 0083 (rj t184u): a full area (no spaces left, or switched Full) no longer blocks a
  -- session; the staff member must confirm (p_allow_full). Other errors still block.
  v_claim := claim_capacity(p_location_id, NULL, v_start, p_scheduled_end_at, 'session', v_area.id);
  IF v_claim->>'error' = 'no_longer_available' AND v_claim ? 'area_id' THEN
    IF NOT COALESCE(p_allow_full, false) THEN
      RETURN jsonb_build_object('error', 'area_full', 'reason', 'no_spaces', 'area', v_area.name,
        'area_id', v_area.id, 'available', GREATEST(0, COALESCE((v_claim->>'available')::int, 0)));
    END IF;
  ELSIF v_claim->>'error' IS NOT NULL THEN
    RETURN v_claim;
  ELSIF v_start <= now() AND v_area.marked_full AND NOT COALESCE(p_allow_full, false) THEN
    RETURN jsonb_build_object('error', 'area_full', 'reason', 'marked_full', 'area', v_area.name,
      'area_id', v_area.id);
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;

  INSERT INTO parking_sessions (
    location_id, area_id, plate, vehicle_type, note, scheduled_end_at,
    started_at, status, rate_id, rate_snapshot
  ) VALUES (
    p_location_id, v_area.id, upper(btrim(p_plate)), p_vehicle_type, NULLIF(btrim(p_note), ''), p_scheduled_end_at,
    v_start, 'active', p_rate_id,
    session_price(p_location_id, p_vehicle_type, v_start,
      COALESCE(p_scheduled_end_at, v_start + interval '1 hour'), p_rate_id, v_area.id)
  ) RETURNING id INTO v_session_id;

  INSERT INTO folios (operator_id, location_id, session_id, status)
  VALUES (v_operator_id, p_location_id, v_session_id, 'open')
  RETURNING id INTO v_folio_id;

  INSERT INTO availability_events (location_id, area_id, change, actor)
  VALUES (p_location_id, v_area.id, 'walk_in_started', v_uid);

  RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'folio_id', v_folio_id,
    'area_id', v_area.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_walk_in_session(p_session_id uuid, p_started_at timestamp with time zone, p_end_at timestamp with time zone, p_vehicle_type vehicle_type, p_plate text, p_rate_id uuid DEFAULT NULL::uuid, p_area_id uuid DEFAULT NULL::uuid, p_allow_full boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_err text;
  v_conflict jsonb;
  v_area areas%ROWTYPE;
  v_claim jsonb;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  v_err := walk_in_input_error(v_s.location_id, p_vehicle_type, p_plate, p_started_at, p_end_at, p_rate_id,
    COALESCE(p_area_id, v_s.area_id, main_area_id(v_s.location_id)));
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;

  -- 0067: area (NULL keeps the current one). A new area or vehicle must be allowed there;
  -- unchanged area + vehicle are never blocked (an existing session can always be fixed).
  SELECT * INTO v_area FROM areas
   WHERE id = COALESCE(p_area_id, v_s.area_id, main_area_id(v_s.location_id))
     AND location_id = v_s.location_id;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;
  IF (v_area.id IS DISTINCT FROM v_s.area_id OR p_vehicle_type IS DISTINCT FROM v_s.vehicle_type)
     AND NOT area_allows_vehicle(v_area.vehicle_types, p_vehicle_type) THEN
    RETURN jsonb_build_object('error', 'vehicle_not_allowed', 'area', v_area.name);
  END IF;

  -- 0062: the session is (or becomes) started and its plate changes, or a reservation is
  -- moved to start now/earlier: no other started, open session with the same plate here.
  IF p_started_at <= now()
     AND (plate_key(p_plate) <> plate_key(v_s.plate) OR v_s.started_at > now()) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_s.location_id::text || ':' || plate_key(p_plate), 0));
    v_conflict := active_plate_conflict(v_s.location_id, p_plate, p_session_id);
    IF v_conflict IS NOT NULL THEN
      RETURN v_conflict;
    END IF;
  END IF;

  -- Moving a session to another area takes a space there (per-area capacity). 0083: a full
  -- area (no spaces left, or switched Full) needs the staff member's confirmation
  -- (p_allow_full) instead of blocking. Staying in the same area is never checked.
  IF v_area.id IS DISTINCT FROM v_s.area_id THEN
    v_claim := claim_capacity(v_s.location_id, NULL,
      CASE WHEN p_started_at <= now() THEN now() ELSE p_started_at END, p_end_at, 'session', v_area.id);
    IF v_claim->>'error' = 'no_longer_available' AND v_claim ? 'area_id' THEN
      IF NOT COALESCE(p_allow_full, false) THEN
        RETURN jsonb_build_object('error', 'area_full', 'reason', 'no_spaces', 'area', v_area.name,
          'area_id', v_area.id, 'available', GREATEST(0, COALESCE((v_claim->>'available')::int, 0)));
      END IF;
    ELSIF v_claim->>'error' IS NOT NULL THEN
      RETURN v_claim;
    ELSIF p_started_at <= now() AND v_area.marked_full AND NOT COALESCE(p_allow_full, false) THEN
      RETURN jsonb_build_object('error', 'area_full', 'reason', 'marked_full', 'area', v_area.name,
        'area_id', v_area.id);
    END IF;
  END IF;

  UPDATE parking_sessions
     SET started_at = p_started_at,
         scheduled_end_at = p_end_at,
         billed_end_at = p_end_at,
         vehicle_type = p_vehicle_type,
         plate = upper(btrim(p_plate)),
         rate_id = p_rate_id,
         rate_auto = (p_rate_id IS NULL),
         area_id = v_area.id,
         status = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN 'active'::session_status ELSE status END,
         overdue_minutes = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN NULL ELSE overdue_minutes END,
         updated_at = now()
   WHERE id = p_session_id;

  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'edit_session', v_uid, jsonb_build_object(
    'started_at', p_started_at, 'end_at', p_end_at, 'vehicle_type', p_vehicle_type,
    'plate', upper(btrim(p_plate)), 'rate_id', p_rate_id, 'area_id', v_area.id));

  RETURN jsonb_build_object('success', true, 'parking', session_parking_quote(p_session_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.session_details(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_b jsonb;
  v_loc record;
  v_role text;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT l.name, l.operator_id, o.staff_can_waive INTO v_loc
    FROM locations l JOIN operators o ON o.id = l.operator_id WHERE l.id = v_s.location_id;
  SELECT role::text INTO v_role FROM operator_members
   WHERE operator_id = v_loc.operator_id AND profile_id = v_uid LIMIT 1;
  v_b := session_balance_parts(p_session_id);
  RETURN jsonb_build_object(
    'success', true,
    'session', jsonb_build_object(
      'id', v_s.id, 'location_id', v_s.location_id, 'location_name', v_loc.name,
      'plate', v_s.plate, 'vehicle_type', v_s.vehicle_type, 'note', v_s.note,
      'started_at', v_s.started_at, 'end_at', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at),
      'status', v_s.status, 'rate_id', v_s.rate_id, 'driver_id', v_s.driver_id,
      'rate_auto', v_s.rate_auto,
      'set_rate_name', (SELECT r.name FROM rates r WHERE r.id = v_s.rate_id),
      'rate_active', (SELECT r.active FROM rates r WHERE r.id = v_s.rate_id),
      'rate_changed_from', CASE WHEN v_s.rate_changed_from IS NULL THEN NULL ELSE
        (SELECT jsonb_build_object('id', r.id, 'name', r.name) FROM rates r WHERE r.id = v_s.rate_changed_from) END,
      'ended_at', v_s.ended_at, 'cancelled_at', v_s.cancelled_at,
      'approval_status', v_s.approval_status,
      'same_plate_overlap', CASE
        WHEN v_s.approval_status = 'pending' AND v_s.cancelled_at IS NULL AND v_s.started_at > now()
        THEN reservation_same_plate_conflict(
          v_s.location_id, v_s.plate, v_s.started_at, v_s.scheduled_end_at, v_s.id)
        ELSE NULL END,
      'area_id', v_s.area_id,
      'area_name', (SELECT a.name FROM areas a WHERE a.id = v_s.area_id),
      'reservation', v_s.status IN ('active', 'overdue') AND v_s.started_at > now()),
    'price', session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
      COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()),
      CASE WHEN v_s.rate_auto THEN NULL ELSE v_s.rate_id END, v_s.area_id)
      || jsonb_build_object('until_now', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at) IS NULL
        AND v_s.started_at <= now()),
    'parking', v_b->'parking', 'extra_fees', v_b->'extra_fees', 'paid', v_b->'paid',
    'balance', v_b->'balance', 'waived', v_b->'waived',
    'refunded', COALESCE((SELECT SUM(p.amount) FROM payments p
      WHERE p.folio_id = (v_b->>'folio_id')::uuid AND p.direction = 'refund'), 0),
    'refundable', session_refundable(p_session_id),
    'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type,
        'description', c.description, 'amount', c.amount, 'created_at', c.created_at) ORDER BY c.created_at)
      FROM folio_charges c WHERE c.folio_id = (v_b->>'folio_id')::uuid AND c.voided_at IS NULL
        AND c.type IN ('additional_fee', 'adjustment')), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount,
        'direction', p.direction, 'method', p.method, 'note', p.note, 'received_at', p.received_at,
        'recorded_by', COALESCE(pr.display_name, pr.phone, 'Staff')) ORDER BY p.received_at)
      FROM payments p LEFT JOIN profiles pr ON pr.id = p.recorded_by
      WHERE p.folio_id = (v_b->>'folio_id')::uuid), '[]'::jsonb),
    'can_waive', v_role IN ('owner', 'manager') OR (v_role = 'staff' AND COALESCE(v_loc.staff_can_waive, false))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.session_parking_quote(p_session_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_s parking_sessions%ROWTYPE;
  v_q jsonb;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  v_q := session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
    COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()),
    CASE WHEN v_s.rate_auto THEN NULL ELSE v_s.rate_id END, v_s.area_id);
  RETURN COALESCE(NULLIF(v_q->>'amount', '')::numeric, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reservation_check(p_location_id uuid, p_vehicle_type vehicle_type, p_plate text, p_started_at timestamp with time zone, p_end_at timestamp with time zone, p_require_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plate text := upper(btrim(COALESCE(p_plate, '')));
  v_err text;
  v_area uuid;
  v_price jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM locations WHERE id = p_location_id AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF p_require_enabled AND NOT COALESCE(
    (SELECT reservations_enabled FROM location_policies WHERE location_id = p_location_id),
    false
  ) THEN
    RETURN jsonb_build_object('error', 'reservations_disabled');
  END IF;
  IF p_started_at IS NULL OR p_started_at <= now() THEN
    RETURN jsonb_build_object('error', 'start_not_future');
  END IF;
  IF p_end_at IS NULL THEN
    RETURN jsonb_build_object('error', 'end_required');
  END IF;
  v_area := reservation_area_id(p_location_id, p_vehicle_type);
  IF v_area IS NULL THEN
    RETURN jsonb_build_object('error', 'no_area');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, v_plate, p_started_at, p_end_at, NULL, v_area);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  v_price := session_price(p_location_id, p_vehicle_type, p_started_at, p_end_at, NULL, v_area);
  IF v_price ? 'error' THEN
    RETURN jsonb_build_object('error', 'no_applicable_rate');
  END IF;
  RETURN jsonb_build_object(
    'plate', v_plate,
    'area_id', v_area,
    'price', v_price,
    'amount', v_price->'amount'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.parking_sessions_set_rate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rate_id IS DISTINCT FROM OLD.rate_id
     AND NEW.rate_changed_from IS NOT DISTINCT FROM OLD.rate_changed_from THEN
    NEW.rate_changed_from := NULL;
  END IF;
  IF NEW.rate_id IS NULL AND NEW.status IN ('active', 'overdue') AND NEW.started_at IS NOT NULL THEN
    NEW.rate_id := walk_in_auto_rate(NEW.location_id, COALESCE(NEW.vehicle_type, 'car'), NEW.started_at,
      COALESCE(NEW.area_id, main_area_id(NEW.location_id)));
    NEW.rate_auto := true;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.rate_auto := COALESCE(NEW.rate_auto, false);
  ELSIF NEW.rate_id IS DISTINCT FROM OLD.rate_id AND NEW.rate_auto IS NOT DISTINCT FROM OLD.rate_auto THEN
    NEW.rate_auto := false;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rates_reassign_open_ended()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(OLD.active, false) AND NOT COALESCE(NEW.active, false) THEN
    UPDATE parking_sessions s
       SET rate_changed_from = NEW.id,
           rate_auto = true,
           rate_id = COALESCE(
             walk_in_auto_rate(s.location_id, COALESCE(s.vehicle_type, 'car'), s.started_at, s.area_id),
             (SELECT d.id FROM rates d WHERE d.location_id = s.location_id AND d.is_default
                AND d.active AND d.id <> NEW.id LIMIT 1))
     WHERE s.rate_id = NEW.id
       AND s.status IN ('active', 'overdue')
       AND COALESCE(s.billed_end_at, s.scheduled_end_at) IS NULL;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_reservation_area(p_session_id uuid, p_area_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_area areas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.cancelled_at IS NOT NULL OR v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  IF v_s.started_at <= now() THEN
    RETURN jsonb_build_object('error', 'already_started');
  END IF;
  SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = v_s.location_id;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'area_not_found');
  END IF;
  IF NOT area_allows_vehicle(v_area.vehicle_types, v_s.vehicle_type) THEN
    RETURN jsonb_build_object('error', 'vehicle_not_allowed', 'area', v_area.name);
  END IF;
  -- PAD-6: rates are per area. An auto rate is picked again for the new area, and a chosen
  -- rate that doesn't apply there goes back to auto.
  UPDATE parking_sessions
     SET area_id = v_area.id,
         rate_id = CASE
           WHEN rate_auto OR rate_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM walk_in_rates(v_s.location_id, v_s.vehicle_type, v_s.started_at, v_area.id) r
              WHERE r.id = v_s.rate_id) THEN NULL
           ELSE rate_id END,
         updated_at = now()
   WHERE id = p_session_id;
  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'set_reservation_area', v_uid, jsonb_build_object('area_id', v_area.id));
  RETURN jsonb_build_object('success', true, 'area_id', v_area.id, 'area_name', v_area.name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_nearby(p_lat numeric, p_lng numeric, p_radius_m integer DEFAULT 1000, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type, p_monthly_only boolean DEFAULT false, p_hide_full boolean DEFAULT false, p_sort_by text DEFAULT 'distance'::text, p_limit integer DEFAULT 50, p_rate_type rate_type DEFAULT NULL::rate_type, p_free_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, name text, listing_type listing_type, address text, lat numeric, lng numeric, distance_m integer, available_count integer, capacity integer, open_status boolean, tracking_mode tracking_mode, availability_updated_at timestamp with time zone, stale_after_min integer, verification_status verification_status, cover_photo_url text, starting_rate numeric, avg_rating numeric, review_count integer, has_monthly boolean, starting_rate_info jsonb, is_free boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_origin GEOGRAPHY;
BEGIN
  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY;

  RETURN QUERY
  SELECT
    l.id,
    l.name,
    l.listing_type,
    l.address,
    ST_Y(l.geog::GEOMETRY)::NUMERIC AS lat,
    ST_X(l.geog::GEOMETRY)::NUMERIC AS lng,
    ST_Distance(l.geog, v_origin)::INTEGER AS distance_m,
    -- 0067: free spaces over the monitored areas that take the vehicle (NULL = none monitored).
    location_free_spaces(l.id, p_vehicle_type) AS available_count,
    l.capacity,
    -- 0067: open_status = not Full (Full only when every area taking the vehicle is full).
    NOT location_is_full(l.id, p_vehicle_type) AS open_status,
    l.tracking_mode,
    l.availability_updated_at,
    l.stale_after_min,
    l.verification_status,
    (SELECT storage_path FROM location_photos WHERE location_id = l.id AND is_cover = true LIMIT 1) AS cover_photo_url,
    CASE WHEN l.is_free THEN NULL ELSE (
      SELECT r.hourly_amount
      FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND r.deleted_at IS NULL
      AND rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type)
      AND r.rate_type = 'hourly'
      ORDER BY r.is_default DESC
      LIMIT 1
    ) END AS starting_rate,
    lrs.avg_rating,
    lrs.review_count,
    (NOT l.is_free AND EXISTS (
      SELECT 1 FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND r.deleted_at IS NULL
      AND (p_vehicle_type IS NULL OR rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type))
      AND r.rate_type = 'monthly'
    )) AS has_monthly,
    -- PAD-6: rates of any area count, if the area (and the rate) takes the vehicle.
    -- 0061: the rate a result card shows when there is no hourly rate (flat then hourly,
    -- daily or monthly): the default first, then the oldest; NULL when none applies.
    CASE WHEN l.is_free THEN NULL ELSE (
      SELECT jsonb_build_object(
        'rate_type', r.rate_type,
        'hourly_amount', r.hourly_amount,
        'daily_amount', r.daily_amount,
        'monthly_amount', r.monthly_amount,
        'first_hours', r.first_hours,
        'first_amount', r.first_amount,
        'succeeding_hourly_amount', r.succeeding_hourly_amount)
      FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND r.archived_at IS NULL
      AND r.deleted_at IS NULL
      AND rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type)
      ORDER BY r.is_default DESC, r.created_at
      LIMIT 1
    ) END AS starting_rate_info,
    l.is_free
  FROM locations l
  LEFT JOIN location_rating_stats lrs ON lrs.location_id = l.id
  WHERE l.published = true
  AND l.deleted_at IS NULL
  AND ST_DWithin(l.geog, v_origin, p_radius_m)
  AND (NOT p_monthly_only OR EXISTS (
    SELECT 1 FROM rates r
    WHERE r.location_id = l.id
    AND r.active = true
    AND r.deleted_at IS NULL
    AND (p_vehicle_type IS NULL OR rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type))
    AND r.rate_type = 'monthly'
  ))
  AND (NOT COALESCE(p_free_only, false) OR l.is_free)
  AND (COALESCE(p_free_only, false) OR p_rate_type IS NULL OR EXISTS (
    SELECT 1 FROM rates r
    WHERE r.location_id = l.id
    AND r.active = true
    AND r.deleted_at IS NULL
    AND (p_vehicle_type IS NULL OR rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type))
    AND r.rate_type = p_rate_type
  ))
  -- 0067: a vehicle filter only keeps listings with an area that takes it.
  AND (p_vehicle_type IS NULL OR EXISTS (
    SELECT 1 FROM areas a WHERE a.location_id = l.id
    AND area_allows_vehicle(a.vehicle_types, p_vehicle_type)))
  AND (NOT p_hide_full OR NOT location_is_full(l.id, p_vehicle_type))
  ORDER BY
    CASE p_sort_by
      WHEN 'price' THEN CASE WHEN l.is_free THEN 0 ELSE (
        SELECT r.hourly_amount
        FROM rates r
        WHERE r.location_id = l.id
        AND r.active = true
        AND r.deleted_at IS NULL
        AND rate_fits_vehicle(r.area_id, r.vehicle_type, p_vehicle_type)
        AND r.rate_type = 'hourly'
        ORDER BY r.is_default DESC
        LIMIT 1
      ) END
      WHEN 'availability' THEN CASE WHEN location_is_full(l.id, p_vehicle_type) THEN 1000000000
        ELSE -COALESCE(location_free_spaces(l.id, p_vehicle_type), 0) END
      WHEN 'rating' THEN -lrs.avg_rating
      ELSE ST_Distance(l.geog, v_origin)
    END
  LIMIT p_limit;
END;
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
    SELECT * INTO v_area FROM areas WHERE id = p_area_id AND location_id = p_location_id;
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

CREATE OR REPLACE FUNCTION public.unarchive_rate(p_rate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rate record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  SELECT r.*, l.operator_id INTO v_rate
    FROM rates r JOIN locations l ON l.id = r.location_id
   WHERE r.id = p_rate_id
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_rate.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_rate.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'rate_deleted');
  END IF;
  IF v_rate.archived_at IS NULL THEN
    RETURN jsonb_build_object('success', true, 'archived', false);
  END IF;
  UPDATE rates SET archived_at = NULL, active = false WHERE id = p_rate_id;
  RETURN jsonb_build_object('success', true, 'archived', false, 'active', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_area(p_area_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_area areas%ROWTYPE;
  v_operator_id UUID;
BEGIN
  SELECT * INTO v_area FROM areas WHERE id = p_area_id FOR UPDATE;
  IF v_area.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  SELECT operator_id INTO v_operator_id FROM locations WHERE id = v_area.location_id;
  IF v_uid IS NULL OR NOT is_operator_admin(v_uid, v_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_area.is_main THEN
    RETURN jsonb_build_object('error', 'main_area_locked');
  END IF;
  -- PAD-6: not while the area has reservations (future or awaiting approval).
  IF EXISTS (SELECT 1 FROM parking_sessions WHERE area_id = p_area_id AND status IN ('active', 'overdue')
              AND cancelled_at IS NULL
              AND (started_at > now() OR approval_status = 'pending'))
     OR EXISTS (SELECT 1 FROM reservations WHERE area_id = p_area_id
              AND status IN ('awaiting_payment', 'pending_approval', 'confirmed', 'active')) THEN
    RETURN jsonb_build_object('error', 'area_has_reservations');
  END IF;
  IF EXISTS (SELECT 1 FROM parking_sessions WHERE area_id = p_area_id AND status IN ('active', 'overdue')) THEN
    RETURN jsonb_build_object('error', 'area_has_sessions');
  END IF;
  -- Ended sessions keep their history under Main.
  UPDATE parking_sessions SET area_id = main_area_id(v_area.location_id) WHERE area_id = p_area_id;
  -- PAD-6: its rates are soft-deleted (areas_retire_rates) and stop showing and pricing.
  DELETE FROM areas WHERE id = p_area_id;
  INSERT INTO availability_events (location_id, change, actor)
  VALUES (v_area.location_id, 'area_deleted:' || v_area.name, v_uid);
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Internal helpers stay internal (as their old signatures were).
REVOKE ALL ON FUNCTION public.rate_fits_vehicle(uuid, vehicle_type, vehicle_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.areas_retire_rates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.walk_in_rates(uuid, vehicle_type, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.walk_in_auto_rate(uuid, vehicle_type, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.walk_in_input_error(uuid, vehicle_type, text, timestamp with time zone, timestamp with time zone, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.session_price(uuid, vehicle_type, timestamp with time zone, timestamp with time zone, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.walk_in_rate_options(uuid, vehicle_type, timestamp with time zone, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walk_in_rate_options(uuid, vehicle_type, timestamp with time zone, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.walk_in_quote(uuid, vehicle_type, timestamp with time zone, timestamp with time zone, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walk_in_quote(uuid, vehicle_type, timestamp with time zone, timestamp with time zone, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
