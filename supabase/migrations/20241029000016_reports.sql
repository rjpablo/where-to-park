-- Users report a listing or review; admins resolve, dismiss, or hide it.

DROP POLICY IF EXISTS "Admins can update reports" ON reports;
CREATE POLICY "Admins can update reports"
  ON reports FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE OR REPLACE FUNCTION submit_report(
  p_target_type TEXT,
  p_target_id UUID,
  p_reason TEXT,
  p_details TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
  v_type report_target_type;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'reason_required');
  END IF;
  BEGIN
    v_type := p_target_type::report_target_type;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'invalid_target');
  END;
  IF v_type NOT IN ('location', 'review') THEN
    RETURN jsonb_build_object('error', 'invalid_target');
  END IF;
  IF v_type = 'location' AND NOT EXISTS (SELECT 1 FROM locations WHERE id = p_target_id) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_type = 'review' AND NOT EXISTS (SELECT 1 FROM reviews WHERE id = p_target_id) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  INSERT INTO reports (target_type, target_id, reporter_id, reason, details)
  VALUES (v_type, p_target_id, v_uid, btrim(p_reason), NULLIF(btrim(COALESCE(p_details, '')), ''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'report_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION resolve_report(p_report_id UUID, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_report RECORD;
  v_status report_status;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND is_admin = true) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT * INTO v_report FROM reports WHERE id = p_report_id;
  IF v_report IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF p_action = 'hide' THEN
    IF v_report.target_type = 'review' THEN
      UPDATE reviews SET hidden = true, updated_at = NOW() WHERE id = v_report.target_id;
    ELSIF v_report.target_type = 'location' THEN
      UPDATE locations SET published = false, updated_at = NOW() WHERE id = v_report.target_id;
    END IF;
    v_status := 'resolved';
  ELSIF p_action = 'dismiss' THEN
    v_status := 'dismissed';
  ELSIF p_action = 'resolve' THEN
    v_status := 'resolved';
  ELSE
    RETURN jsonb_build_object('error', 'invalid_action');
  END IF;

  UPDATE reports
  SET status = v_status, resolved_by = v_uid, resolved_at = NOW()
  WHERE id = p_report_id;

  RETURN jsonb_build_object('success', true, 'status', v_status, 'action', p_action);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_report(TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolve_report(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
