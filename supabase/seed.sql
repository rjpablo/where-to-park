-- Seed data for Where To Park - Baguio City sample data

-- Auth users first (profiles.id references auth.users).
-- Passwords are unused by the local JWT mint proxy; crypt() is for GoTrue if it is running.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token, recovery_token
) VALUES
(
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'admin@wheretopark.local',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, NOW(), NOW(),
  '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'maria@wheretopark.local',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, NOW(), NOW(),
  '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'juan@wheretopark.local',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, NOW(), NOW(),
  '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000003',
  'authenticated', 'authenticated', 'sarah@wheretopark.local',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, NOW(), NOW(),
  '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000004',
  'authenticated', 'authenticated', 'staff@wheretopark.local',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, NOW(), NOW(),
  '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name, phone, is_admin) VALUES
('00000000-0000-0000-0000-000000000001', 'RJ (Admin)', '+639171234567', true)
ON CONFLICT (id) DO UPDATE SET is_admin = true;

-- Create sample operators
INSERT INTO operators (id, display_name, contact, status, staff_can_waive) VALUES
('10000000-0000-0000-0000-000000000001', 'SM City Baguio Parking', '+639171111111', 'active', true),
('10000000-0000-0000-0000-000000000002', 'Session Road Park n Ride', '+639172222222', 'active', true),
('10000000-0000-0000-0000-000000000003', 'Casa Vallejo Valet', '+639173333333', 'active', false),
('10000000-0000-0000-0000-000000000004', 'Pine Ridge Driveway Parking', '+639174444444', 'active', true);

-- Create sample users
INSERT INTO profiles (id, display_name, phone) VALUES
('20000000-0000-0000-0000-000000000001', 'Maria Santos', '+639181111111'),
('20000000-0000-0000-0000-000000000002', 'Juan dela Cruz', '+639182222222'),
('20000000-0000-0000-0000-000000000003', 'Sarah Chen', '+639183333333'),
('20000000-0000-0000-0000-000000000004', 'Ana Staff', '+639184444444');

-- Make Maria and Juan operators/staff. Ana is staff on Session Road (Juan's operator).
INSERT INTO operator_members (operator_id, profile_id, role, location_ids) VALUES
('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'owner', '{}'),
('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'owner', '{}'),
('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'staff', ARRAY['30000000-0000-0000-0000-000000000003'::uuid]),
('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'owner', '{}'),
('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004', 'staff', ARRAY['30000000-0000-0000-0000-000000000002'::uuid]);

-- Create sample locations in Baguio City
-- SM City Baguio (16.4166, 120.5980)
INSERT INTO locations (
  id, operator_id, name, listing_type, geog, address, rules,
  tracking_mode, capacity, available_count, published, verification_status
) VALUES
('30000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',
 'SM City Baguio Main Parking',
 'commercial',
 ST_SetSRID(ST_MakePoint(120.5980, 16.4166), 4326)::GEOGRAPHY,
 'Upper Session Rd, Baguio, 2600 Benguet',
 'Open 10 AM - 10 PM daily. No overnight parking. Maximum height 2.1m.',
 'count',
 500,
 234,
 true,
 'verified'
);

-- Session Road parking (16.4120, 120.5960)
INSERT INTO locations (
  id, operator_id, name, listing_type, geog, address, rules,
  tracking_mode, capacity, available_count, published, verification_status
) VALUES
('30000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000002',
 'Session Road Park n Ride',
 'commercial',
 ST_SetSRID(ST_MakePoint(120.5960, 16.4120), 4326)::GEOGRAPHY,
 'Session Road, Baguio, 2600 Benguet',
 'Open 24/7. Covered parking. CCTV monitored.',
 'count',
 80,
 12,
 true,
 'verified'
);

-- Burnham Park area (16.4108, 120.5930)
INSERT INTO locations (
  id, operator_id, name, listing_type, geog, address, rules,
  tracking_mode, capacity, available_count, published, verification_status
) VALUES
('30000000-0000-0000-0000-000000000003',
 '10000000-0000-0000-0000-000000000003',
 'Casa Vallejo Hotel Valet',
 'commercial',
 ST_SetSRID(ST_MakePoint(120.5930, 16.4108), 4326)::GEOGRAPHY,
 'Upper Session Rd, Baguio, 2600 Benguet',
 'Hotel guests and restaurant diners. Valet service included.',
 'count',
 40,
 8,
 true,
 'verified'
);

-- Residential parking (16.4100, 120.5990) - VERIFIED
INSERT INTO locations (
  id, operator_id, name, listing_type, geog, address, rules,
  tracking_mode, capacity, available_count, published, verification_status
) VALUES
('30000000-0000-0000-0000-000000000004',
 '10000000-0000-0000-0000-000000000004',
 'Pine Ridge Driveway',
 'residential',
 ST_SetSRID(ST_MakePoint(120.5990, 16.4100), 4326)::GEOGRAPHY,
 '123 Pine Ridge, Dominican Hill, Baguio',
 'Quiet residential area. Respectful parking please. Available when gate is open.',
 'count',
 2,
 1,
 true,
 'verified'
);

-- Burnham Park Street Parking (16.4123, 120.5920) - UNVERIFIED
INSERT INTO locations (
  id, operator_id, name, listing_type, geog, address, rules,
  tracking_mode, capacity, available_count, published, verification_status
) VALUES
('30000000-0000-0000-0000-000000000005',
 '10000000-0000-0000-0000-000000000002',
 'Burnham Park Street Parking',
 'commercial',
 ST_SetSRID(ST_MakePoint(120.5920, 16.4123), 4326)::GEOGRAPHY,
 'Burnham Park, Baguio, 2600 Benguet',
 'Street parking near Burnham Park. Pay at meter or attendant.',
 'count',
 15,
 7,
 true,
 'unverified'
);

-- Add cover photos (placeholder paths)
INSERT INTO location_photos (location_id, storage_path, is_cover, sort_order) VALUES
('30000000-0000-0000-0000-000000000001', 'location-photos/sm-baguio-cover.jpg', true, 0),
('30000000-0000-0000-0000-000000000002', 'location-photos/session-road-cover.jpg', true, 0),
('30000000-0000-0000-0000-000000000003', 'location-photos/casa-vallejo-cover.jpg', true, 0),
('30000000-0000-0000-0000-000000000004', 'location-photos/pine-ridge-cover.jpg', true, 0);

-- Create default rates
INSERT INTO rates (
  location_id, is_default, name, rate_type, hourly_amount, active
) VALUES
('30000000-0000-0000-0000-000000000001', true, 'Standard Rate', 'hourly', 40.00, true),
('30000000-0000-0000-0000-000000000002', true, 'Standard Rate', 'hourly', 50.00, true),
('30000000-0000-0000-0000-000000000003', true, 'Valet Rate', 'flat_then_hourly', 100.00, true),
('30000000-0000-0000-0000-000000000004', true, 'Driveway Rate', 'hourly', 30.00, true);

-- Set flat rate details for Casa Vallejo
UPDATE rates
SET first_hours = 3, first_amount = 100.00, succeeding_hourly_amount = 40.00
WHERE location_id = '30000000-0000-0000-0000-000000000003';

-- Add monthly rates
INSERT INTO rates (
  location_id, is_default, name, rate_type, monthly_amount, active
) VALUES
('30000000-0000-0000-0000-000000000001', false, 'Monthly Parking', 'monthly', 3500.00, true),
('30000000-0000-0000-0000-000000000002', false, 'Monthly Parking', 'monthly', 4000.00, true);

-- Add custom weekend rate for SM
INSERT INTO rates (
  location_id, is_default, name, rate_type, hourly_amount,
  days_of_week, active
) VALUES
('30000000-0000-0000-0000-000000000001', false, 'Weekend Rate', 'hourly', 50.00,
 ARRAY[0, 6], true); -- Sunday and Saturday

-- Create sample areas for SM City Baguio
INSERT INTO areas (location_id, name, sort_order) VALUES
('30000000-0000-0000-0000-000000000001', 'Level B2', 0),
('30000000-0000-0000-0000-000000000001', 'Level B1', 1),
('30000000-0000-0000-0000-000000000001', 'Rooftop', 2);

-- Create sample vehicles for Sarah
INSERT INTO vehicles (driver_id, nickname, plate, vehicle_type, height_cm, is_default) VALUES
('20000000-0000-0000-0000-000000000003', 'My Car', 'ABC 1234', 'car', 155, true),
('20000000-0000-0000-0000-000000000003', 'Van', 'XYZ 5678', 'van', 210, false);

-- Add sample reviews
INSERT INTO reviews (location_id, author_id, rating, comment) VALUES
('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 5,
 'Large parking area, easy to find a spot even on weekends!'),
('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 4,
 'Convenient location near Session Road. A bit pricey but worth it.');

-- Create sample fee presets
INSERT INTO fee_presets (operator_id, location_id, name, amount, created_by) VALUES
('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Lost Ticket', 100.00, '20000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Overnight Parking', 200.00, '20000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Lost Ticket', 150.00, '20000000-0000-0000-0000-000000000002');

-- Update location policies to enable features
INSERT INTO location_policies (location_id, reservations_enabled, approval_required) VALUES
('30000000-0000-0000-0000-000000000001', true, false),
('30000000-0000-0000-0000-000000000002', true, false),
('30000000-0000-0000-0000-000000000003', true, true),
('30000000-0000-0000-0000-000000000004', false, false);

-- Create a sample active session
INSERT INTO parking_sessions (
  location_id, driver_id, plate, vehicle_type,
  started_at, scheduled_end_at, status,
  rate_snapshot
) VALUES (
  '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  'ABC 1234',
  'car',
  NOW() - INTERVAL '2 hours',
  NOW() + INTERVAL '1 hour',
  'active',
  '{"amount": 50, "rate_type": "hourly", "rate_name": "Standard Rate"}'::jsonb
);

-- Create folio for the active session
DO $$
DECLARE
  v_session_id UUID;
  v_folio_id UUID;
BEGIN
  SELECT id INTO v_session_id
  FROM parking_sessions
  WHERE plate = 'ABC 1234'
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO folios (operator_id, location_id, session_id, status)
  VALUES (
    '10000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    v_session_id,
    'open'
  ) RETURNING id INTO v_folio_id;

  -- Add parking fee charge
  INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
  VALUES (v_folio_id, 'parking_fee', 'Parking fee', 100.00, '20000000-0000-0000-0000-000000000002');
END $$;

-- Stamp location reviews that already have a session or reservation.
UPDATE reviews r
SET session_id = s.id
FROM parking_sessions s
WHERE r.session_id IS NULL
  AND s.location_id = r.location_id
  AND s.driver_id = r.author_id;
