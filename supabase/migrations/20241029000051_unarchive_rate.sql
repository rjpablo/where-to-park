-- 0051: restore an archived rate (rj, pt100u). It comes back inactive; Activate
-- it separately. Owners/managers only.
CREATE OR REPLACE FUNCTION public.unarchive_rate(p_rate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rate record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  SELECT r.*, l.operator_id INTO v_rate
    FROM rates r JOIN locations l ON l.id = r.location_id
   WHERE r.id = p_rate_id
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_rate.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_rate.archived_at IS NULL THEN
    RETURN jsonb_build_object('success', true, 'archived', false);
  END IF;
  UPDATE rates SET archived_at = NULL, active = false WHERE id = p_rate_id;
  RETURN jsonb_build_object('success', true, 'archived', false, 'active', false);
END;
$$;
REVOKE ALL ON FUNCTION public.unarchive_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unarchive_rate(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
