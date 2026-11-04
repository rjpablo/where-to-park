-- 0075 Fix (found during the rj t179u email/profile audit): public_profiles is a simple
-- view over profiles, so Postgres makes it auto-updatable, and it runs with its owner's
-- rights (RLS bypassed). anon and authenticated had INSERT/UPDATE/DELETE on it, so anyone
-- with the public anon key could rename any user (PATCH /rest/v1/public_profiles?id=eq.…).
-- The view is read-only now; users still change their own name through profiles (RLS).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.public_profiles FROM anon, authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- The other public views are read-only for clients too. (PostGIS's geometry_columns /
-- geography_columns belong to supabase_admin, so this REVOKE is a no-op for them on
-- hosted Supabase; they only describe geometry columns.)
DO $$
DECLARE v TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY['geometry_columns', 'geography_columns', 'listing_photo_collection'] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', v);
    END IF;
  END LOOP;
END $$;
