-- Result cards showed 'See rates' for listings without an hourly rate (bug fix, rj t125u):
-- search_nearby also returns starting_rate_info, the rate the card shows when there is
-- no hourly rate (flat then hourly, daily, monthly). Same body as 0032/0033 otherwise.
-- Changing RETURNS TABLE needs DROP + CREATE.

DROP FUNCTION IF EXISTS search_nearby(NUMERIC, NUMERIC, INTEGER, vehicle_type, BOOLEAN, BOOLEAN, TEXT, INTEGER, rate_type);
CREATE OR REPLACE FUNCTION public.search_nearby(p_lat numeric, p_lng numeric, p_radius_m integer DEFAULT 1000, p_vehicle_type vehicle_type DEFAULT NULL::vehicle_type, p_monthly_only boolean DEFAULT false, p_hide_full boolean DEFAULT false, p_sort_by text DEFAULT 'distance'::text, p_limit integer DEFAULT 50, p_rate_type rate_type DEFAULT NULL::rate_type)
 RETURNS TABLE(id uuid, name text, listing_type listing_type, address text, lat numeric, lng numeric, distance_m integer, available_count integer, capacity integer, open_status boolean, tracking_mode tracking_mode, availability_updated_at timestamp with time zone, stale_after_min integer, verification_status verification_status, cover_photo_url text, starting_rate numeric, avg_rating numeric, review_count integer, has_monthly boolean, starting_rate_info jsonb)
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
    l.available_count,
    l.capacity,
    l.open_status,
    l.tracking_mode,
    l.availability_updated_at,
    l.stale_after_min,
    l.verification_status,
    (SELECT storage_path FROM location_photos WHERE location_id = l.id AND is_cover = true LIMIT 1) AS cover_photo_url,
    (
      SELECT r.hourly_amount
      FROM rates r
      WHERE r.location_id = l.id
      AND r.active = true
      AND (r.vehicle_type IS NULL OR r.vehicle_type = p_vehicle_type)
      AND r.rate_type = 'hourly'
      ORDER BY r.is_default DESC
      LIMIT 1
    ) AS starting_rate,
    lrs.avg_rating,
    lrs.review_count,
    EXISTS (
      SELECT 1 FROM rates
      WHERE location_id = l.id
      AND active = true
      AND rate_type = 'monthly'
    ) AS has_monthly,
    -- 0061: the rate a result card shows when there is no hourly rate (flat then hourly,
    -- daily or monthly): the default first, then the oldest; NULL when none applies.
    (
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
    ) AS starting_rate_info
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
  AND (p_rate_type IS NULL OR EXISTS (
    SELECT 1 FROM rates
    WHERE location_id = l.id
    AND active = true
    AND rate_type = p_rate_type
  ))
  AND (NOT p_hide_full OR (
    (l.tracking_mode = 'count' AND l.available_count > 0) OR
    (l.tracking_mode = 'open_full' AND l.open_status = true)
  ))
  ORDER BY
    CASE p_sort_by
      WHEN 'price' THEN (
        SELECT r.hourly_amount
        FROM rates r
        WHERE r.location_id = l.id
        AND r.active = true
        ORDER BY r.is_default DESC
        LIMIT 1
      )
      WHEN 'availability' THEN -l.available_count
      WHEN 'rating' THEN -lrs.avg_rating
      ELSE ST_Distance(l.geog, v_origin)
    END
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION search_nearby(NUMERIC, NUMERIC, INTEGER, vehicle_type, BOOLEAN, BOOLEAN, TEXT, INTEGER, rate_type)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
