-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_rating_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE eta_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Operators policies
CREATE POLICY "Published operators viewable by all"
  ON operators FOR SELECT
  USING (status = 'active');

CREATE POLICY "Anyone can create operator"
  ON operators FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Owners/managers can update operator"
  ON operators FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM operator_members
      WHERE operator_id = operators.id
      AND profile_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- Operator members policies
CREATE POLICY "Members can view their own membership"
  ON operator_members FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Admins can view own operator staff"
  ON operator_members FOR SELECT
  USING (is_operator_admin(auth.uid(), operator_id));

CREATE POLICY "Admins can manage own operator members"
  ON operator_members FOR ALL
  USING (is_operator_admin(auth.uid(), operator_id));

-- Locations policies
CREATE POLICY "Published locations viewable by all"
  ON locations FOR SELECT
  USING (published = true);

CREATE POLICY "Operator members can view their locations"
  ON locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM operator_members
      WHERE operator_id = locations.operator_id
      AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Operators can manage locations"
  ON locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM operator_members
      WHERE operator_id = locations.operator_id
      AND profile_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- Location photos policies
CREATE POLICY "Photos viewable for published locations"
  ON location_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM locations
      WHERE id = location_photos.location_id
      AND published = true
    )
  );

CREATE POLICY "Operators can manage photos"
  ON location_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id
      WHERE l.id = location_photos.location_id
      AND om.profile_id = auth.uid()
      AND om.role IN ('owner', 'manager')
    )
  );

-- Rates policies
CREATE POLICY "Rates viewable for published locations"
  ON rates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM locations
      WHERE id = rates.location_id
      AND published = true
    )
  );

CREATE POLICY "Operators can manage rates"
  ON rates FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id
      WHERE l.id = rates.location_id
      AND om.profile_id = auth.uid()
      AND om.role IN ('owner', 'manager')
    )
  );

-- Vehicles policies
CREATE POLICY "Users can manage own vehicles"
  ON vehicles FOR ALL
  USING (driver_id = auth.uid());

-- Reviews policies
CREATE POLICY "Reviews viewable for published locations"
  ON reviews FOR SELECT
  USING (
    NOT hidden AND
    EXISTS (
      SELECT 1 FROM locations
      WHERE id = reviews.location_id
      AND published = true
    )
  );

CREATE POLICY "Authenticated users can create reviews"
  ON reviews FOR INSERT
  WITH CHECK (
    auth.uid() = author_id AND
    EXISTS (
      SELECT 1 FROM locations
      WHERE id = reviews.location_id
      AND published = true
    )
  );

CREATE POLICY "Users can update own reviews"
  ON reviews FOR UPDATE
  USING (auth.uid() = author_id);

-- Parking sessions policies
CREATE POLICY "Users can view own sessions"
  ON parking_sessions FOR SELECT
  USING (driver_id = auth.uid());

CREATE POLICY "Operator/staff can view location sessions"
  ON parking_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id
      WHERE l.id = parking_sessions.location_id
      AND om.profile_id = auth.uid()
      AND (om.role IN ('owner', 'manager') OR parking_sessions.location_id = ANY(om.location_ids))
    )
  );

-- Folios policies
CREATE POLICY "Users can view own folios"
  ON folios FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM parking_sessions
      WHERE id = folios.session_id
      AND driver_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM reservations
      WHERE id = folios.reservation_id
      AND driver_id = auth.uid()
    )
  );

CREATE POLICY "Operator/staff can view location folios"
  ON folios FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM operator_members
      WHERE operator_id = folios.operator_id
      AND profile_id = auth.uid()
    )
  );

-- Chat threads policies
CREATE POLICY "Thread participants can view"
  ON chat_threads FOR SELECT
  USING (
    driver_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM operator_members
      WHERE operator_id = chat_threads.operator_id
      AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Drivers can create threads"
  ON chat_threads FOR INSERT
  WITH CHECK (driver_id = auth.uid());

-- Chat messages policies
CREATE POLICY "Thread participants can view messages"
  ON chat_messages FOR SELECT
  USING (
    NOT hidden AND
    EXISTS (
      SELECT 1 FROM chat_threads
      WHERE id = chat_messages.thread_id
      AND (
        driver_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM operator_members
          WHERE operator_id = chat_threads.operator_id
          AND profile_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Thread participants can send messages"
  ON chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM chat_threads
      WHERE id = chat_messages.thread_id
      AND (
        driver_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM operator_members
          WHERE operator_id = chat_threads.operator_id
          AND profile_id = auth.uid()
        )
      )
    )
  );

-- Notifications policies
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (recipient_id = auth.uid());

-- Reports policies
CREATE POLICY "Authenticated users can create reports"
  ON reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Admins can view reports"
  ON reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND is_admin = true
    )
  );

-- Platform settings policies
CREATE POLICY "Settings viewable by all"
  ON platform_settings FOR SELECT
  USING (true);

CREATE POLICY "Only admins can update settings"
  ON platform_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND is_admin = true
    )
  );

-- ETA cache policies (public read)
CREATE POLICY "ETA cache readable by all"
  ON eta_cache FOR SELECT
  USING (true);
