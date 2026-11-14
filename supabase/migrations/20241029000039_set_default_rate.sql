-- Operators choose which rate is a listing's default (rj: "Operators should be able to
-- set a default rate").
--
-- quote_price uses the default as the general location rate (after dated, slot, area
-- and vehicle-specific rates) and as the last-resort fallback, which ignores type and
-- dates. So the default must be an active, undated, non-monthly rate (a monthly
-- default would quote ₱0; a dated one would also price days outside its dates).

-- 1. At most one default per listing. Older data could hold several (nothing prevented
--    it); keep the oldest default per listing and unset the rest before indexing.
UPDATE rates r
   SET is_default = false
 WHERE r.is_default
   AND EXISTS (
     SELECT 1 FROM rates o
      WHERE o.location_id = r.location_id
        AND o.is_default
        AND (o.created_at, o.id) < (r.created_at, r.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS rates_one_default_per_location
  ON rates (location_id) WHERE is_default;

-- 2. Make a rate its listing's default; the old default is unset in the same
--    transaction (unset first, so the unique index never sees two).
CREATE OR REPLACE FUNCTION public.set_default_rate(p_rate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rate RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT r.*, l.operator_id
    INTO v_rate
    FROM rates r
    JOIN locations l ON l.id = r.location_id
   WHERE r.id = p_rate_id
     FOR UPDATE OF r;

  IF v_rate IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT is_operator_admin(v_uid, v_rate.operator_id) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_rate.is_default THEN
    RETURN jsonb_build_object('success', true, 'rate_id', v_rate.id, 'unchanged', true);
  END IF;
  IF v_rate.rate_type = 'monthly' THEN
    RETURN jsonb_build_object('error', 'A monthly rate can''t be the default');
  END IF;
  IF v_rate.effective_from IS NOT NULL OR v_rate.effective_to IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'A rate with dates can''t be the default');
  END IF;
  IF NOT v_rate.active THEN
    RETURN jsonb_build_object('error', 'An inactive rate can''t be the default');
  END IF;

  -- Serialise concurrent changes for this listing.
  PERFORM 1 FROM locations WHERE id = v_rate.location_id FOR UPDATE;

  UPDATE rates SET is_default = false
   WHERE location_id = v_rate.location_id AND is_default AND id <> p_rate_id;
  UPDATE rates SET is_default = true WHERE id = p_rate_id;

  RETURN jsonb_build_object('success', true, 'rate_id', p_rate_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_rate(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
