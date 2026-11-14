-- 0048: deactivate / activate / archive rates (rj, pt98u).
-- * Non-default rates can be deactivated and re-activated (reuses rates.active).
--   Inactive rates are never applicable: walk_in_rates, quote_price and
--   rate_in_effect_at already require active = true, so check-in, the rate
--   dropdown, automatic pricing, the price preview and session edits skip them.
-- * Deactivating is refused while an active/overdue session (started or
--   future-start) has that rate chosen ('rate_in_use', with the count). A
--   trigger backs this for any write path.
-- * An inactive rate can be archived (archived_at): a soft delete, hidden from
--   the Rates screen, kept for past sessions. Archived rates can't be
--   re-activated (no un-archive UI).
-- * The default can't be deactivated, archived or deleted.
-- * delete_rate now refuses rates that any session references
--   ('rate_has_sessions'); the app no longer offers Delete (Archive replaces it).

ALTER TABLE rates ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_archived_inactive;
ALTER TABLE rates ADD CONSTRAINT rates_archived_inactive
  CHECK (archived_at IS NULL OR (active IS FALSE AND NOT is_default));

CREATE OR REPLACE FUNCTION public.rate_open_session_count(p_rate_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int
    FROM parking_sessions
   WHERE rate_id = p_rate_id
     AND status IN ('active', 'overdue');
$$;
REVOKE ALL ON FUNCTION public.rate_open_session_count(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rates_guard_deactivate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(OLD.active, false) AND NOT COALESCE(NEW.active, false)
     AND rate_open_session_count(NEW.id) > 0 THEN
    RAISE EXCEPTION 'rate_in_use' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND COALESCE(NEW.active, false) THEN
    RAISE EXCEPTION 'rate_archived' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rates_guard_deactivate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rates_guard_deactivate ON rates;
CREATE TRIGGER rates_guard_deactivate
  BEFORE UPDATE OF active ON rates
  FOR EACH ROW EXECUTE FUNCTION public.rates_guard_deactivate();

CREATE OR REPLACE FUNCTION public.set_rate_active(p_rate_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rate record;
  v_open int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF p_active IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_input');
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
  IF v_rate.is_default THEN
    RETURN jsonb_build_object('error', 'cannot_deactivate_default');
  END IF;
  IF v_rate.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'rate_archived');
  END IF;
  IF NOT p_active THEN
    v_open := rate_open_session_count(p_rate_id);
    IF v_open > 0 THEN
      RETURN jsonb_build_object('error', 'rate_in_use', 'sessions', v_open);
    END IF;
  END IF;
  UPDATE rates SET active = p_active WHERE id = p_rate_id;
  RETURN jsonb_build_object('success', true, 'active', p_active);
END;
$$;
REVOKE ALL ON FUNCTION public.set_rate_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_rate_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_rate(p_rate_id uuid)
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
  IF v_rate.is_default THEN
    RETURN jsonb_build_object('error', 'cannot_archive_default');
  END IF;
  IF v_rate.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'archived', true);
  END IF;
  IF COALESCE(v_rate.active, false) THEN
    RETURN jsonb_build_object('error', 'archive_needs_inactive');
  END IF;
  UPDATE rates SET archived_at = now() WHERE id = p_rate_id;
  RETURN jsonb_build_object('success', true, 'archived', true);
END;
$$;
REVOKE ALL ON FUNCTION public.archive_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_rate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_rate(p_rate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rate RECORD;
BEGIN
  SELECT r.*, l.operator_id
    INTO v_rate
    FROM rates r
    JOIN locations l ON l.id = r.location_id
   WHERE r.id = p_rate_id;

  IF v_rate IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_rate.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_rate.is_default THEN
    RETURN jsonb_build_object('error', 'cannot_delete_default');
  END IF;
  IF EXISTS (SELECT 1 FROM parking_sessions WHERE rate_id = p_rate_id) THEN
    RETURN jsonb_build_object('error', 'rate_has_sessions');
  END IF;

  DELETE FROM rates WHERE id = p_rate_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
