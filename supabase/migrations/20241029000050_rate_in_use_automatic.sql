-- 0050: any open session that uses a rate blocks deactivating it (rj, pt100u).
-- A session "uses" rate R when it is open (active/overdue, started or upcoming),
-- at R's listing, and either
--   (a) R is its chosen rate (rate_id = R), or
--   (b) it is on Automatic (rate_id IS NULL) and R could price some part of it:
--       * vehicle: R is for all vehicles or the session's vehicle;
--       * area/spot: R has no spot or the session's spot, and no area or the
--         area of the session's spot;
--       * dates: R's effective window overlaps the session's span, where the span
--         is start -> billed/planned end, or start -> forever when there's no end;
--       * days: R has no days, or the span (clipped to R's dates) touches a
--         Philippine calendar day whose weekday is in R's days (a span of 7+ days
--         or open-ended always does).
--   Monthly rates count too (Automatic picks one when only monthly rates apply).
-- Same rules as rate_in_effect_at / walk_in_rates, applied over the span.

CREATE OR REPLACE FUNCTION public.rate_open_session_count(p_rate_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH r AS (SELECT * FROM rates WHERE id = p_rate_id),
  s AS (
    SELECT ps.*, sl.area_id AS slot_area_id,
           COALESCE(ps.billed_end_at, ps.scheduled_end_at) AS span_end
      FROM parking_sessions ps
      JOIN r ON r.location_id = ps.location_id
      LEFT JOIN slots sl ON sl.id = ps.slot_id
     WHERE ps.status IN ('active', 'overdue')
  )
  SELECT count(*)::int
    FROM s, r
   WHERE s.rate_id = r.id
      OR (s.rate_id IS NULL
          AND (r.vehicle_type IS NULL OR r.vehicle_type = s.vehicle_type)
          AND (r.slot_id IS NULL OR r.slot_id = s.slot_id)
          AND (r.area_id IS NULL OR r.area_id = s.slot_area_id)
          AND (r.effective_from IS NULL OR s.span_end IS NULL OR r.effective_from <= s.span_end)
          AND (r.effective_to IS NULL OR r.effective_to >= s.started_at)
          AND (
            r.days_of_week IS NULL OR cardinality(r.days_of_week) = 0
            OR EXISTS (
              SELECT 1
                FROM generate_series(
                       (GREATEST(s.started_at, COALESCE(r.effective_from, s.started_at)) AT TIME ZONE 'Asia/Manila')::date,
                       (LEAST(COALESCE(s.span_end, s.started_at + interval '7 days'),
                              COALESCE(r.effective_to, 'infinity'::timestamptz),
                              s.started_at + interval '7 days') AT TIME ZONE 'Asia/Manila')::date,
                       interval '1 day') AS d
               WHERE EXTRACT(DOW FROM d)::int = ANY (r.days_of_week))));
$$;
REVOKE ALL ON FUNCTION public.rate_open_session_count(uuid) FROM PUBLIC, anon, authenticated;
