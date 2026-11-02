-- 0080 Email privacy hardening (rj t179u: "a user's email address should only be visible
-- to him/her"). Audit result: no public table/view/RPC returns an email (see
-- supabase/tests/email_privacy.sql, scripts/test-email-privacy.js). One indirect path
-- closed here: an OAuth provider can send the email address as the "name" (accounts with
-- no name set); that would have become the public display name. Such names are now
-- ignored (falls back to phone / 'New user', and the user is asked for a name).
CREATE OR REPLACE FUNCTION public.oauth_display_name(p_meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n ~ '@' THEN NULL ELSE n END
    FROM (SELECT left(NULLIF(btrim(COALESCE(p_meta->>'full_name', p_meta->>'name')), ''), 80) AS n) x;
$$;
