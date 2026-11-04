-- 0070 Fix: brand-new Google sign-ups were refused (rj t150u).
-- GoTrue creates a new OAuth user with its email still UNCONFIRMED, inserts the Google
-- identity, and only then sets email_confirmed_at. 0069's pre-account-takeover check
-- ('target account holds this email unconfirmed') therefore fired on every first Google
-- sign-in (auth log: "500: Error creating identity … oauth_link_target_unverified").
-- The check is meant for linking onto an EXISTING account, so it now applies only when
-- the target account already has another sign-in method (phone, email, another OAuth).
-- Unverified Google emails and emails owned by another account are still refused.
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
  -- Linking onto an existing account (it already has another identity) whose copy of
  -- this email was never confirmed: refuse (pre-account takeover). A brand-new Google
  -- user has no other identity yet; GoTrue confirms its email right after this insert.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id AND lower(u.email) = v_email
               AND u.email_confirmed_at IS NULL)
     AND EXISTS (SELECT 1 FROM auth.identities i
                  WHERE i.user_id = NEW.user_id AND i.id IS DISTINCT FROM NEW.id) THEN
    RAISE EXCEPTION 'oauth_link_target_unverified' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_oauth_identity() FROM PUBLIC, anon, authenticated;
