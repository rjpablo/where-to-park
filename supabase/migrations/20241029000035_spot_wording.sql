-- 🟧 User-facing wording: 'slot' is now 'spot' everywhere users can see it.
-- The only server-side user-facing string with the word is claim_capacity's error message
-- (shown on check-in). Column, type, enum and error-code names (slots, slot_id,
-- tracking_mode 'slots', 'slots_phase_2') are unchanged. Hosted definition with the one
-- message changed.

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

  IF v_location.tracking_mode = 'count' THEN
    SELECT COUNT(*) INTO v_overlapping
    FROM (
      SELECT 1 FROM reservations
      WHERE location_id = p_location_id
      AND status IN ('awaiting_payment', 'pending_approval', 'confirmed')
      AND (p_end_at IS NULL OR start_at < p_end_at)
      AND (end_at > p_start_at OR end_at IS NULL)
      UNION ALL
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
