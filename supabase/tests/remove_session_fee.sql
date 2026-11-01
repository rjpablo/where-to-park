-- Remove an applied extra fee from an open session (migration 0063). Rolls back.
BEGIN;
CREATE FUNCTION pg_temp.act_id(v uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.act(p_phone text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.act_id((SELECT id FROM profiles WHERE phone = p_phone)); END $$;

DO $$
DECLARE
  SR uuid := '30000000-0000-0000-0000-000000000002';
  preset uuid := (SELECT id FROM fee_presets WHERE location_id = SR AND active ORDER BY created_at LIMIT 1);
  outsider uuid;
  r jsonb; s uuid; c1 uuid; c2 uuid; bal0 numeric; bal1 numeric;
BEGIN
  SELECT p.id INTO outsider FROM profiles p
   WHERE NOT can_work_location(SR, p.id) AND NOT is_admin(p.id) LIMIT 1;
  ASSERT preset IS NOT NULL, 'needs a fee preset at Session Road';

  PERFORM pg_temp.act('+639170000002'); -- Juan (owner)
  r := start_walk_in(SR, 'car', 'QZ 7101', NULL, NULL, now() - interval '30 minutes');
  ASSERT r->>'success' = 'true', 'start: ' || r::text;
  s := (r->>'session_id')::uuid;
  bal0 := (session_details(s)->>'balance')::numeric;
  c1 := (apply_fee_preset(s, preset)->>'charge_id')::uuid;
  c2 := (apply_fee_preset(s, preset)->>'charge_id')::uuid;
  ASSERT (session_details(s)->>'balance')::numeric = bal0 + 2 * (SELECT amount FROM fee_presets WHERE id = preset), 'two fees added';

  -- Outsider and anonymous: refused
  IF outsider IS NOT NULL THEN
    PERFORM pg_temp.act_id(outsider);
    r := remove_session_fee(s, c1);
    ASSERT r->>'error' = 'Permission denied', 'outsider: ' || r::text;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  r := remove_session_fee(s, c1);
  ASSERT r->>'error' = 'not_authenticated', 'anon: ' || r::text;

  -- Staff (Ana) removes one: voided with who, balance recalculated
  PERFORM pg_temp.act('+639170000003');
  r := remove_session_fee(s, c1);
  ASSERT r->>'success' = 'true', 'staff remove: ' || r::text;
  ASSERT (SELECT voided_at IS NOT NULL AND voided_by = auth.uid() FROM folio_charges WHERE id = c1), 'voided with who';
  bal1 := (session_details(s)->>'balance')::numeric;
  ASSERT bal1 = bal0 + (SELECT amount FROM fee_presets WHERE id = preset), 'balance drops by the fee';
  ASSERT (r->>'balance')::numeric = bal1, 'returns new balance';
  ASSERT jsonb_array_length(session_details(s)->'charges') = 1, 'one fee listed';
  -- Twice: not found; wrong session: not found
  r := remove_session_fee(s, c1);
  ASSERT r->>'error' = 'fee_not_found', 'twice: ' || r::text;

  -- Paid more than due after removal: allowed, balance goes negative (credit)
  r := record_session_payment(s, bal1, 'cash', NULL);
  ASSERT r->>'success' = 'true', 'pay: ' || r::text;
  r := remove_session_fee(s, c2);
  ASSERT r->>'success' = 'true', 'remove after paid: ' || r::text;
  ASSERT (r->>'balance')::numeric < 0, 'credit (negative balance): ' || r::text;

  -- Parking fee is not removable through this
  ASSERT remove_session_fee(s, (SELECT c.id FROM folio_charges c JOIN folios f ON f.id = c.folio_id
    WHERE f.session_id = s AND c.type = 'parking_fee' LIMIT 1))->>'error' IN ('fee_not_found') OR NOT EXISTS (
    SELECT 1 FROM folio_charges c JOIN folios f ON f.id = c.folio_id WHERE f.session_id = s AND c.type = 'parking_fee'), 'parking fee kept';

  -- Closed session: refused
  c1 := (apply_fee_preset(s, preset)->>'charge_id')::uuid;
  UPDATE parking_sessions SET status = 'ended', ended_at = now() WHERE id = s;
  r := remove_session_fee(s, c1);
  ASSERT r->>'error' = 'session_closed', 'closed: ' || r::text;
END $$;
ROLLBACK;
