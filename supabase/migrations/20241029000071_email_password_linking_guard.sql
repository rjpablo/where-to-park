-- 0071 Email + password sign-in (rj): keep Google linking safe while staging auto-confirms
-- email sign-ups (no confirmation mail, so an email/password account's address is NOT
-- proven). Supabase Auth would otherwise auto-link a Google sign-in to an email/password
-- account with the same address, and whoever created that account (knowing its password)
-- could then use the Google user's account: a takeover.
-- Rule added to guard_oauth_identity: a Google (OAuth) identity can't join an account that
-- holds the same email through an email/password identity whose address was never proven
-- by a confirmation mail (identity_data.email_verified is not true: auto-confirmed sign-ups
-- and the admin-set test accounts). Supabase Auth sets email_verified when the mail link is
-- opened. (users.confirmation_sent_at is no signal: phone OTP sets it too.)
-- Such a Google sign-in is refused (the user sees "This Google account can't be used here").
-- Once email confirmation is turned on, confirmed accounts link normally.
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
  -- Existing account (it already has another identity) holding this email unproven:
  -- unconfirmed (0069/0070), or an email/password identity that was never confirmed by
  -- mail (0071: auto-confirm). A brand-new Google user has no other identity yet.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id AND lower(u.email) = v_email
               AND (u.email_confirmed_at IS NULL
                    OR EXISTS (SELECT 1 FROM auth.identities e
                                WHERE e.user_id = u.id AND e.provider = 'email'
                                  AND lower(e.identity_data->>'email') = v_email
                                  AND lower(COALESCE(e.identity_data->>'email_verified', 'false')) <> 'true')))
     AND EXISTS (SELECT 1 FROM auth.identities i
                  WHERE i.user_id = NEW.user_id AND i.id IS DISTINCT FROM NEW.id) THEN
    RAISE EXCEPTION 'oauth_link_target_unverified' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_oauth_identity() FROM PUBLIC, anon, authenticated;
