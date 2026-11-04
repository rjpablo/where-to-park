-- 0082 Staff invites don't reveal whether an account exists (rj t181u: "Regarding inviting
-- a staff by email that doesn't exist, don't tell them if an account was found ... allow
-- them to resend the invite after 3mins").
--
-- Before: invite_staff answered user_not_found for an unknown email/phone and added a known
-- account to the team at once (so it showed up in Members) — both told the inviter whether
-- the account exists.
-- Now:
--   * invite_staff always answers {success, sent_to, resend_after_seconds: 180} for a valid
--     request, account or not. Genuine errors (not signed in, not an owner/manager, owner
--     role, missing or badly formed email, inviting yourself) never depend on the account.
--   * Known account, not on the team yet: a PENDING invite + an in-app/push notification
--     ("You're invited to join <team> as staff") with Accept / Decline. They join the team
--     only when they accept, so Members does not change until then.
--   * Already on the team (the inviter can see Members anyway): nothing changes (fix: a
--     re-invite used to overwrite their role and listings).
--   * Unknown account: nothing visible happens (only the server-side cooldown row below).
--   * Resend cooldown: 3 minutes per inviter + team + email/phone, enforced here for every
--     target (account or not): {error: 'cooldown', retry_after_seconds}.
-- staff_invites is server-only (no client grants); invitees act through the RPCs below.

