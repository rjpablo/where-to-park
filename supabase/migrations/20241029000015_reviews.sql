-- Location reviews (Booked via app) and operator driver reviews.
-- Driver reviews are visible to any operator who currently has a stay
-- with that driver — including reviews written by other operators.

UPDATE reviews r
SET session_id = s.id
FROM parking_sessions s
WHERE r.session_id IS NULL
  AND s.location_id = r.location_id
  AND s.driver_id = r.author_id;

UPDATE reviews r
SET reservation_id = res.id
FROM reservations res
WHERE r.reservation_id IS NULL
  AND res.location_id = r.location_id
  AND res.driver_id = r.author_id;

CREATE UNIQUE INDEX IF NOT EXISTS driver_reviews_session_author
  ON driver_reviews (session_id, author_id)
  WHERE session_id IS NOT NULL;

DROP POLICY IF EXISTS "Operators read driver reviews during a stay" ON driver_reviews;
CREATE POLICY "Operators read driver reviews during a stay"
  ON driver_reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM operator_members om
      JOIN locations l ON l.operator_id = om.operator_id
      WHERE om.profile_id = auth.uid()
        AND driver_has_stay(l.id, driver_reviews.driver_id)
    )
  );

DROP POLICY IF EXISTS "Operators review drivers from a session" ON driver_reviews;
CREATE POLICY "Operators review drivers from a session"
  ON driver_reviews FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND session_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM parking_sessions s
      JOIN locations l ON l.id = s.location_id
      JOIN operator_members om
        ON om.operator_id = l.operator_id
       AND om.profile_id = auth.uid()
      WHERE s.id = driver_reviews.session_id
        AND s.driver_id = driver_reviews.driver_id
    )
  );

CREATE OR REPLACE FUNCTION submit_location_review(
  p_location_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
  v_session UUID;
  v_reservation UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('error', 'invalid_rating');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM locations WHERE id = p_location_id AND published = true) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT id INTO v_session
  FROM parking_sessions
  WHERE location_id = p_location_id AND driver_id = v_uid
  ORDER BY started_at DESC
  LIMIT 1;

  SELECT id INTO v_reservation
  FROM reservations
  WHERE location_id = p_location_id AND driver_id = v_uid
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO reviews (location_id, author_id, rating, comment, session_id, reservation_id)
  VALUES (p_location_id, v_uid, p_rating, NULLIF(btrim(COALESCE(p_comment, '')), ''), v_session, v_reservation)
  ON CONFLICT (location_id, author_id) DO UPDATE
    SET rating = EXCLUDED.rating,
        comment = EXCLUDED.comment,
        session_id = COALESCE(reviews.session_id, EXCLUDED.session_id),
        reservation_id = COALESCE(reviews.reservation_id, EXCLUDED.reservation_id),
        updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'review_id', v_id,
    'booked_via_app', (v_session IS NOT NULL OR v_reservation IS NOT NULL)
  );
END;
$$;

CREATE OR REPLACE FUNCTION submit_driver_review(
  p_session_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_session RECORD;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('error', 'invalid_rating');
  END IF;

  SELECT s.*, l.operator_id
  INTO v_session
  FROM parking_sessions s
  JOIN locations l ON l.id = s.location_id
  WHERE s.id = p_session_id;

  IF v_session IS NULL OR v_session.driver_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_member(v_uid, v_session.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;

  INSERT INTO driver_reviews (
    driver_id, operator_id, location_id, session_id, author_id, rating, comment
  ) VALUES (
    v_session.driver_id,
    v_session.operator_id,
    v_session.location_id,
    p_session_id,
    v_uid,
    p_rating,
    NULLIF(btrim(COALESCE(p_comment, '')), '')
  )
  ON CONFLICT (session_id, author_id) WHERE session_id IS NOT NULL DO UPDATE
    SET rating = EXCLUDED.rating,
        comment = EXCLUDED.comment
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'review_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_location_review(UUID, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION submit_driver_review(UUID, INTEGER, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
