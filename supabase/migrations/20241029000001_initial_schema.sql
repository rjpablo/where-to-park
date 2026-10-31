-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
-- pg_cron is optional for scheduled jobs
DO $$ 
BEGIN
  CREATE EXTENSION IF NOT EXISTS "pg_cron";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension not available, scheduled jobs will be skipped';
END $$;

-- Create custom types
CREATE TYPE listing_type AS ENUM ('commercial', 'residential');
CREATE TYPE tracking_mode AS ENUM ('count', 'open_full', 'slots');
CREATE TYPE verification_status AS ENUM ('unverified', 'verified');
CREATE TYPE operator_status AS ENUM ('active', 'suspended');
CREATE TYPE operator_role AS ENUM ('owner', 'manager', 'staff');
CREATE TYPE vehicle_type AS ENUM ('car', 'suv', 'van', 'motorcycle', 'truck');
CREATE TYPE rate_type AS ENUM ('hourly', 'daily', 'flat_then_hourly', 'monthly');
CREATE TYPE reservation_status AS ENUM ('awaiting_payment', 'pending_approval', 'confirmed', 'active', 'completed', 'cancelled', 'declined', 'expired', 'no_show');
CREATE TYPE session_status AS ENUM ('active', 'overdue', 'ended');
CREATE TYPE payment_method AS ENUM ('cash', 'gcash', 'maya', 'card', 'other');
CREATE TYPE payment_direction AS ENUM ('payment', 'refund');
CREATE TYPE charge_type AS ENUM ('parking_fee', 'additional_fee', 'adjustment', 'waiver');
CREATE TYPE folio_status AS ENUM ('open', 'settled');
CREATE TYPE slot_state AS ENUM ('available', 'occupied', 'reserved', 'unavailable');
CREATE TYPE chat_message_kind AS ENUM ('text', 'image', 'system');
CREATE TYPE report_target_type AS ENUM ('location', 'review', 'chat_message');
CREATE TYPE report_status AS ENUM ('pending', 'resolved', 'dismissed');
CREATE TYPE notification_type AS ENUM ('new_listing', 'reservation_request', 'fee_paid', 'scheduled_end', 'overdue', 'no_show', 'report', 'chat_message', 'approval_required', 'verification_needed');

