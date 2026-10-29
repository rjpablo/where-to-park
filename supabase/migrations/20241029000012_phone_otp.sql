-- Phone OTP (local test code 123456) and profile.account_type.
-- Guests keep using search_nearby with the anon key.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'driver'
  CHECK (account_type IN ('driver', 'operator'));

UPDATE profiles SET account_type = 'operator'
WHERE id IN (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
);

CREATE TABLE IF NOT EXISTS phone_otps (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE phone_otps ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g');
$$;

-- Always issues 123456 in this environment (GoTrue SMS is not on the host).
CREATE OR REPLACE FUNCTION request_phone_otp(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT := normalize_phone(p_phone);
BEGIN
  IF v_phone IS NULL OR length(v_phone) < 10 THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;

  INSERT INTO phone_otps (phone, code, created_at)
  VALUES (v_phone, '123456', NOW())
  ON CONFLICT (phone) DO UPDATE SET code = '123456', created_at = NOW();

  RETURN jsonb_build_object('success', true, 'phone', v_phone, 'test_otp', true);
END;
$$;

CREATE OR REPLACE FUNCTION verify_phone_otp(p_phone TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_phone TEXT := normalize_phone(p_phone);
  v_code TEXT := btrim(COALESCE(p_code, ''));
  v_user_id UUID;
  v_is_new BOOLEAN := false;
  v_email TEXT;
BEGIN
  IF v_phone IS NULL OR length(v_phone) < 10 THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM phone_otps
    WHERE phone = v_phone AND code = v_code AND created_at > NOW() - INTERVAL '10 minutes'
  ) AND v_code <> '123456' THEN
    RETURN jsonb_build_object('error', 'invalid_otp');
  END IF;

  -- Accept the documented local test OTP even if request_phone_otp was skipped.
  IF v_code <> '123456' THEN
    RETURN jsonb_build_object('error', 'invalid_otp');
  END IF;

  SELECT id INTO v_user_id FROM profiles WHERE phone = v_phone LIMIT 1;

  IF v_user_id IS NULL THEN
    v_is_new := true;
    v_user_id := gen_random_uuid();
    v_email := regexp_replace(v_phone, '[^0-9]', '', 'g') || '@phone.wheretopark.local';

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      'phone-otp',
      NOW(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      jsonb_build_object('phone', v_phone),
      NOW(), NOW(),
      '', '', '', ''
    );

    INSERT INTO profiles (id, display_name, phone, account_type)
    VALUES (v_user_id, v_phone, v_phone, 'driver');
  END IF;

  DELETE FROM phone_otps WHERE phone = v_phone;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'is_new', v_is_new,
    'phone', v_phone,
    'account_type', (SELECT account_type FROM profiles WHERE id = v_user_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_profile(
  p_display_name TEXT,
  p_account_type TEXT DEFAULT 'driver'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_type TEXT := COALESCE(NULLIF(btrim(p_account_type), ''), 'driver');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF v_type NOT IN ('driver', 'operator') THEN
    RETURN jsonb_build_object('error', 'invalid_account_type');
  END IF;
  IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
    RETURN jsonb_build_object('error', 'name_required');
  END IF;

  UPDATE profiles
  SET display_name = btrim(p_display_name), account_type = v_type
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true, 'account_type', v_type);
END;
$$;

GRANT EXECUTE ON FUNCTION normalize_phone(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION request_phone_otp(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION verify_phone_otp(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_profile(TEXT, TEXT) TO authenticated, service_role;
