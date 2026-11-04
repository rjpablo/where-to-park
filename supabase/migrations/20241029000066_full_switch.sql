-- 🟧 Full switch replaces the Open/Full mode (rj t137u).
-- * Every listing counts free spaces from sessions: Open/Full listings move to count mode;
--   any that were Full get the new Full flag. Open/Full can no longer be chosen.
-- * locations.marked_full: 'Full' regardless of the count. location_free_spaces() (the one
--   source for search, pins, hide-full, Location details, listing page) returns 0 while it
--   is on. location_counted_spaces() is the real count (capacity - started open sessions -
--   Reserved - Unavailable) for the operator screens and the check-in capacity check.
-- * set_listing_full(): operators and the listing's staff only; logged in availability_events.

ALTER TABLE locations ADD COLUMN IF NOT EXISTS marked_full boolean NOT NULL DEFAULT false;

-- Migrate Open/Full listings (staging: Test List, Open -> count, Full off).
WITH moved AS (
  UPDATE locations SET marked_full = (open_status IS FALSE), tracking_mode = 'count',
         availability_updated_at = now()
   WHERE tracking_mode = 'open_full'
  RETURNING id, marked_full
)
INSERT INTO availability_events (location_id, change, actor)
SELECT id, 'tracking_mode=count (Open/Full removed, 0066)'
           || CASE WHEN marked_full THEN ',marked_full' ELSE '' END, NULL
  FROM moved;

CREATE OR REPLACE FUNCTION public.location_counted_spaces(p_location_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    l.capacity
    - (SELECT COUNT(*) FROM parking_sessions s
        WHERE s.location_id = l.id AND s.status IN ('active', 'overdue') AND s.started_at <= now())::int
    - COALESCE(l.manual_reserved_count, 0)
    - COALESCE(l.unavailable_count, 0))
  FROM locations l WHERE l.id = p_location_id;