-- Create profiles table (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  preferred_nav_app TEXT CHECK (preferred_nav_app IN ('google_maps', 'waze', 'default')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create operators table
CREATE TABLE operators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name TEXT NOT NULL,
  contact TEXT,
  status operator_status DEFAULT 'active',
  payments_mode TEXT DEFAULT 'cash_only',
  payout_gcash_number TEXT,
  commission_pct_override NUMERIC(5,2),
  staff_can_waive BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create operator_members table
CREATE TABLE operator_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role operator_role NOT NULL,
  location_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(operator_id, profile_id)
);

-- Create locations table
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  listing_type listing_type NOT NULL,
  geog GEOGRAPHY(POINT) NOT NULL,
  address TEXT NOT NULL,
  rules TEXT,
  rules_version INTEGER DEFAULT 1,
  tracking_mode tracking_mode DEFAULT 'count',
  capacity INTEGER NOT NULL DEFAULT 0,
  available_count INTEGER NOT NULL DEFAULT 0 CHECK (available_count >= 0),
  manual_reserved_count INTEGER DEFAULT 0,
  unavailable_count INTEGER DEFAULT 0,
  open_status BOOLEAN,
  availability_updated_at TIMESTAMPTZ DEFAULT NOW(),
  stale_after_min INTEGER DEFAULT 120,
  hours TEXT,
  published BOOLEAN DEFAULT FALSE,
  verification_status verification_status DEFAULT 'unverified',
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_locations_geog ON locations USING GIST (geog);
CREATE INDEX idx_locations_operator ON locations(operator_id);
CREATE INDEX idx_locations_verification ON locations(verification_status) WHERE published = TRUE;

-- Create location_photos table
CREATE TABLE location_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover BOOLEAN DEFAULT FALSE,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_location_photos_location ON location_photos(location_id);

-- Create location_policies table
CREATE TABLE location_policies (
  location_id UUID PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  reservations_enabled BOOLEAN DEFAULT FALSE,
  approval_required BOOLEAN DEFAULT FALSE,
  approval_window_min INTEGER DEFAULT 15,
  payment_hold_min INTEGER DEFAULT 15,
  max_hold_min INTEGER DEFAULT 60,
  max_advance_days INTEGER,
  grace_min INTEGER DEFAULT 15,
  reservation_fee_pct NUMERIC(5,2),
  refund_cutoff_min INTEGER DEFAULT 60,
  late_cancel_refund_pct NUMERIC(5,2) DEFAULT 0,
  no_show_refund_pct NUMERIC(5,2) DEFAULT 0
);

-- Create areas table
CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_areas_location ON areas(location_id);

-- Create slots table
CREATE TABLE slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  vehicle_types vehicle_type[],
  max_clearance_cm INTEGER,
  max_width_cm INTEGER,
  max_length_cm INTEGER,
  state slot_state DEFAULT 'available',
  manual_note TEXT,
  manual_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_slots_location ON slots(location_id);
CREATE INDEX idx_slots_state ON slots(state);

-- Create rates table
CREATE TABLE rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  is_default BOOLEAN DEFAULT FALSE,
  name TEXT NOT NULL,
  rate_type rate_type NOT NULL,
  hourly_amount NUMERIC(12,2),
  daily_amount NUMERIC(12,2),
  monthly_amount NUMERIC(12,2),
  first_hours INTEGER,
  first_amount NUMERIC(12,2),
  succeeding_hourly_amount NUMERIC(12,2),
  max_per_day NUMERIC(12,2),
  area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  slot_id UUID REFERENCES slots(id) ON DELETE SET NULL,
  vehicle_type vehicle_type,
  days_of_week INTEGER[],
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  priority INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rates_location ON rates(location_id);
CREATE INDEX idx_rates_active ON rates(active) WHERE active = TRUE;

-- Create vehicles table
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  plate TEXT,
  vehicle_type vehicle_type NOT NULL,
  height_cm INTEGER,
  width_cm INTEGER,
  length_cm INTEGER,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vehicles_driver ON vehicles(driver_id);

-- Create reviews table
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  reservation_id UUID,
  session_id UUID,
  operator_reply TEXT,
  reply_at TIMESTAMPTZ,
  hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(location_id, author_id)
);

CREATE INDEX idx_reviews_location ON reviews(location_id);

-- Create location_rating_stats table
CREATE TABLE location_rating_stats (
  location_id UUID PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  review_count INTEGER DEFAULT 0,
  avg_rating NUMERIC(3,2)
);

