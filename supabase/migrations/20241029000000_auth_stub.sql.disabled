-- Stub Supabase auth schema for local testing without full Supabase stack

CREATE SCHEMA IF NOT EXISTS auth;

DROP TABLE IF EXISTS auth.users CASCADE;

CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  encrypted_password TEXT,
  email_confirmed_at TIMESTAMPTZ,
  phone TEXT,
  phone_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to get current auth user (stubbed)
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID AS $$
  SELECT '00000000-0000-0000-0000-000000000001'::UUID;
$$ LANGUAGE SQL STABLE;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA auth TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres;
