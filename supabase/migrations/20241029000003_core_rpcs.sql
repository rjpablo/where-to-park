-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id AND is_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is operator member
CREATE OR REPLACE FUNCTION is_operator_member(user_id UUID, op_id UUID, min_role TEXT DEFAULT 'staff')
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM operator_members
    WHERE profile_id = user_id
    AND operator_id = op_id
    AND (
      (min_role = 'staff') OR
      (min_role = 'manager' AND role IN ('manager', 'owner')) OR
      (min_role = 'owner' AND role = 'owner')
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Quote price function
CREATE OR REPLACE FUNCTION quote_price(
  p_location_id UUID,
  p_vehicle_type vehicle_type,
  p_start_at TIMESTAMPTZ,
  p_hours NUMERIC DEFAULT NULL,
  p_area_id UUID DEFAULT NULL,
  p_slot_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_rate RECORD;
  v_amount NUMERIC;
  v_billed_hours INTEGER;
BEGIN
  -- Find the best matching rate with correct precedence:
  -- 1. Dated custom rates (effective_from/to) with priority
  -- 2. Slot-specific rates
  -- 3. Area-specific rates
  -- 4. Vehicle-type specific rates
  -- 5. Default rate
  SELECT * INTO v_rate
  FROM rates
  WHERE location_id = p_location_id
  AND active = true
  AND rate_type != 'monthly'
  AND (vehicle_type IS NULL OR vehicle_type = p_vehicle_type)
  AND (area_id IS NULL OR area_id = p_area_id)
  AND (slot_id IS NULL OR slot_id = p_slot_id)
  AND (effective_from IS NULL OR effective_from <= p_start_at)
  AND (effective_to IS NULL OR effective_to >= p_start_at)
  ORDER BY
    -- Dated rates with priority come first
    CASE WHEN effective_from IS NOT NULL THEN 1 ELSE 2 END,
    -- Then by specificity: slot > area > vehicle > location
    CASE 
      WHEN slot_id IS NOT NULL THEN 1 
      WHEN area_id IS NOT NULL THEN 2 
      WHEN vehicle_type IS NOT NULL THEN 3
      WHEN is_default THEN 4
      ELSE 5 
    END,
    priority DESC,
    created_at DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    -- Fallback to default rate
    SELECT * INTO v_rate
    FROM rates
    WHERE location_id = p_location_id
    AND is_default = true
    LIMIT 1;
  END IF;

  IF v_rate IS NULL THEN
    RETURN jsonb_build_object('error', 'No rate found');
  END IF;

  v_billed_hours := GREATEST(1, CEIL(COALESCE(p_hours, 1)));

  -- Calculate amount based on rate type
  CASE v_rate.rate_type
    WHEN 'hourly' THEN
      v_amount := v_rate.hourly_amount * v_billed_hours;
    WHEN 'daily' THEN
      v_amount := v_rate.daily_amount * CEIL(v_billed_hours / 24.0);
    WHEN 'flat_then_hourly' THEN
      IF v_billed_hours <= v_rate.first_hours THEN
        v_amount := v_rate.first_amount;
      ELSE
        v_amount := v_rate.first_amount + (v_rate.succeeding_hourly_amount * (v_billed_hours - v_rate.first_hours));
      END IF;
    ELSE
      v_amount := 0;
  END CASE;

  -- Apply max per day if set
  IF v_rate.max_per_day IS NOT NULL THEN
    v_amount := LEAST(v_amount, v_rate.max_per_day * CEIL(v_billed_hours / 24.0));
  END IF;

  RETURN jsonb_build_object(
    'amount', v_amount,
    'rate_id', v_rate.id,
    'rate_name', v_rate.name,
    'rate_type', v_rate.rate_type,
    'billed_hours', v_billed_hours
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Claim capacity function (critical for concurrency)
CREATE OR REPLACE FUNCTION claim_capacity(
  p_location_id UUID,
  p_slot_id UUID DEFAULT NULL,
  p_start_at TIMESTAMPTZ DEFAULT NOW(),
  p_end_at TIMESTAMPTZ DEFAULT NULL,
  p_kind TEXT DEFAULT 'session'
)
RETURNS JSONB AS $$
DECLARE
  v_location RECORD;
  v_slot RECORD;
  v_overlapping INTEGER;
  v_available INTEGER;
BEGIN
  -- Lock the location row
  SELECT * INTO v_location
  FROM locations
  WHERE id = p_location_id
  FOR UPDATE;

  IF v_location IS NULL THEN
    RETURN jsonb_build_object('error', 'Location not found');
  END IF;

  -- For count mode
  IF v_location.tracking_mode = 'count' THEN
    -- Count overlapping holds/sessions
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

  -- For slots mode
  IF v_location.tracking_mode = 'slots' AND p_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot
    FROM slots
    WHERE id = p_slot_id
    FOR UPDATE;

    IF v_slot IS NULL OR v_slot.state != 'available' THEN
      RETURN jsonb_build_object('error', 'no_longer_available');
    END IF;

    -- Check for overlapping reservations/sessions
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

  RETURN jsonb_build_object('error', 'Invalid tracking mode or missing slot');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Release capacity function
CREATE OR REPLACE FUNCTION release_capacity(
  p_location_id UUID,
  p_slot_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
  -- This is called when a session ends or reservation is cancelled
  -- The actual capacity is computed dynamically in claim_capacity
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Search nearby function
CREATE OR REPLACE FUNCTION search_nearby(
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_radius_m INTEGER DEFAULT 1000,
  p_vehicle_type vehicle_type DEFAULT NULL,
  p_monthly_only BOOLEAN DEFAULT FALSE,
  p_hide_full BOOLEAN DEFAULT FALSE,
  p_sort_by TEXT DEFAULT 'distance',
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  listing_type listing_type,
  address TEXT,
  lat NUMERIC,
  lng NUMERIC,
  distance_m INTEGER,
  available_count INTEGER,
  capacity INTEGER,
  open_status BOOLEAN,
  tracking_mode tracking_mode,
  availability_updated_at TIMESTAMPTZ,
  stale_after_min INTEGER,
  verification_status verification_status,
  cover_photo_url TEXT,
  starting_rate NUMERIC,
  avg_rating NUMERIC,
  review_count INTEGER,
  has_monthly BOOLEAN
) AS $$
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
    ST_Y(l.geog::GEOMETRY) AS lat,
    ST_X(l.geog::GEOMETRY) AS lng,
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Start walk-in session
CREATE OR REPLACE FUNCTION start_walk_in(
  p_location_id UUID,
  p_vehicle_type vehicle_type,
  p_plate TEXT,
  p_note TEXT DEFAULT NULL,
  p_scheduled_end_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_claim_result JSONB;
  v_session_id UUID;
  v_folio_id UUID;
  v_rate JSONB;
  v_operator_id UUID;
BEGIN
  -- Check capacity
  v_claim_result := claim_capacity(p_location_id, NULL, NOW(), p_scheduled_end_at, 'session');

  IF v_claim_result->>'error' IS NOT NULL THEN
    RETURN v_claim_result;
  END IF;

  -- Get operator
  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;

  -- Get rate quote
  v_rate := quote_price(p_location_id, p_vehicle_type, NOW(), NULL, NULL, NULL);

  -- Create session
  INSERT INTO parking_sessions (
    location_id, plate, vehicle_type, note, scheduled_end_at,
    started_at, status, rate_snapshot
  ) VALUES (
    p_location_id, p_plate, p_vehicle_type, p_note, p_scheduled_end_at,
    NOW(), 'active', v_rate
  ) RETURNING id INTO v_session_id;

  -- Create folio
  INSERT INTO folios (
    operator_id, location_id, session_id, status
  ) VALUES (
    v_operator_id, p_location_id, v_session_id, 'open'
  ) RETURNING id INTO v_folio_id;

  -- Log availability change
  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, 'walk_in_started', auth.uid());

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'folio_id', v_folio_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- End session with waiver support
CREATE OR REPLACE FUNCTION end_session(
  p_session_id UUID,
  p_cash_amount NUMERIC DEFAULT NULL,
  p_waive_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_folio RECORD;
  v_balance NUMERIC;
  v_charges_total NUMERIC;
  v_paid_total NUMERIC;
  v_operator RECORD;
  v_can_waive BOOLEAN;
BEGIN
  -- Get session
  SELECT * INTO v_session FROM parking_sessions WHERE id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;

  -- Get folio
  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id;

  -- Calculate parking fee
  DECLARE
    v_duration_hours NUMERIC;
    v_billed_hours INTEGER;
    v_rate JSONB;
    v_amount NUMERIC;
  BEGIN
    v_rate := v_session.rate_snapshot;
    v_duration_hours := EXTRACT(EPOCH FROM (COALESCE(v_session.ended_at, NOW()) - v_session.started_at)) / 3600.0;
    v_billed_hours := GREATEST(1, CEIL(v_duration_hours));

    -- Simplified pricing
    IF v_rate->>'rate_type' = 'hourly' THEN
      v_amount := (v_rate->>'amount')::NUMERIC * v_billed_hours;
    ELSIF v_rate->>'rate_type' = 'daily' THEN
      v_amount := (v_rate->>'amount')::NUMERIC * CEIL(v_billed_hours / 24.0);
    ELSE
      v_amount := (v_rate->>'amount')::NUMERIC;
    END IF;

    -- Add parking fee charge if not already added
    IF NOT EXISTS (
      SELECT 1 FROM folio_charges
      WHERE folio_id = v_folio.id AND type = 'parking_fee'
    ) THEN
      INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
      VALUES (v_folio.id, 'parking_fee', 'Parking fee', v_amount, auth.uid());
    END IF;
  END;

  -- Record cash payment if provided
  IF p_cash_amount IS NOT NULL AND p_cash_amount > 0 THEN
    INSERT INTO payments (folio_id, amount, method, recorded_by)
    VALUES (v_folio.id, p_cash_amount, 'cash', auth.uid());
  END IF;

  -- Calculate balance
  SELECT COALESCE(SUM(amount), 0) INTO v_charges_total
  FROM folio_charges WHERE folio_id = v_folio.id AND voided_at IS NULL;

  SELECT COALESCE(SUM(
    CASE direction
      WHEN 'payment' THEN amount
      WHEN 'refund' THEN -amount
    END
  ), 0) INTO v_paid_total
  FROM payments WHERE folio_id = v_folio.id;

  v_balance := v_charges_total - v_paid_total;

  -- Handle waiver if balance remains
  IF v_balance > 0.01 THEN
    IF p_waive_note IS NULL OR trim(p_waive_note) = '' THEN
      RETURN jsonb_build_object(
        'error', 'waiver_note_required',
        'balance', v_balance
      );
    END IF;

    -- Check if user can waive
    SELECT o.*, om.role INTO v_operator
    FROM operators o
    JOIN operator_members om ON om.operator_id = o.id
    WHERE o.id = v_folio.operator_id
    AND om.profile_id = auth.uid()
    LIMIT 1;

    v_can_waive := (
      v_operator.role IN ('owner', 'manager') OR
      (v_operator.role = 'staff' AND v_operator.staff_can_waive = true)
    );

    IF NOT v_can_waive THEN
      RETURN jsonb_build_object('error', 'waiver_not_allowed');
    END IF;

    -- Add waiver charge (negative)
    INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
    VALUES (v_folio.id, 'waiver', 'Waived balance', -v_balance, p_waive_note, auth.uid());
  END IF;

  -- Mark session as ended
  UPDATE parking_sessions
  SET status = 'ended', ended_at = NOW(), ended_by = auth.uid()
  WHERE id = p_session_id;

  -- Mark folio as settled
  UPDATE folios SET status = 'settled' WHERE id = v_folio.id;

  -- Log event
  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, v_session.status, 'ended', 'end_session', auth.uid());

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'final_balance', 0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Adjust availability
CREATE OR REPLACE FUNCTION adjust_availability(
  p_location_id UUID,
  p_delta INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE locations
  SET
    available_count = GREATEST(0, available_count + p_delta),
    availability_updated_at = NOW()
  WHERE id = p_location_id
  RETURNING available_count INTO v_new_count;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, 'adjusted_by_' || p_delta, auth.uid());

  RETURN jsonb_build_object('success', true, 'available_count', v_new_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create admin
CREATE OR REPLACE FUNCTION create_admin(p_profile_id UUID)
RETURNS JSONB AS $$
BEGIN
  -- Only existing admins can create new admins
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE profiles SET is_admin = true WHERE id = p_profile_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify location
CREATE OR REPLACE FUNCTION verify_location(p_location_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE locations
  SET
    verification_status = 'verified',
    verified_by = auth.uid(),
    verified_at = NOW()
  WHERE id = p_location_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
