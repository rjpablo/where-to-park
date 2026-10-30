-- Sidebar counts and the red attention badge on the sidebar toggle.
-- Which conditions light the badge is configured here, in the database only
-- (no UI): flip attention_triggers.enabled with SQL. Default: all enabled.

CREATE TABLE IF NOT EXISTS attention_triggers (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO attention_triggers (key, description) VALUES
  ('unread_messages', 'Unread chat messages for me (driver or operator side)'),
  ('unread_notifications', 'Unread in-app notifications'),
  ('pending_verifications', 'Admins: listings waiting in the verification queue'),
  ('listing_reviewed', 'One of my listings was verified or rejected and I have not seen it'),
  ('profile_incomplete', 'My display name is missing or still the default (phone/email/New user)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE attention_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads attention triggers" ON attention_triggers;
CREATE POLICY "Anyone reads attention triggers"
  ON attention_triggers FOR SELECT USING (TRUE);
GRANT SELECT ON attention_triggers TO anon, authenticated;

-- When the owner last saw a review outcome (verified/rejected) for a listing.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS review_seen_at TIMESTAMPTZ;
-- Outcomes from before this feature count as seen.
UPDATE locations SET review_seen_at = NOW()
WHERE review_seen_at IS NULL
  AND (verification_status = 'verified' OR rejected_at IS NOT NULL);

-- A new outcome (verify or reject) becomes unseen again.
CREATE OR REPLACE FUNCTION reset_review_seen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.verified_at IS DISTINCT FROM OLD.verified_at AND NEW.verified_at IS NOT NULL)
     OR (NEW.rejected_at IS DISTINCT FROM OLD.rejected_at AND NEW.rejected_at IS NOT NULL) THEN
    NEW.review_seen_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_review_seen ON locations;
CREATE TRIGGER trg_reset_review_seen
  BEFORE UPDATE OF verified_at, rejected_at ON locations
  FOR EACH ROW EXECUTE FUNCTION reset_review_seen();

-- Listings whose review outcome I (owner/manager) have not seen yet.
CREATE OR REPLACE FUNCTION my_unseen_reviews(p_uid UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM locations l
  JOIN operator_members om ON om.operator_id = l.operator_id AND om.profile_id = p_uid
  WHERE om.role IN ('owner', 'manager')
    AND l.review_seen_at IS NULL
    AND (l.verification_status = 'verified' OR l.rejected_at IS NOT NULL);
$$;
REVOKE EXECUTE ON FUNCTION my_unseen_reviews(UUID) FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION mark_listing_reviews_seen()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  UPDATE locations SET review_seen_at = NOW()
  WHERE id IN (SELECT my_unseen_reviews(auth.uid()));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'marked', n);
END;
$$;

-- Messages waiting for me: drivers see replies from the listing's side;
-- operator members see messages the driver sent. System events don't count.
CREATE OR REPLACE FUNCTION my_unread_messages(p_uid UUID, p_thread_id UUID DEFAULT NULL)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM chat_messages m
  JOIN chat_threads t ON t.id = m.thread_id
  WHERE m.read_at IS NULL
    AND COALESCE(m.hidden, FALSE) = FALSE
    AND m.kind <> 'system'
    AND m.sender_id IS NOT NULL
    AND (p_thread_id IS NULL OR t.id = p_thread_id)
    AND (
      (t.driver_id = p_uid AND m.sender_id <> p_uid)
      OR (
        t.driver_id <> p_uid
        AND m.sender_id = t.driver_id
        AND EXISTS (
          SELECT 1 FROM operator_members om
          WHERE om.operator_id = t.operator_id
            AND om.profile_id = p_uid
            AND (
              om.role IN ('owner', 'manager')
              OR om.location_ids = '{}'
              OR t.location_id = ANY (om.location_ids)
            )
        )
      )
    );
$$;
REVOKE EXECUTE ON FUNCTION my_unread_messages(UUID, UUID) FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION mark_thread_read(p_thread_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  UPDATE chat_messages SET read_at = NOW()
  WHERE id IN (SELECT my_unread_messages(auth.uid(), p_thread_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'marked', n);
END;
$$;

CREATE OR REPLACE FUNCTION is_profile_incomplete(p profiles)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(COALESCE(p.display_name, '')) = ''
      OR btrim(p.display_name) = 'New user'
      OR btrim(p.display_name) = COALESCE(p.phone, '')
      OR btrim(p.display_name) = '+' || ltrim(COALESCE(p.phone, ''), '+')
      OR p.display_name LIKE '%@%';
$$;

-- One call for the sidebar: per-item counts plus which badge triggers are on.
CREATE OR REPLACE FUNCTION get_sidebar_counts()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_profile profiles;
  v_admin BOOLEAN;
  v_triggers JSONB;
BEGIN
  SELECT COALESCE(jsonb_object_agg(key, enabled), '{}'::JSONB) INTO v_triggers
  FROM attention_triggers;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('signed_in', false, 'triggers', v_triggers);
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  v_admin := COALESCE(v_profile.is_admin, FALSE);

  RETURN jsonb_build_object(
    'signed_in', true,
    'triggers', v_triggers,
    'unread_messages', (SELECT COUNT(*) FROM my_unread_messages(v_uid)),
    'unread_notifications', (
      SELECT COUNT(*) FROM notifications WHERE recipient_id = v_uid AND read_at IS NULL
    ),
    'pending_verifications', CASE WHEN v_admin THEN (
      SELECT COUNT(*) FROM locations
      WHERE verification_status = 'unverified' AND rejected_at IS NULL
    ) ELSE 0 END,
    'pending_reports', CASE WHEN v_admin THEN (
      SELECT COUNT(*) FROM reports WHERE status = 'pending'
    ) ELSE 0 END,
    'listing_reviewed', (SELECT COUNT(*) FROM my_unseen_reviews(v_uid)),
    'listings', (
      SELECT COUNT(DISTINCT l.id) FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id AND om.profile_id = v_uid
      WHERE om.role IN ('owner', 'manager')
         OR om.location_ids = '{}'
         OR l.id = ANY (om.location_ids)
    ),
    'vehicles', (SELECT COUNT(*) FROM vehicles WHERE driver_id = v_uid),
    'profile_incomplete', CASE
      WHEN v_profile.id IS NOT NULL AND is_profile_incomplete(v_profile) THEN 1 ELSE 0 END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION mark_listing_reviews_seen() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_thread_read(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_sidebar_counts() TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION mark_listing_reviews_seen() FROM anon, public;
REVOKE EXECUTE ON FUNCTION mark_thread_read(UUID) FROM anon, public;

NOTIFY pgrst, 'reload schema';
