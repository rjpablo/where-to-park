-- 0069 Google sign-in (rj t146u: "link them").
-- 1. Profiles for Google sign-ups: name and avatar from Google, no phone needed
--    (profiles.phone is already nullable). Emails are never used as display names.
-- 2. An explicit onboarding flag (the old 'New user' heuristic stays as a fallback).
-- 3. Server-side guard on auth.identities so an OAuth identity can only carry an email
--    the provider verified, and never an email that belongs to another account. Supabase
--    Auth links a Google sign-in to the existing user with the same VERIFIED email
--    (automatic linking) and signed-in users can link Google on purpose (manual linking,
--    enabled on staging); this guard closes the known gap where a manually linked identity
--    with an unverified or foreign email becomes an automatic-linking target.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT true;
-- Existing accounts that never finished onboarding keep being asked (old heuristic).
UPDATE profiles SET onboarded = false
 WHERE btrim(display_name) = '' OR display_name = 'New user'
    OR (phone IS NOT NULL AND regexp_replace(display_name, '[^0-9]', '', 'g') = regexp_replace(phone, '[^0-9]', '', 'g'));

-- Google (and other OAuth) picture URLs: https only, bounded length.
CREATE OR REPLACE FUNCTION oauth_avatar_url(p_meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN u ~ '^https://' AND length(u) <= 1000 THEN u END
  FROM (SELECT NULLIF(btrim(COALESCE(p_meta->>'avatar_url', p_meta->>'picture')), '') u) s;
$$;

CREATE OR REPLACE FUNCTION oauth_display_name(p_meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT left(NULLIF(btrim(COALESCE(p_meta->>'full_name', p_meta->>'name')), ''), 80);
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_phone TEXT := NULLIF(btrim(to_jsonb(NEW)->>'phone'), '');
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  IF v_phone IS NOT NULL THEN
    v_phone := '+' || ltrim(v_phone, '+');
  END IF;
  -- Google sign-ups: their Google name (prefilled, confirmed in onboarding) and picture.
  -- Never the email: display names are public (reviews, chat).
  INSERT INTO public.profiles (id, display_name, phone, avatar_url, onboarded)
  VALUES (NEW.id, COALESCE(oauth_display_name(v_meta), v_phone, 'New user'), v_phone,
          oauth_avatar_url(v_meta), false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_profile(p_display_name text, p_account_type text DEFAULT 'driver'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  SET display_name = btrim(p_display_name), account_type = v_type, onboarded = true
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true, 'account_type', v_type);
END;
$function$;

-- Identity guard. Phone/email identities are GoTrue's own (verified by OTP / link).
CREATE OR REPLACE FUNCTION public.guard_oauth_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_email text := lower(NULLIF(btrim(NEW.identity_data->>'email'), ''));
  v_verified boolean := lower(COALESCE(NEW.identity_data->>'email_verified',
                                       NEW.identity_data->>'verified_email', 'false')) = 'true';
BEGIN
  IF NEW.provider IN ('phone', 'email') OR v_email IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT v_verified THEN
    RAISE EXCEPTION 'oauth_email_not_verified' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email AND u.id <> NEW.user_id)
     OR EXISTS (SELECT 1 FROM auth.identities i
                 WHERE lower(i.identity_data->>'email') = v_email AND i.user_id <> NEW.user_id
                   AND i.id IS DISTINCT FROM NEW.id) THEN
    RAISE EXCEPTION 'oauth_email_belongs_to_another_account' USING ERRCODE = 'P0001';
  END IF;
  -- Automatic linking onto an account whose copy of this email was never confirmed
  -- (someone typed the victim's address and didn't prove it): refuse instead of handing
  -- the victim's Google sign-in to that account (pre-account takeover).
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id AND lower(u.email) = v_email
               AND u.email_confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'oauth_link_target_unverified' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_oauth_identity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_oauth_identity ON auth.identities;
CREATE TRIGGER guard_oauth_identity
  BEFORE INSERT OR UPDATE OF identity_data ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION public.guard_oauth_identity();

-- Linking Google to an existing (phone) account fills a missing avatar from Google.
CREATE OR REPLACE FUNCTION public.oauth_identity_linked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.provider NOT IN ('phone', 'email') THEN
    UPDATE profiles SET avatar_url = oauth_avatar_url(NEW.identity_data)
     WHERE id = NEW.user_id AND avatar_url IS NULL AND oauth_avatar_url(NEW.identity_data) IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.oauth_identity_linked() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS oauth_identity_linked ON auth.identities;
CREATE TRIGGER oauth_identity_linked AFTER INSERT ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION public.oauth_identity_linked();
