-- Admins can reject a listing from the verification queue (spec: "marks
-- Verified, or unpublishes"). Rejecting unpublishes it, records who/when/why and
-- takes it out of the queue. Republishing a rejected listing puts it back in.

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_locations_verification_queue
  ON locations(created_at)
  WHERE verification_status = 'unverified' AND rejected_at IS NULL;

CREATE OR REPLACE FUNCTION reject_location(p_location_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE locations
  SET published = FALSE,
      rejected_at = NOW(),
      rejected_by = auth.uid(),
      rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = p_location_id AND verification_status = 'unverified';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Verifying clears any earlier rejection.
CREATE OR REPLACE FUNCTION verify_location(p_location_id UUID)
RETURNS JSONB AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  UPDATE locations
  SET
    verification_status = 'verified',
    verified_by = auth.uid(),
    verified_at = NOW(),
    rejected_at = NULL,
    rejected_by = NULL,
    rejection_reason = NULL
  WHERE id = p_location_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Operator republishes a rejected listing: it goes back into the queue.
CREATE OR REPLACE FUNCTION clear_rejection_on_republish()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.published IS TRUE AND OLD.published IS DISTINCT FROM TRUE
     AND NEW.rejected_at IS NOT NULL AND NEW.rejected_at = OLD.rejected_at THEN
    NEW.rejected_at := NULL;
    NEW.rejected_by := NULL;
    NEW.rejection_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_rejection_on_republish ON locations;
CREATE TRIGGER trg_clear_rejection_on_republish
  BEFORE UPDATE OF published ON locations
  FOR EACH ROW EXECUTE FUNCTION clear_rejection_on_republish();

REVOKE EXECUTE ON FUNCTION reject_location(UUID, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION reject_location(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION verify_location(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
