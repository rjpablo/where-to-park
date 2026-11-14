-- 0068 Live availability on Parking Search and Location details (rj t143u).
-- Whenever a published listing's availability caches change (every session check-in /
-- end / edit, every area setting, Reserved/Unavailable or Full change goes through
-- refresh_location_availability, 0067) or it is published / unpublished / deleted, send
-- a tiny public Realtime broadcast: topic 'listing-availability', event 'changed',
-- payload { id, lat, lng }. Only the listing id and its (already public) pin position:
-- no counts, no private columns; unpublished listings never broadcast. Clients then
-- re-read the numbers through the one source (search_nearby / free_spaces), so RLS and
-- the free-spaces rules stay on the server. A broadcast instead of postgres_changes: no
-- table in the publication, no per-subscriber RLS check per row change, and no row data
-- on the wire.
CREATE OR REPLACE FUNCTION broadcast_listing_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.published AND NEW.deleted_at IS NULL)
     OR (TG_OP = 'UPDATE' AND OLD.published AND OLD.deleted_at IS NULL) THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('id', NEW.id,
          'lat', ST_Y(NEW.geog::geometry), 'lng', ST_X(NEW.geog::geometry)),
        'changed', 'listing-availability', false);
    EXCEPTION WHEN OTHERS THEN
      -- Live updates are best effort: never fail a check-in because of them.
      NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION broadcast_listing_availability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS locations_broadcast_availability ON locations;
CREATE TRIGGER locations_broadcast_availability
  AFTER UPDATE OF available_count, marked_full, capacity, manual_reserved_count,
    unavailable_count, availability_updated_at, published, deleted_at, geog
  ON locations FOR EACH ROW EXECUTE FUNCTION broadcast_listing_availability();
