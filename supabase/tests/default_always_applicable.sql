-- The default rate is always applicable (migration 0047). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id FROM profiles WHERE phone = p_phone);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;

-- A weekend-only SUV rate does not push the default out of the list
INSERT INTO rates (location_id, name, rate_type, hourly_amount, days_of_week, vehicle_type, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000002', 'T SUV Sat', 'hourly', 80, '{6}', 'suv', true, false);

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  dflt uuid := (SELECT id FROM rates WHERE location_id = '30000000-0000-0000-0000-000000000002' AND is_default);
  suv uuid := (SELECT id FROM rates WHERE name = 'T SUV Sat');
  r jsonb;
BEGIN
  -- Every listing that isn't deleted has exactly one default, and it has no limits
  ASSERT NOT EXISTS (SELECT 1 FROM locations l WHERE l.deleted_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM rates r WHERE r.location_id = l.id AND r.is_default AND r.active
      AND r.vehicle_type IS NULL AND r.area_id IS NULL AND r.slot_id IS NULL)), 'all listings have an all-vehicle default';
  -- Default is in the list for any vehicle and any start
  ASSERT EXISTS (SELECT 1 FROM walk_in_rates(SR, 'motorcycle', '2026-11-09 03:00+08') WHERE id = dflt), 'moto Mon';
  ASSERT EXISTS (SELECT 1 FROM walk_in_rates(SR, 'suv', '2026-11-07 10:00+08') WHERE id = dflt), 'suv Sat';
  ASSERT EXISTS (SELECT 1 FROM walk_in_rates(SR, 'suv', '2026-11-07 10:00+08') WHERE id = suv), 'suv rate Sat';
  ASSERT NOT EXISTS (SELECT 1 FROM walk_in_rates(SR, 'car', '2026-11-07 10:00+08') WHERE id = suv), 'suv rate not for car';
  ASSERT (session_price(SR, 'truck', '2026-11-09 10:00+08', '2026-11-09 12:00+08', NULL)->>'amount')::numeric > 0, 'truck priced';

  PERFORM pg_temp.act('+639170000002');
  ASSERT set_default_rate(suv)->>'error' IN ('default_cannot_have_days', 'default_cannot_have_vehicle'), 'set default refused';
  UPDATE rates SET days_of_week = NULL WHERE id = suv;
  ASSERT set_default_rate(suv)->>'error' = 'default_cannot_have_vehicle', 'vehicle default refused';
  r := upsert_rate(SR, 'Standard Rate', 'hourly', dflt, true, 50, p_vehicle_type => 'car');
  ASSERT r->>'error' = 'default_cannot_have_vehicle', 'edit default vehicle: ' || r::text;
  r := upsert_rate(SR, 'Standard Rate', 'hourly', dflt, true, 50, p_active => false);
  ASSERT r->>'error' = 'default_must_be_active', 'deactivate default: ' || r::text;
  r := upsert_rate(SR, 'Standard Rate', 'hourly', dflt, true, 55);
  ASSERT r->>'success' = 'true', 'plain edit ok: ' || r::text;
  BEGIN
    UPDATE rates SET vehicle_type = 'car' WHERE id = dflt;
    ASSERT false, 'constraint should block';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;


-- Every listing keeps a default: direct deletes/unsets fail at commit.
DO $$
DECLARE v_loc uuid; v_ok boolean := false;
BEGIN
  SELECT location_id INTO v_loc FROM rates WHERE is_default LIMIT 1;
  BEGIN
    DELETE FROM rates WHERE location_id = v_loc AND is_default;
    SET CONSTRAINTS rates_keep_default IMMEDIATE;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  ASSERT v_ok, 'deleting the default must fail';
  v_ok := false;
  BEGIN
    UPDATE rates SET is_default = false WHERE location_id = v_loc AND is_default;
    SET CONSTRAINTS rates_keep_default IMMEDIATE;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  ASSERT v_ok, 'unsetting the default must fail';
  v_ok := false;
  BEGIN
    INSERT INTO locations (operator_id, name, listing_type, geog, address, capacity, available_count)
    SELECT operator_id, 'No default', listing_type, geog, address, 1, 1 FROM locations WHERE id = v_loc;
    SET CONSTRAINTS locations_need_default_rate IMMEDIATE;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  ASSERT v_ok, 'a listing without a default must fail';
  ASSERT EXISTS (SELECT 1 FROM rates WHERE location_id = v_loc AND is_default);
  RAISE NOTICE 'every listing keeps a default: ok';
END $$;

ROLLBACK;