$$;
GRANT EXECUTE ON FUNCTION public.location_counted_spaces(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.location_free_spaces(p_location_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN l.marked_full THEN 0 ELSE location_counted_spaces(l.id) END
  FROM locations l WHERE l.id = p_location_id;
$$;

CREATE OR REPLACE FUNCTION public.counted_spaces(l public.locations)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT location_counted_spaces(l.id); $$;
GRANT EXECUTE ON FUNCTION public.counted_spaces(public.locations) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_listing_full(p_location_id uuid, p_full boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_loc locations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_loc FROM locations WHERE id = p_location_id AND deleted_at IS NULL FOR UPDATE;
  IF v_loc.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(p_location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_loc.marked_full IS DISTINCT FROM COALESCE(p_full, false) THEN
    UPDATE locations SET marked_full = COALESCE(p_full, false), availability_updated_at = now()
     WHERE id = p_location_id;
    UPDATE locations SET available_count = location_free_spaces(id) WHERE id = p_location_id;
    INSERT INTO availability_events (location_id, change, actor)
    VALUES (p_location_id, CASE WHEN p_full THEN 'marked_full' ELSE 'unmarked_full' END, v_uid);
  END IF;
  RETURN jsonb_build_object('success', true, 'marked_full', COALESCE(p_full, false),
    'free_spaces', location_free_spaces(p_location_id),
    'counted_spaces', location_counted_spaces(p_location_id));
END;
$$;
REVOKE ALL ON FUNCTION public.set_listing_full(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_listing_full(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_capacity(p_location_id uuid, p_slot_id uuid DEFAULT NULL::uuid, p_start_at timestamp with time zone DEFAULT now(), p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_kind text DEFAULT 'session'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_location RECORD;
  v_slot RECORD;
  v_overlapping INTEGER;
  v_available INTEGER;
BEGIN
  SELECT * INTO v_location FROM locations WHERE id = p_location_id FOR UPDATE;
  -- 🟪 1.0.8: deleted listings take no new sessions or reservations. The row lock
  -- above is the same one delete_location takes, so the two can't race.
  IF v_location IS NULL OR v_location.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Location not found');
  END IF;

  IF v_location.tracking_mode = 'open_full' THEN
    IF v_location.open_status IS TRUE THEN
      RETURN jsonb_build_object('success', true, 'open_status', true);
    END IF;
    RETURN jsonb_build_object('error', 'no_longer_available');
  END IF;

  IF v_location.tracking_mode = 'count' AND p_start_at <= now() THEN
    -- 0064: a walk-in starting now (or backdated) takes a space only if one is free right
    -- now, from the one source. Future reservations don't hold a space before their start
    -- (bug fix: they used to block walk-ins), and the legacy reservations table is not used.
    -- 0066: the Full switch doesn't block staff check-ins (a manual override, the app
    -- warns); the real space count still does.
    v_available := location_counted_spaces(p_location_id);
    IF v_available < 1 THEN
      RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available);
    END IF;
    RETURN jsonb_build_object('success', true, 'available', v_available,
      'marked_full', COALESCE(v_location.marked_full, false));
  END IF;

  IF v_location.tracking_mode = 'count' THEN
    -- A future reservation: spaces held over its stay by sessions (started or reserved).
    SELECT COUNT(*) INTO v_overlapping
    FROM (
      SELECT 1 FROM parking_sessions
      WHERE location_id = p_location_id
      AND status IN ('active', 'overdue')
      AND (p_end_at IS NULL OR started_at < p_end_at)
      AND (ended_at IS NULL OR ended_at > p_start_at)
    ) AS sub;

    v_available := v_location.capacity - v_overlapping - v_location.manual_reserved_count - v_location.unavailable_count;
    IF v_available < 1 THEN
      RETURN jsonb_build_object('error', 'no_longer_available', 'available', v_available);
    END IF;
    RETURN jsonb_build_object('success', true, 'available', v_available);
  END IF;

  IF v_location.tracking_mode = 'slots' AND p_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot FROM slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot IS NULL OR v_slot.state != 'available' THEN
      RETURN jsonb_build_object('error', 'no_longer_available');
    END IF;
    SELECT COUNT(*) INTO v_overlapping
    FROM (
      SELECT 1 FROM reservations
      WHERE slot_id = p_slot_id
      AND status IN ('awaiting_payment', 'pending_approval', 'confirmed')
      AND (p_end_at IS NULL OR start_at < p_end_at)
      AND (end_at > p_start_at OR end_at IS NULL)
      UNION ALL
      SELECT 1 FROM parking_sessions
      WHERE slot_id = p_slot_id
      AND status IN ('active', 'overdue')
      AND (p_end_at IS NULL OR started_at < p_end_at)
      AND (ended_at IS NULL OR ended_at > p_start_at)
    ) AS sub;
    IF v_overlapping > 0 THEN
      RETURN jsonb_build_object('error', 'no_longer_available');
    END IF;
    RETURN jsonb_build_object('success', true, 'slot_id', p_slot_id);
  END IF;

  RETURN jsonb_build_object('error', 'Invalid tracking mode or missing spot');
END;
$function$;

-- Open/Full can no longer be chosen; count is the only mode for listings.
CREATE OR REPLACE FUNCTION public.set_tracking_mode(p_location_id uuid, p_mode tracking_mode)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT can_work_location(p_location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF p_mode <> 'count' THEN
    RETURN jsonb_build_object('error', 'mode_removed');
  END IF;
  UPDATE locations SET tracking_mode = 'count', available_count = location_free_spaces(id),
         availability_updated_at = NOW()
   WHERE id = p_location_id;
  RETURN jsonb_build_object('success', true, 'tracking_mode', 'count');
END;
$$;

-- The Open/Full toggle RPC put a listing back into Open/Full mode: dropped.
DROP FUNCTION IF EXISTS public.set_open_status(uuid, boolean);

UPDATE locations SET available_count = location_free_spaces(id) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
