-- Phone numbers are not public. Other users see display_name via public_profiles.
-- Full profiles (including phone) are limited to: self, admins, operator teammates,
-- and operators/staff for drivers with a reservation or session at their location.

CREATE OR REPLACE VIEW public.public_profiles AS
SELECT id, display_name
FROM public.profiles;

DO $$
BEGIN
  EXECUTE 'ALTER VIEW public.public_profiles SET (security_invoker = false)';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_profiles(public.reviews)
RETURNS SETOF public.public_profiles
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public_profiles WHERE id = $1.author_id;
$$;

CREATE OR REPLACE FUNCTION public.public_profiles(public.chat_threads)
RETURNS SETOF public.public_profiles
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public_profiles WHERE id = $1.driver_id;
$$;

GRANT EXECUTE ON FUNCTION public.public_profiles(public.reviews) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_profiles(public.chat_threads) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Operator members can view teammates" ON public.profiles;
DROP POLICY IF EXISTS "Staff can view drivers with a stay" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (is_admin(auth.uid()));

CREATE POLICY "Operator members can view teammates"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM operator_members me
      JOIN operator_members them ON them.operator_id = me.operator_id
      WHERE me.profile_id = auth.uid()
        AND them.profile_id = profiles.id
    )
  );

CREATE POLICY "Staff can view drivers with a stay"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM parking_sessions s
      JOIN locations l ON l.id = s.location_id
      JOIN operator_members om ON om.operator_id = l.operator_id
      WHERE s.driver_id = profiles.id
        AND om.profile_id = auth.uid()
        AND (om.role IN ('owner', 'manager') OR s.location_id = ANY(om.location_ids))
    )
    OR EXISTS (
      SELECT 1
      FROM reservations r
      JOIN locations l ON l.id = r.location_id
      JOIN operator_members om ON om.operator_id = l.operator_id
      WHERE r.driver_id = profiles.id
        AND om.profile_id = auth.uid()
        AND (om.role IN ('owner', 'manager') OR r.location_id = ANY(om.location_ids))
    )
  );

REVOKE SELECT ON public.profiles FROM anon;

NOTIFY pgrst, 'reload schema';
