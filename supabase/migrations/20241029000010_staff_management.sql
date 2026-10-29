-- Staff invite/remove and staff_can_waive toggle. Owner/manager only.

CREATE OR REPLACE FUNCTION invite_staff(
  p_operator_id UUID,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_role operator_role DEFAULT 'staff',
  p_location_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile_id UUID;
  v_member_id UUID;
  v_role operator_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT is_operator_admin(v_uid, p_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  v_role := COALESCE(p_role, 'staff');
  IF v_role = 'owner' THEN
    RETURN jsonb_build_object('error', 'cannot_invite_owner');
  END IF;
  IF (p_email IS NULL OR btrim(p_email) = '') AND (p_phone IS NULL OR btrim(p_phone) = '') THEN
    RETURN jsonb_build_object('error', 'email_or_phone_required');
  END IF;

  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT p.id INTO v_profile_id
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE lower(u.email) = lower(btrim(p_email))
    LIMIT 1;
  END IF;

  IF v_profile_id IS NULL AND p_phone IS NOT NULL AND btrim(p_phone) <> '' THEN
    SELECT id INTO v_profile_id
    FROM profiles
    WHERE phone = btrim(p_phone)
    LIMIT 1;
  END IF;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('error', 'user_not_found');
  END IF;

  IF v_profile_id = v_uid THEN
    RETURN jsonb_build_object('error', 'cannot_invite_self');
  END IF;

  INSERT INTO operator_members (operator_id, profile_id, role, location_ids)
  VALUES (p_operator_id, v_profile_id, v_role, COALESCE(p_location_ids, '{}'))
  ON CONFLICT (operator_id, profile_id) DO UPDATE
    SET role = EXCLUDED.role,
        location_ids = EXCLUDED.location_ids
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object(
    'success', true,
    'member_id', v_member_id,
    'profile_id', v_profile_id,
    'role', v_role
  );
END;
$$;

CREATE OR REPLACE FUNCTION remove_staff(
  p_operator_id UUID,
  p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_member RECORD;
BEGIN
  IF NOT is_operator_admin(v_uid, p_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  SELECT * INTO v_member
  FROM operator_members
  WHERE id = p_member_id AND operator_id = p_operator_id;

  IF v_member IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_member.role = 'owner' THEN
    RETURN jsonb_build_object('error', 'cannot_remove_owner');
  END IF;
  IF v_member.profile_id = v_uid THEN
    RETURN jsonb_build_object('error', 'cannot_remove_self');
  END IF;

  DELETE FROM operator_members WHERE id = p_member_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION set_staff_can_waive(
  p_operator_id UUID,
  p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT is_operator_admin(v_uid, p_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE operators
  SET staff_can_waive = COALESCE(p_enabled, true)
  WHERE id = p_operator_id;

  RETURN jsonb_build_object('success', true, 'staff_can_waive', COALESCE(p_enabled, true));
END;
$$;

GRANT EXECUTE ON FUNCTION invite_staff(UUID, TEXT, TEXT, operator_role, UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION remove_staff(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_staff_can_waive(UUID, BOOLEAN) TO authenticated, service_role;
