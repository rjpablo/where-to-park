-- 0054: a session keeps one set rate (rj, pt103u: "whatever the selected rate for
-- it (automatic or not) should be the set rate for it, unless it is edited later.
-- Only the currently set rate should be blocked by the session.")
-- * walk_in_auto_rate: what Automatic resolves to for a vehicle and start: the rate
--   the priority puts in effect at the start (rate_in_effect_at) when it's an
--   applicable walk-in rate (and not monthly while an hourly/daily/flat rate
--   applies); otherwise the first applicable non-monthly rate by walk-in
--   priority; otherwise the first applicable (monthly) rate.
-- * parking_sessions trigger: an open session saved with no rate (Automatic) gets
--   that rate stored, on check-in and on edit (editing back to Automatic
--   re-resolves with the new start/vehicle). Sessions are priced at that one rate;
--   split pricing stays only in the Rates price preview (quote_price).
-- * session_price / walk_in_rate_options: Automatic = that one rate (the dropdown
--   says which); walk_in_quote previews exactly what will be stored.
-- * rate_open_session_count reverts to the stored rate only (undoes 0050's
--   'could price' rule).
-- * Backfill: open sessions on Automatic get their resolved rate.

CREATE OR REPLACE FUNCTION public.walk_in_auto_rate(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_eff uuid := rate_in_effect_at(p_location_id, p_vehicle_type, p_start_at);
  v_any_hourly boolean;
  v_id uuid;
BEGIN
  v_any_hourly := EXISTS (SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at) r
                           WHERE r.rate_type <> 'monthly');
  SELECT r.id INTO v_id FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at) r
   WHERE r.id = v_eff AND (r.rate_type <> 'monthly' OR NOT v_any_hourly);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT r.id INTO v_id FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at) r
   WHERE r.rate_type <> 'monthly' OR NOT v_any_hourly
   LIMIT 1;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.walk_in_auto_rate(uuid, vehicle_type, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.parking_sessions_set_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.rate_id IS NULL AND NEW.status IN ('active', 'overdue') AND NEW.started_at IS NOT NULL THEN
    NEW.rate_id := walk_in_auto_rate(NEW.location_id, COALESCE(NEW.vehicle_type, 'car'), NEW.started_at);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.parking_sessions_set_rate() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS parking_sessions_set_rate ON parking_sessions;
CREATE TRIGGER parking_sessions_set_rate
  BEFORE INSERT OR UPDATE ON parking_sessions
  FOR EACH ROW EXECUTE FUNCTION public.parking_sessions_set_rate();

CREATE OR REPLACE FUNCTION public.rate_open_session_count(p_rate_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int
    FROM parking_sessions
   WHERE rate_id = p_rate_id
     AND status IN ('active', 'overdue');
$$;
REVOKE ALL ON FUNCTION public.rate_open_session_count(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.session_price(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_rate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_end timestamptz := COALESCE(p_end_at, now());
  v_hours numeric := GREATEST(EXTRACT(EPOCH FROM (v_end - p_start_at)) / 3600.0, 0.0001);
  v_billed integer := GREATEST(1, CEIL(v_hours));
  v_rate rates%ROWTYPE;
  v_months integer;
  v_amount numeric;
  v_q jsonb;
BEGIN
  IF p_rate_id IS NULL THEN
    -- 0054: Automatic = the one rate the priority picks at the start (no split).
    SELECT * INTO v_rate FROM rates
     WHERE id = walk_in_auto_rate(p_location_id, p_vehicle_type, p_start_at);
    IF v_rate.id IS NULL THEN
      RETURN jsonb_build_object('error', 'No rate found', 'mode', 'auto', 'until', v_end);
    END IF;
  ELSE
    SELECT * INTO v_rate FROM rates WHERE id = p_rate_id AND location_id = p_location_id;
    IF v_rate.id IS NULL THEN
      RETURN jsonb_build_object('error', 'rate_not_found', 'until', v_end);
    END IF;
  END IF;

  IF v_rate.rate_type = 'monthly' THEN
    v_months := started_months(p_start_at, v_end);
    v_amount := COALESCE(v_rate.monthly_amount, 0) * v_months;
  ELSE
    v_amount := rate_amount_for_hours(v_rate, v_billed);
  END IF;

  RETURN jsonb_build_object(
    'amount', v_amount,
    'mode', CASE WHEN p_rate_id IS NULL THEN 'auto' ELSE 'rate' END,
    'rate_id', v_rate.id,
    'rate_name', v_rate.name,
    'rate_type', v_rate.rate_type,
    'billed_hours', CASE WHEN v_rate.rate_type = 'monthly' THEN NULL ELSE v_billed END,
    'billed_months', v_months,
    'until', v_end,
    'breakdown', jsonb_build_array(jsonb_build_object(
      'rate_id', v_rate.id, 'rate_name', v_rate.name, 'rate_type', v_rate.rate_type,
      'hours', CASE WHEN v_rate.rate_type = 'monthly' THEN NULL ELSE v_billed END,
      'months', v_months, 'amount', v_amount, 'from', p_start_at))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.walk_in_rate_options(p_location_id uuid, p_vehicle_type vehicle_type, p_start_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rates jsonb;
  v_top rates%ROWTYPE;
BEGIN
  IF NOT can_work_location(p_location_id, auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'rate_type', r.rate_type, 'is_default', r.is_default,
           'hourly_amount', r.hourly_amount, 'daily_amount', r.daily_amount,
           'monthly_amount', r.monthly_amount, 'first_hours', r.first_hours,
           'first_amount', r.first_amount, 'succeeding_hourly_amount', r.succeeding_hourly_amount,
           'vehicle_type', r.vehicle_type, 'days_of_week', r.days_of_week)), '[]'::jsonb)
    INTO v_rates
    FROM walk_in_rates(p_location_id, p_vehicle_type, COALESCE(p_start_at, now())) r;
  SELECT * INTO v_top FROM rates
   WHERE id = walk_in_auto_rate(p_location_id, p_vehicle_type, COALESCE(p_start_at, now()));
  RETURN jsonb_build_object(
    'success', true,
    'rates', v_rates,
    'auto', CASE
      WHEN v_top.id IS NULL THEN NULL
      ELSE jsonb_build_object('mode', CASE WHEN v_top.rate_type = 'monthly' THEN 'monthly' ELSE 'rate' END,
                              'rate_id', v_top.id, 'rate_name', v_top.name, 'rate_type', v_top.rate_type)
    END
  );
END;
$function$;

-- Backfill open Automatic sessions (the trigger fills rate_id on this update).
UPDATE parking_sessions SET rate_id = NULL
 WHERE rate_id IS NULL AND status IN ('active', 'overdue');

NOTIFY pgrst, 'reload schema';
