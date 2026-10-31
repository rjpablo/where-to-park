-- 0053: location shortcuts (rj). A signed-in user's shortcuts to listing details,
-- in their own order (position). Guests keep theirs on the device (app side).
CREATE TABLE IF NOT EXISTS public.location_shortcuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, location_id)
);
CREATE INDEX IF NOT EXISTS location_shortcuts_user_pos ON public.location_shortcuts (user_id, position);

ALTER TABLE public.location_shortcuts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own shortcuts" ON public.location_shortcuts;
CREATE POLICY "Own shortcuts" ON public.location_shortcuts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.location_shortcuts FROM anon;
GRANT SELECT, DELETE ON public.location_shortcuts TO authenticated;

-- Add at the bottom (idempotent: an existing shortcut keeps its place).
CREATE OR REPLACE FUNCTION public.add_location_shortcut(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM locations WHERE id = p_location_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  -- One writer per user at a time, so positions stay unique.
  PERFORM pg_advisory_xact_lock(hashtext('location_shortcuts:' || v_uid::text));
  INSERT INTO location_shortcuts (user_id, location_id, position)
  SELECT v_uid, p_location_id, COALESCE(MAX(position), 0) + 1
    FROM location_shortcuts WHERE user_id = v_uid
  ON CONFLICT (user_id, location_id) DO NOTHING;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.add_location_shortcut(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_location_shortcut(uuid) TO authenticated;

-- Save a new order: p_location_ids lists the user's shortcuts top to bottom; any
-- of theirs not listed keep their relative order after the listed ones.
CREATE OR REPLACE FUNCTION public.reorder_location_shortcuts(p_location_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('location_shortcuts:' || v_uid::text));
  WITH ordered AS (
    SELECT s.id,
           row_number() OVER (ORDER BY COALESCE(array_position(p_location_ids, s.location_id), 2147483647),
                                       s.position, s.created_at) AS pos
      FROM location_shortcuts s
     WHERE s.user_id = v_uid
  )
  UPDATE location_shortcuts s SET position = o.pos FROM ordered o WHERE s.id = o.id;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.reorder_location_shortcuts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_location_shortcuts(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
