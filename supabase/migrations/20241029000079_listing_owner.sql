-- 0079 "Listed by <name>" on Location details (rj t179u: "show the listing's owner in
-- Location details page"). Returns ONLY the owner's id, display name and photo — no
-- email, no phone (owners are reached through in-app chat). The owner is the operator
-- member with role 'owner' (earliest if several). Visible when the caller can see the
-- listing: published and not deleted, or the caller is a member of its operator, or admin.

CREATE OR REPLACE FUNCTION public.listing_owner(p_location_id UUID)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
    INTO v
    FROM locations l
    JOIN operator_members om ON om.operator_id = l.operator_id AND om.role = 'owner'
    JOIN profiles p ON p.id = om.profile_id
   WHERE l.id = p_location_id
     AND ((l.published AND l.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM operator_members me
                      WHERE me.operator_id = l.operator_id AND me.profile_id = auth.uid())
          OR is_admin(auth.uid()))
   ORDER BY om.created_at NULLS LAST, om.id
   LIMIT 1;
  RETURN v;  -- NULL: no such visible listing or no owner
END;
$$;
REVOKE ALL ON FUNCTION public.listing_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listing_owner(UUID) TO anon, authenticated;
