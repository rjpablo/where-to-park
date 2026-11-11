-- A listing can be free parking. Rates are not required, and search can show only those listings.

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_listing_free(p_location_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_operator uuid;
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
  UPDATE locations SET is_free = COALESCE(p_enabled, false) WHERE id = p_location_id;
  RETURN jsonb_build_object('success', true, 'is_free', COALESCE(p_enabled, false));
END;
$$;

REVOKE ALL ON FUNCTION public.set_listing_free(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_listing_free(uuid, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.create_location(text, text, numeric, numeric, integer, numeric, listing_type, text, uuid, text);

CREATE OR REPLACE FUNCTION public.create_location(
  p_name TEXT,
  p_address TEXT,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_capacity INTEGER,
  p_hourly_amount NUMERIC,
  p_listing_type listing_type DEFAULT 'commercial',
  p_rules TEXT DEFAULT NULL,
  p_operator_id UUID DEFAULT NULL,
  p_operator_name TEXT DEFAULT NULL,
  p_is_free BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_operator_id UUID;
  v_location_id UUID;
  v_rate_id UUID;
  v_free boolean := COALESCE(p_is_free, false);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' OR p_address IS NULL OR btrim(p_address) = '' THEN
    RETURN jsonb_build_object('error', 'name_and_address_required');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('error', 'pin_required');
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RETURN jsonb_build_object('error', 'capacity_required');
  END IF;
  IF NOT v_free AND (p_hourly_amount IS NULL OR p_hourly_amount < 0) THEN
    RETURN jsonb_build_object('error', 'rate_required');
  END IF;

  v_operator_id := p_operator_id;
  IF v_operator_id IS NOT NULL THEN
    IF NOT is_operator_admin(v_uid, v_operator_id) THEN
      RETURN jsonb_build_object('error', 'Permission denied');
    END IF;
  ELSE
    SELECT om.operator_id
      INTO v_operator_id
      FROM operator_members om
     WHERE om.profile_id = v_uid
       AND om.role IN ('owner', 'manager')
     ORDER BY om.created_at
     LIMIT 1;

    IF v_operator_id IS NULL THEN
      INSERT INTO operators (display_name, status)
      VALUES (COALESCE(NULLIF(btrim(p_operator_name), ''), btrim(p_name)), 'active')
      RETURNING id INTO v_operator_id;

      INSERT INTO operator_members (operator_id, profile_id, role)
      VALUES (v_operator_id, v_uid, 'owner');
    END IF;
  END IF;

  INSERT INTO locations (
    operator_id, name, listing_type, geog, address, rules,
    tracking_mode, capacity, available_count, published, verification_status, is_free
  ) VALUES (
    v_operator_id,
    btrim(p_name),
    COALESCE(p_listing_type, 'commercial'),
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY,
    btrim(p_address),
    NULLIF(btrim(COALESCE(p_rules, '')), ''),
    'count',
    p_capacity,
    p_capacity,
    true,
    'unverified',
    v_free
  ) RETURNING id INTO v_location_id;

  IF NOT v_free THEN
    INSERT INTO rates (location_id, is_default, name, rate_type, hourly_amount, active)
    VALUES (v_location_id, true, 'Standard Rate', 'hourly', p_hourly_amount, true)
    RETURNING id INTO v_rate_id;
  END IF;

  INSERT INTO location_policies (location_id) VALUES (v_location_id);

  INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id)
  SELECT id, 'verification_needed', 'New listing pending verification', btrim(p_name), 'location', v_location_id
  FROM profiles
  WHERE is_admin = true;

  RETURN jsonb_build_object(
    'success', true,
    'location_id', v_location_id,
    'operator_id', v_operator_id,
    'rate_id', v_rate_id,
    'is_free', v_free
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_location(text, text, numeric, numeric, integer, numeric, listing_type, text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_location(text, text, numeric, numeric, integer, numeric, listing_type, text, uuid, text, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.search_nearby(numeric, numeric, integer, vehicle_type, boolean, boolean, text, integer, rate_type);

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
      AND (r.vehicle_type IS NULL OR r.vehicle_type = p_vehicle_type)
      AND r.rate_type = 'hourly'
      ORDER BY r.is_default DESC
      LIMIT 1
    ) END AS starting_rate,
    lrs.avg_rating,
    lrs.review_count,
    (NOT l.is_free AND EXISTS (
      SELECT 1 FROM rates
      WHERE location_id = l.id
      AND active = true
      AND rate_type = 'monthly'
    )) AS has_monthly,
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
      AND (r.vehicle_type IS NULL OR r.vehicle_type = p_vehicle_type)
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
    SELECT 1 FROM rates
    WHERE location_id = l.id
    AND active = true
    AND rate_type = 'monthly'
  ))
  AND (NOT COALESCE(p_free_only, false) OR l.is_free)
  AND (COALESCE(p_free_only, false) OR p_rate_type IS NULL OR EXISTS (
    SELECT 1 FROM rates
    WHERE location_id = l.id
    AND active = true
    AND rate_type = p_rate_type
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

GRANT EXECUTE ON FUNCTION public.search_nearby(numeric, numeric, integer, vehicle_type, boolean, boolean, text, integer, rate_type, boolean)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
