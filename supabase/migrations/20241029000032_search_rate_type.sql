-- Search filter by rate type: p_rate_type (NULL = all) keeps only listings with
-- an active rate of that type. p_monthly_only stays for older app builds.

DROP FUNCTION IF EXISTS search_nearby(NUMERIC, NUMERIC, INTEGER, vehicle_type, BOOLEAN, BOOLEAN, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION search_nearby(
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_radius_m INTEGER DEFAULT 1000,
  p_vehicle_type vehicle_type DEFAULT NULL,
  p_monthly_only BOOLEAN DEFAULT FALSE,
  p_hide_full BOOLEAN DEFAULT FALSE,
  p_sort_by TEXT DEFAULT 'distance',
  p_limit INTEGER DEFAULT 50,
  p_rate_type rate_type DEFAULT NULL
)
RETURNS TABLE(
  id UUID, name TEXT, listing_type listing_type, address TEXT, lat NUMERIC, lng NUMERIC,
  distance_m INTEGER, available_count INTEGER, capacity INTEGER, open_status BOOLEAN,
  tracking_mode tracking_mode, availability_updated_at TIMESTAMPTZ, stale_after_min INTEGER,
  verification_status verification_status, cover_photo_url TEXT, starting_rate NUMERIC,
  avg_rating NUMERIC, review_count INTEGER, has_monthly BOOLEAN
)
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
    ) AS has_monthly
  FROM locations l
  LEFT JOIN location_rating_stats lrs ON lrs.location_id = l.id
  WHERE l.published = true
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
