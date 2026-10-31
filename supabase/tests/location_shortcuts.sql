-- Location shortcuts (migration 0053). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;
DO $$
DECLARE
  a uuid := '30000000-0000-0000-0000-000000000002';
  b uuid := '30000000-0000-0000-0000-000000000005';
  me uuid := (SELECT id FROM profiles WHERE phone = '+639170000001');
  ids uuid[];
BEGIN
  PERFORM pg_temp.act('+639170000001');
  DELETE FROM location_shortcuts WHERE user_id = me;
  ASSERT add_location_shortcut(a)->>'success' = 'true', 'add a';
  ASSERT add_location_shortcut(b)->>'success' = 'true', 'add b';
  ASSERT add_location_shortcut(a)->>'success' = 'true', 'add a again';
  SELECT array_agg(location_id ORDER BY position) INTO ids FROM location_shortcuts WHERE user_id = me;
  ASSERT ids = ARRAY[a, b], 'appended at the bottom: ' || ids::text;
  ASSERT reorder_location_shortcuts(ARRAY[b, a])->>'success' = 'true', 'reorder';
  SELECT array_agg(location_id ORDER BY position) INTO ids FROM location_shortcuts WHERE user_id = me;
  ASSERT ids = ARRAY[b, a], 'reordered';
  ASSERT add_location_shortcut(gen_random_uuid())->>'error' = 'not_found', 'missing listing';
  -- Another user sees none of them and can't touch them
  PERFORM pg_temp.act('+639170000002');
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM location_shortcuts WHERE user_id = me), 'rls hides (role)';
  DELETE FROM location_shortcuts WHERE user_id = me;
  RESET ROLE;
  ASSERT (SELECT count(*) FROM location_shortcuts WHERE user_id = me) = 2, 'not deleted by others';
END $$;
ROLLBACK;
