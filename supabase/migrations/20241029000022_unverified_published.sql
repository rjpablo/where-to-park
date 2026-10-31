-- Spec F1/F3: published listings go live as Unverified and stay visible to
-- guests with an Unverified badge. RLS already keys off published, not
-- verification_status; restating the policy so tests and search_nearby match.

DROP POLICY IF EXISTS "Published locations viewable by all" ON locations;
CREATE POLICY "Published locations viewable by all"
  ON locations FOR SELECT
  USING (published = true);

NOTIFY pgrst, 'reload schema';
