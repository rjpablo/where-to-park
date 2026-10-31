-- 🟧 Review photos: a review's author can attach up to 5 images (a default, see
-- review_photo_limit()). Same pattern as chat images: the client uploads the bytes to
-- Storage (bucket review-photos, path '<review_id>/<file>'), then records the path with
-- register_review_photo(). Everyone can read; only the review's author can add or
-- remove its images. Rows go away with their review (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS review_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_photos_review ON review_photos(review_id, sort_order);

ALTER TABLE review_photos ENABLE ROW LEVEL SECURITY;

-- Visible when the review is (not hidden, listing published and not deleted), and
-- always to the author.
DROP POLICY IF EXISTS "Review photos readable with their review" ON review_photos;
CREATE POLICY "Review photos readable with their review"
  ON review_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM reviews r
      JOIN locations l ON l.id = r.location_id
      WHERE r.id = review_photos.review_id
        AND (
          r.author_id = auth.uid()
          OR (NOT COALESCE(r.hidden, false) AND l.published AND l.deleted_at IS NULL)
        )
    )
  );

DROP POLICY IF EXISTS "Authors delete their review photos" ON review_photos;
CREATE POLICY "Authors delete their review photos"
  ON review_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM reviews r WHERE r.id = review_photos.review_id AND r.author_id = auth.uid())
  );

GRANT SELECT ON review_photos TO anon, authenticated;
GRANT DELETE ON review_photos TO authenticated;

-- Default cap per review (change here; the app reads it from register's error).
CREATE OR REPLACE FUNCTION review_photo_limit()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 5 $$;

CREATE OR REPLACE FUNCTION register_review_photo(p_review_id UUID, p_filename TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_review RECORD;
  v_count INTEGER;
  v_path TEXT;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  -- Lock the review so two uploads can't both pass the count check.
  SELECT * INTO v_review FROM reviews WHERE id = p_review_id FOR UPDATE;
  IF v_review IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_review.author_id <> v_uid THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_path := p_review_id::TEXT || '/' ||
    regexp_replace(COALESCE(NULLIF(btrim(p_filename), ''), 'photo.jpg'), '[^A-Za-z0-9._-]', '_', 'g');
  IF EXISTS (SELECT 1 FROM review_photos WHERE storage_path = v_path) THEN
    SELECT id INTO v_id FROM review_photos WHERE storage_path = v_path;
    RETURN jsonb_build_object('success', true, 'photo_id', v_id, 'storage_path', v_path);
  END IF;
  SELECT COUNT(*) INTO v_count FROM review_photos WHERE review_id = p_review_id;
  IF v_count >= review_photo_limit() THEN
    RETURN jsonb_build_object('error', 'too_many_photos', 'limit', review_photo_limit());
  END IF;
  INSERT INTO review_photos (review_id, storage_path, sort_order)
  VALUES (p_review_id, v_path, v_count)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'photo_id', v_id, 'storage_path', v_path);
END;
$$;

REVOKE EXECUTE ON FUNCTION register_review_photo(UUID, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION register_review_photo(UUID, TEXT) TO authenticated, service_role;

-- Storage: public bucket; writes only under the caller's own review id.
INSERT INTO storage.buckets (id, name)
VALUES ('review-photos', 'review-photos')
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  UPDATE storage.buckets SET public = true WHERE id = 'review-photos';
EXCEPTION WHEN undefined_column THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION is_review_author_path(p_name TEXT, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM reviews r
    WHERE r.id::text = split_part(p_name, '/', 1) AND r.author_id = p_uid
  )
$$;
GRANT EXECUTE ON FUNCTION is_review_author_path(TEXT, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "review_photos_public_read" ON storage.objects;
CREATE POLICY "review_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'review-photos');

DROP POLICY IF EXISTS "review_photos_author_insert" ON storage.objects;
CREATE POLICY "review_photos_author_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'review-photos' AND is_review_author_path(name, auth.uid()));

DROP POLICY IF EXISTS "review_photos_author_update" ON storage.objects;
CREATE POLICY "review_photos_author_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'review-photos' AND is_review_author_path(name, auth.uid()))
  WITH CHECK (bucket_id = 'review-photos' AND is_review_author_path(name, auth.uid()));

DROP POLICY IF EXISTS "review_photos_author_delete" ON storage.objects;
CREATE POLICY "review_photos_author_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'review-photos' AND is_review_author_path(name, auth.uid()));
