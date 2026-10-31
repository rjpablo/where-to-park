-- Hosted auth hardening (idempotent; safe to apply on hosted).
-- 1. Auto-create a public.profiles row when GoTrue inserts auth.users.
-- 2. Lock local-only fake OTP RPCs to service_role (hosted uses real Auth).
-- 3. Column-level UPDATE so users cannot set is_admin.
-- Do NOT apply 20241029000007_auth_uid.sql on hosted: it overrides auth.uid().

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT := NULLIF(btrim(to_jsonb(NEW)->>'phone'), '');
BEGIN
  IF v_phone IS NOT NULL THEN
    v_phone := '+' || ltrim(v_phone, '+');
  END IF;
  INSERT INTO public.profiles (id, display_name, phone)
  VALUES (NEW.id, COALESCE(v_phone, NEW.email, 'New user'), v_phone)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DO $$
BEGIN
  IF current_setting('server_version_num')::integer >= 140000 THEN
    EXECUTE $t$
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()
    $t$;
  ELSE
    EXECUTE $t$
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE PROCEDURE public.handle_new_auth_user()
    $t$;
  END IF;
END;
$$;

-- Local JWT mint proxy calls these with a service_role JWT. Hosted Auth does not.
REVOKE EXECUTE ON FUNCTION public.request_phone_otp(TEXT) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.verify_phone_otp(TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.request_phone_otp(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_phone_otp(TEXT, TEXT) TO service_role;

-- Trigger may already have inserted the profile; keep display_name = phone so
-- the app treats the account as a new user until complete_profile runs.
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
    VALUES (v_user_id, v_phone, v_phone, 'driver')
    ON CONFLICT (id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      phone = EXCLUDED.phone,
      account_type = COALESCE(profiles.account_type, EXCLUDED.account_type);
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

GRANT EXECUTE ON FUNCTION verify_phone_otp(TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION verify_phone_otp(TEXT, TEXT) FROM anon, authenticated, public;

REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (
  display_name,
  phone,
  preferred_nav_app,
  account_type,
  updated_at
) ON public.profiles TO authenticated;

REVOKE INSERT ON public.profiles FROM authenticated, anon;
GRANT INSERT (
  id,
  display_name,
  phone,
  preferred_nav_app,
  account_type
) ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
