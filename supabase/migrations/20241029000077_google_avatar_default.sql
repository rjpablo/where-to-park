-- 0077 Google picture as the default profile photo (rj t179u: "For Google sign-in users,
-- use the profile photo from Google by default").
--
-- * First Google sign-up: handle_new_auth_user (0069) already saves the Google picture.
-- * Linking Google to an existing account: fills avatar_url only when it is empty AND the
--   user never removed their photo (avatar_removed_at, 0076). Decision: "Remove photo"
--   means the generic icon; it does not bring the Google picture back, now or on a later
--   link. An uploaded photo always wins (it is never replaced).
-- * Backfill: Google accounts with no photo that never removed one get their picture.
-- Stored server-side in profiles, so other users see it (reviews, chat, …).

CREATE OR REPLACE FUNCTION public.oauth_identity_linked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.provider NOT IN ('phone', 'email') THEN
    UPDATE profiles SET avatar_url = oauth_avatar_url(NEW.identity_data)
     WHERE id = NEW.user_id AND avatar_url IS NULL AND avatar_removed_at IS NULL
       AND oauth_avatar_url(NEW.identity_data) IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.oauth_identity_linked() FROM PUBLIC, anon, authenticated;

UPDATE profiles p
   SET avatar_url = g.url
  FROM (SELECT DISTINCT ON (i.user_id) i.user_id, oauth_avatar_url(i.identity_data) AS url
          FROM auth.identities i
         WHERE i.provider = 'google' AND oauth_avatar_url(i.identity_data) IS NOT NULL
         ORDER BY i.user_id, i.created_at) g
 WHERE p.id = g.user_id AND p.avatar_url IS NULL AND p.avatar_removed_at IS NULL;