CREATE TABLE IF NOT EXISTS public.staff_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,                 -- 'email:<lower email>' or 'phone:<phone>'
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL = no account
  role operator_role NOT NULL DEFAULT 'staff',
  location_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (operator_id, invited_by, target_key)
);
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_invites FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS staff_invites_profile_idx ON public.staff_invites (profile_id) WHERE profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.invite_staff(
  p_operator_id UUID, p_email TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL,
  p_role operator_role DEFAULT 'staff', p_location_ids UUID[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  v_phone TEXT := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_key TEXT;
  v_role operator_role := COALESCE(p_role, 'staff');
  v_locs UUID[] := COALESCE(p_location_ids, '{}');
  v_inv staff_invites%ROWTYPE;
  v_profile UUID;
  v_member operator_members%ROWTYPE;
  v_op TEXT;
  v_wait INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT is_operator_admin(v_uid, p_operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_role = 'owner' THEN
    RETURN jsonb_build_object('error', 'cannot_invite_owner');
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RETURN jsonb_build_object('error', 'email_or_phone_required');
  END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RETURN jsonb_build_object('error', 'invalid_email');
  END IF;
  IF v_email IS NULL AND v_phone !~ '^\+?[0-9 ()-]{7,20}$' THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;
  -- Yourself: you already know your own account, so this reveals nothing.
  IF (v_email IS NOT NULL AND v_email = (SELECT lower(email) FROM auth.users WHERE id = v_uid))
     OR (v_email IS NULL AND v_phone = (SELECT phone FROM profiles WHERE id = v_uid)) THEN
    RETURN jsonb_build_object('error', 'cannot_invite_self');
  END IF;
  v_key := CASE WHEN v_email IS NOT NULL THEN 'email:' || v_email ELSE 'phone:' || v_phone END;

  -- 3-minute resend cooldown, the same for every target.
  SELECT * INTO v_inv FROM staff_invites
   WHERE operator_id = p_operator_id AND invited_by = v_uid AND target_key = v_key FOR UPDATE;
  IF v_inv.id IS NOT NULL AND v_inv.last_sent_at > NOW() - INTERVAL '3 minutes' THEN
    v_wait := CEIL(EXTRACT(EPOCH FROM (v_inv.last_sent_at + INTERVAL '3 minutes' - NOW())))::INT;
    RETURN jsonb_build_object('error', 'cooldown', 'retry_after_seconds', GREATEST(v_wait, 1));
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT p.id INTO v_profile FROM profiles p JOIN auth.users u ON u.id = p.id
     WHERE lower(u.email) = v_email LIMIT 1;
  ELSE
    SELECT id INTO v_profile FROM profiles WHERE phone = v_phone LIMIT 1;
  END IF;

  INSERT INTO staff_invites AS s (operator_id, invited_by, target_key, profile_id, role, location_ids, status, last_sent_at)
  VALUES (p_operator_id, v_uid, v_key, v_profile, v_role, v_locs,
          CASE WHEN v_profile IS NULL THEN 'none' ELSE 'pending' END, NOW())
  ON CONFLICT (operator_id, invited_by, target_key) DO UPDATE
    SET profile_id = EXCLUDED.profile_id, role = EXCLUDED.role, location_ids = EXCLUDED.location_ids,
        status = EXCLUDED.status, last_sent_at = NOW(), responded_at = NULL
  RETURNING * INTO v_inv;

  IF v_profile IS NOT NULL THEN
    SELECT * INTO v_member FROM operator_members
     WHERE operator_id = p_operator_id AND profile_id = v_profile;
    IF v_member.id IS NOT NULL THEN
      -- Already on the team (visible in Members): nothing changes. (Before 0082 a re-invite
      -- overwrote role and listings, e.g. a manager re-invited from the app became staff
      -- for all listings.)
      UPDATE staff_invites SET status = 'accepted', responded_at = NOW() WHERE id = v_inv.id;
    ELSE
      SELECT NULLIF(btrim(display_name), '') INTO v_op FROM operators WHERE id = p_operator_id;
      INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, data)
      VALUES (v_profile, 'staff_added',
              'You''re invited to join ' || COALESCE(v_op, 'a parking team') || ' as ' || v_role::TEXT,
              'Accept to start helping with ' ||
                CASE WHEN v_locs = '{}' THEN 'all its listings'
                     ELSE (SELECT string_agg(name, ', ' ORDER BY name) FROM locations
                            WHERE id = ANY (v_locs) AND deleted_at IS NULL) END,
              'staff_invite', v_inv.id,
              jsonb_build_object('invite_id', v_inv.id, 'operator_id', p_operator_id,
                                 'role', v_role, 'audience', 'invitee'));
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true,
    'sent_to', COALESCE(v_email, v_phone), 'resend_after_seconds', 180);
END;
$$;
REVOKE ALL ON FUNCTION public.invite_staff(UUID, TEXT, TEXT, operator_role, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_staff(UUID, TEXT, TEXT, operator_role, UUID[]) TO authenticated;

-- The invitee answers. Only the invited account can; marks its invite notifications done.
CREATE OR REPLACE FUNCTION public.respond_staff_invite(p_invite_id UUID, p_accept BOOLEAN)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv staff_invites%ROWTYPE;
  v_status TEXT := CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT * INTO v_inv FROM staff_invites WHERE id = p_invite_id AND profile_id = v_uid FOR UPDATE;
  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_inv.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'already_answered', 'status', v_inv.status);
  END IF;
  IF p_accept THEN
    INSERT INTO operator_members (operator_id, profile_id, role, location_ids)
    VALUES (v_inv.operator_id, v_uid, v_inv.role, v_inv.location_ids)
    ON CONFLICT (operator_id, profile_id) DO NOTHING;
  END IF;
  UPDATE staff_invites SET status = v_status, responded_at = NOW() WHERE id = v_inv.id;
  UPDATE notifications SET read_at = COALESCE(read_at, NOW()),
         data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('status', v_status)
   WHERE recipient_id = v_uid AND ref_type = 'staff_invite' AND ref_id = v_inv.id;
  RETURN jsonb_build_object('success', true, 'status', v_status, 'operator_id', v_inv.operator_id);
END;
$$;
REVOKE ALL ON FUNCTION public.respond_staff_invite(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_staff_invite(UUID, BOOLEAN) TO authenticated;

UPDATE public.push_settings
   SET description = 'The person invited to a team (accept / decline), or added to it'
 WHERE type = 'staff_added';
