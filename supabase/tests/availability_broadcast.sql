-- Live availability broadcast (migration 0068). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  t0 timestamptz := clock_timestamp();
  m record; n int; r jsonb;
BEGIN
  -- A check-in at a published listing broadcasts its id and pin position, nothing else
  PERFORM pg_temp.act('+639170000003');
  r := start_walk_in(SR, 'car', 'QZ 6801');
  ASSERT r->>'success' = 'true', 'walk-in: ' || r::text;
  SELECT * INTO m FROM realtime.messages
   WHERE topic = 'listing-availability' AND inserted_at >= t0 AND payload->>'id' = SR::text
   ORDER BY inserted_at DESC LIMIT 1;
  ASSERT m.topic IS NOT NULL, 'broadcast sent';
  ASSERT m.event = 'changed' AND m.private = false, 'public event: ' || row_to_json(m)::text;
  ASSERT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m.payload) k) <@ ARRAY['event','id','lat','lng','payload','type']::text[]
    AND m.payload ? 'lat' AND m.payload ? 'lng', 'payload only id/lat/lng: ' || m.payload::text;
  -- Area changes broadcast too (Full switch)
  SELECT COUNT(*) INTO n FROM realtime.messages WHERE topic = 'listing-availability' AND inserted_at >= t0;
  PERFORM set_area_full(main_area_id(SR), true);
  ASSERT (SELECT COUNT(*) FROM realtime.messages WHERE topic = 'listing-availability' AND inserted_at >= t0) > n, 'Full broadcasts';

  -- Unpublished listings never broadcast (after the unpublish itself)
  UPDATE locations SET published = false WHERE id = SR;
  SELECT COUNT(*) INTO n FROM realtime.messages WHERE topic = 'listing-availability' AND inserted_at >= t0;
  PERFORM set_area_full(main_area_id(SR), false);
  ASSERT (SELECT COUNT(*) FROM realtime.messages WHERE topic = 'listing-availability' AND inserted_at >= t0) = n, 'hidden listing silent';
  ASSERT NOT has_function_privilege('anon', 'broadcast_listing_availability()', 'EXECUTE'), 'trigger fn not callable';
END $$;
ROLLBACK;
