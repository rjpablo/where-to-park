-- Trigger to update location rating stats
CREATE OR REPLACE FUNCTION update_location_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO location_rating_stats (location_id, review_count, avg_rating)
  SELECT
    location_id,
    COUNT(*)::INTEGER,
    AVG(rating)::NUMERIC(3,2)
  FROM reviews
  WHERE location_id = COALESCE(NEW.location_id, OLD.location_id)
  AND NOT hidden
  GROUP BY location_id
  ON CONFLICT (location_id) DO UPDATE SET
    review_count = EXCLUDED.review_count,
    avg_rating = EXCLUDED.avg_rating;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rating_stats_on_review
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW
EXECUTE FUNCTION update_location_rating_stats();

-- Trigger to auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_operators_updated_at BEFORE UPDATE ON operators
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reservations_updated_at BEFORE UPDATE ON reservations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON parking_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_folios_updated_at BEFORE UPDATE ON folios
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to ensure only one default vehicle per user
CREATE OR REPLACE FUNCTION ensure_single_default_vehicle()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE vehicles
    SET is_default = false
    WHERE driver_id = NEW.driver_id
    AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_default_vehicle_trigger
BEFORE INSERT OR UPDATE ON vehicles
FOR EACH ROW
WHEN (NEW.is_default = true)
EXECUTE FUNCTION ensure_single_default_vehicle();

-- Trigger to ensure only one cover photo per location
CREATE OR REPLACE FUNCTION ensure_single_cover_photo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_cover = true THEN
    UPDATE location_photos
    SET is_cover = false
    WHERE location_id = NEW.location_id
    AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_cover_photo_trigger
BEFORE INSERT OR UPDATE ON location_photos
FOR EACH ROW
WHEN (NEW.is_cover = true)
EXECUTE FUNCTION ensure_single_cover_photo();

-- Trigger to validate days_of_week array in rates
CREATE OR REPLACE FUNCTION validate_rate_days_of_week()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.days_of_week IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(NEW.days_of_week) d WHERE d < 0 OR d > 6) THEN
      RAISE EXCEPTION 'days_of_week must contain values between 0 and 6';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_rate_days_of_week_trigger
BEFORE INSERT OR UPDATE ON rates
FOR EACH ROW
EXECUTE FUNCTION validate_rate_days_of_week();

-- Trigger to create chat system events for session actions
CREATE OR REPLACE FUNCTION create_session_chat_event()
RETURNS TRIGGER AS $$
DECLARE
  v_thread_id UUID;
  v_event_body TEXT;
BEGIN
  -- Find or create thread
  IF NEW.driver_id IS NOT NULL THEN
    SELECT id INTO v_thread_id
    FROM chat_threads
    WHERE location_id = NEW.location_id
    AND driver_id = NEW.driver_id
    LIMIT 1;

    IF v_thread_id IS NULL THEN
      INSERT INTO chat_threads (
        location_id,
        operator_id,
        driver_id,
        started_by
      ) VALUES (
        NEW.location_id,
        (SELECT operator_id FROM locations WHERE id = NEW.location_id),
        NEW.driver_id,
        'system'
      ) RETURNING id INTO v_thread_id;
    END IF;

    -- Create event message based on action
    IF TG_OP = 'INSERT' THEN
      v_event_body := 'Session started';
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'ended' AND OLD.status != 'ended' THEN
      v_event_body := 'Session ended';
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'overdue' AND OLD.status != 'overdue' THEN
      v_event_body := 'Session is overdue';
    END IF;

    IF v_event_body IS NOT NULL THEN
      INSERT INTO chat_messages (
        thread_id, sender_id, kind, body, event_type, event_ref
      ) VALUES (
        v_thread_id, NULL, 'system', v_event_body, 'session_update', NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_session_chat_event_trigger
AFTER INSERT OR UPDATE ON parking_sessions
FOR EACH ROW
EXECUTE FUNCTION create_session_chat_event();