-- Create reservations table
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
  slot_id UUID REFERENCES slots(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reserved_hours NUMERIC(10,2),
  reserved_days NUMERIC(10,2),
  status reservation_status DEFAULT 'awaiting_payment',
  approval_expires_at TIMESTAMPTZ,
  hold_expires_at TIMESTAMPTZ,
  max_hold_expires_at TIMESTAMPTZ,
  refunded_amount NUMERIC(12,2) DEFAULT 0,
  quote_amount NUMERIC(12,2) NOT NULL,
  fee_due_amount NUMERIC(12,2) DEFAULT 0,
  rules_ack_at TIMESTAMPTZ,
  rules_version INTEGER,
  policy_snapshot JSONB,
  rate_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reservations_driver ON reservations(driver_id);
CREATE INDEX idx_reservations_location ON reservations(location_id);
CREATE INDEX idx_reservations_status ON reservations(status);
CREATE INDEX idx_reservations_times ON reservations(start_at, end_at);

-- Create parking_sessions table
CREATE TABLE parking_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  slot_id UUID REFERENCES slots(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  plate TEXT NOT NULL,
  vehicle_type vehicle_type NOT NULL,
  note TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_end_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  billed_end_at TIMESTAMPTZ,
  overdue_minutes INTEGER DEFAULT 0,
  amount_due_override NUMERIC(12,2),
  start_overridden_by UUID REFERENCES profiles(id),
  end_overridden_by UUID REFERENCES profiles(id),
  override_reason TEXT,
  ended_by UUID REFERENCES profiles(id),
  status session_status DEFAULT 'active',
  rate_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_location ON parking_sessions(location_id);
CREATE INDEX idx_sessions_driver ON parking_sessions(driver_id);
CREATE INDEX idx_sessions_status ON parking_sessions(status);

-- Create folios table
CREATE TABLE folios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  session_id UUID REFERENCES parking_sessions(id) ON DELETE SET NULL,
  currency TEXT DEFAULT 'PHP',
  status folio_status DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_folios_reservation ON folios(reservation_id);
CREATE INDEX idx_folios_session ON folios(session_id);

-- Create folio_charges table
CREATE TABLE folio_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  folio_id UUID NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  type charge_type NOT NULL,
  fee_preset_id UUID,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  added_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  voided_at TIMESTAMPTZ
);

CREATE INDEX idx_charges_folio ON folio_charges(folio_id);

-- Create payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  folio_id UUID NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  direction payment_direction DEFAULT 'payment',
  amount NUMERIC(12,2) NOT NULL,
  method payment_method DEFAULT 'cash',
  source TEXT DEFAULT 'manual',
  gateway TEXT,
  gateway_ref TEXT,
  recorded_by UUID REFERENCES profiles(id),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_folio ON payments(folio_id);

-- Create fee_presets table
CREATE TABLE fee_presets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fee_presets_operator ON fee_presets(operator_id);

-- Create driver_reviews table
CREATE TABLE driver_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  session_id UUID REFERENCES parking_sessions(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_driver_reviews_driver ON driver_reviews(driver_id);
CREATE INDEX idx_driver_reviews_operator ON driver_reviews(operator_id);

-- Create chat_threads table
CREATE TABLE chat_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  session_id UUID REFERENCES parking_sessions(id) ON DELETE SET NULL,
  started_by TEXT CHECK (started_by IN ('driver', 'system')),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_threads_location_driver ON chat_threads(location_id, driver_id);
CREATE INDEX idx_threads_operator ON chat_threads(operator_id);

-- Create chat_messages table
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  kind chat_message_kind NOT NULL,
  body TEXT,
  image_path TEXT,
  event_type TEXT,
  event_ref UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  hidden BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_messages_thread ON chat_messages(thread_id, created_at);

-- Create eta_cache table
CREATE TABLE eta_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_cell TEXT NOT NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  duration_s INTEGER NOT NULL,
  distance_m INTEGER NOT NULL,
  source TEXT DEFAULT 'ors' CHECK (source IN ('ors', 'estimate')),
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(origin_cell, location_id)
);

CREATE INDEX idx_eta_cache_location ON eta_cache(location_id);
CREATE INDEX idx_eta_cache_fetched ON eta_cache(fetched_at);

-- Create notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  ref_type TEXT,
  ref_id UUID,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  pushed_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(recipient_id) WHERE read_at IS NULL;

-- Create reports table
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type report_target_type NOT NULL,
  target_id UUID NOT NULL,
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status report_status DEFAULT 'pending',
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_target ON reports(target_type, target_id);

-- Create platform_settings table
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default platform settings
INSERT INTO platform_settings (key, value) VALUES
  ('commission_pct', '0'),
  ('eta_top_n', '20'),
  ('eta_ttl_min', '10');

-- Create availability_events table
CREATE TABLE availability_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  slot_id UUID REFERENCES slots(id) ON DELETE SET NULL,
  change TEXT NOT NULL,
  actor UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_availability_events_location ON availability_events(location_id, created_at DESC);

-- Create booking_events table
CREATE TABLE booking_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  session_id UUID REFERENCES parking_sessions(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT,
  action TEXT NOT NULL,
  actor UUID REFERENCES profiles(id),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_booking_events_reservation ON booking_events(reservation_id, created_at);
CREATE INDEX idx_booking_events_session ON booking_events(session_id, created_at);
