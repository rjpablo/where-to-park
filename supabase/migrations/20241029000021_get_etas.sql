-- Drive-time ETAs: cache first, then straight-line fallback (ORS is optional).

CREATE OR REPLACE FUNCTION haversine_m(p_lat1 NUMERIC, p_lng1 NUMERIC, p_lat2 NUMERIC, p_lng2 NUMERIC)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(
    6371000 * 2 * atan2(
      sqrt(a),
      sqrt(1 - a)
    )
  )::INTEGER
  FROM (
    SELECT
      sin(radians(p_lat2 - p_lat1) / 2) ^ 2
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * sin(radians(p_lng2 - p_lng1) / 2) ^ 2 AS a
  ) q;
$$;

CREATE OR REPLACE FUNCTION get_etas(
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_location_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cell TEXT;
  v_etas JSONB := '[]'::JSONB;
  r RECORD;
  v_duration INTEGER;
  v_distance INTEGER;
  v_source TEXT;
BEGIN
  v_cell := round(p_lat * 200) / 200 || ',' || round(p_lng * 200) / 200;
  FOR r IN
    SELECT l.id,
           ST_Y(l.geog::geometry) AS lat,
           ST_X(l.geog::geometry) AS lng
    FROM locations l
    WHERE l.published = true
      AND (p_location_ids IS NULL OR l.id = ANY (p_location_ids))
  LOOP
    SELECT duration_s, distance_m, source
      INTO v_duration, v_distance, v_source
    FROM eta_cache
    WHERE origin_cell = v_cell
      AND location_id = r.id
      AND fetched_at > NOW() - INTERVAL '10 minutes';

    IF v_duration IS NULL THEN
      v_distance := haversine_m(p_lat, p_lng, r.lat::NUMERIC, r.lng::NUMERIC);
      -- 30 km/h Baguio estimate
      v_duration := GREATEST(60, ROUND((v_distance / 30000.0) * 3600));
      v_source := 'estimate';
      INSERT INTO eta_cache (origin_cell, location_id, duration_s, distance_m, source, fetched_at)
      VALUES (v_cell, r.id, v_duration, v_distance, v_source, NOW())
      ON CONFLICT (origin_cell, location_id) DO UPDATE
        SET duration_s = EXCLUDED.duration_s,
            distance_m = EXCLUDED.distance_m,
            source = EXCLUDED.source,
            fetched_at = EXCLUDED.fetched_at;
    END IF;

    v_etas := v_etas || jsonb_build_array(jsonb_build_object(
      'location_id', r.id,
      'duration_s', v_duration,
      'distance_m', v_distance,
      'source', v_source
    ));
    v_duration := NULL;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'etas', v_etas);
END;
$$;

GRANT EXECUTE ON FUNCTION get_etas(NUMERIC, NUMERIC, UUID[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION haversine_m(NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
