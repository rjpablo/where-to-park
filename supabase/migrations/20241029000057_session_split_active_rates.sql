-- 0057 (rj): sessions split their pricing across rates again, per started hour, like
-- the Rates price preview, but only ever with ACTIVE rates. Applies to every session,
-- Automatic or a picked rate.
--
-- * Each billed hour (start + i h) is priced by:
--     - the session's PICKED rate, when it is active, not monthly and applies at that
--       hour (vehicle, effective dates, days of week in Asia/Manila); otherwise
--     - rate_in_effect_at (the preview's priority rule over active rates, falling back
--       to the active default).
--   Automatic sessions skip the first step (every hour by priority), exactly like the
--   preview. A deactivated/archived rate never prices any hour.
-- * Each rate is then charged for its own hours with its own formula
--   (rate_amount_for_hours), as in quote_price (0043).
-- * A picked MONTHLY rate (or Automatic resolving to monthly because no hourly rate
--   applies) still prices the whole stay in started months, as before.
-- * The stored set rate (rate_id) stays for display/history. New rate_auto column
--   remembers whether it was saved as Automatic, so pricing knows whether to prefer it.
--   Ended sessions keep their final Parking fee charge (no repricing after the end).
-- * quote_price (preview) is unchanged: rate_in_effect_at already uses active rates only.

ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS rate_auto boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.rate_applies_at(p_rate rates, p_vehicle_type vehicle_type, p_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT p_rate.id IS NOT NULL
     AND p_rate.active
     AND p_rate.archived_at IS NULL
     AND p_rate.rate_type <> 'monthly'
     AND (p_rate.vehicle_type IS NULL OR p_rate.vehicle_type = p_vehicle_type)
     AND (p_rate.effective_from IS NULL OR p_rate.effective_from <= p_at)
     AND (p_rate.effective_to IS NULL OR p_rate.effective_to >= p_at)
     AND (p_rate.days_of_week IS NULL OR cardinality(p_rate.days_of_week) = 0
          OR EXTRACT(DOW FROM (p_at AT TIME ZONE 'Asia/Manila'))::int = ANY (p_rate.days_of_week));
$$;
REVOKE ALL ON FUNCTION public.rate_applies_at(rates, vehicle_type, timestamptz) FROM PUBLIC, anon, authenticated;

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
  v_pick rates%ROWTYPE;
  v_rate rates%ROWTYPE;
  v_first rates%ROWTYPE;
  v_months integer;
  v_amount numeric;
  v_total numeric := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_at timestamptz;
  v_n integer;
  v_breakdown jsonb := '[]'::jsonb;
  v_segments jsonb := '[]'::jsonb;
  v_seg_start integer := 0;
  i integer;
BEGIN
  IF p_rate_id IS NOT NULL THEN
    SELECT * INTO v_pick FROM rates WHERE id = p_rate_id AND location_id = p_location_id;
    IF v_pick.id IS NULL THEN
      RETURN jsonb_build_object('error', 'rate_not_found', 'until', v_end);
    END IF;
  ELSE
    -- Automatic: monthly only when no hourly rate applies at the start (0054 rule).
    SELECT * INTO v_pick FROM rates
     WHERE id = walk_in_auto_rate(p_location_id, p_vehicle_type, p_start_at) AND rate_type = 'monthly';
  END IF;

  -- Monthly (picked and active, or Automatic's monthly): whole stay in started months.
  IF v_pick.id IS NOT NULL AND v_pick.rate_type = 'monthly' AND v_pick.active THEN
    v_months := started_months(p_start_at, v_end);
    v_amount := COALESCE(v_pick.monthly_amount, 0) * v_months;
    RETURN jsonb_build_object(
      'amount', v_amount, 'mode', CASE WHEN p_rate_id IS NULL THEN 'auto' ELSE 'rate' END,
      'rate_id', v_pick.id, 'rate_name', v_pick.name, 'rate_type', v_pick.rate_type,
      'billed_hours', NULL, 'billed_months', v_months, 'until', v_end,
      'breakdown', jsonb_build_array(jsonb_build_object(
        'rate_id', v_pick.id, 'rate_name', v_pick.name, 'rate_type', v_pick.rate_type,
        'hours', NULL, 'months', v_months, 'amount', v_amount, 'from', p_start_at)),
      'segments', jsonb_build_array(jsonb_build_object('rate_id', v_pick.id, 'rate_name', v_pick.name,
        'from', p_start_at, 'to', v_end, 'hours', NULL)));
  END IF;
  IF p_rate_id IS NULL THEN
    v_pick := NULL;
  END IF;

  -- 1. Each billed hour: the picked rate if it applies then, else the priority rule.
  FOR i IN 0 .. v_billed - 1 LOOP
    v_at := p_start_at + make_interval(hours => i);
    IF rate_applies_at(v_pick, p_vehicle_type, v_at) THEN
      v_id := v_pick.id;
    ELSE
      v_id := rate_in_effect_at(p_location_id, p_vehicle_type, v_at);
    END IF;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'No rate found', 'uncovered_from', v_at, 'until', v_end);
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  -- 2. Consecutive runs.
  FOR i IN 1 .. v_billed LOOP
    IF i = v_billed OR v_ids[i + 1] <> v_ids[i] THEN
      SELECT * INTO v_rate FROM rates WHERE id = v_ids[i];
      v_segments := v_segments || jsonb_build_array(jsonb_build_object(
        'rate_id', v_rate.id, 'rate_name', v_rate.name,
        'from', p_start_at + make_interval(hours => v_seg_start),
        'to', p_start_at + make_interval(hours => i), 'hours', i - v_seg_start));
      v_seg_start := i;
    END IF;
  END LOOP;

  -- 3. Each rate charged for its own hours, in order of first use.
  FOR v_id IN
    SELECT u.id FROM unnest(v_ids) WITH ORDINALITY AS u(id, n) GROUP BY u.id ORDER BY min(u.n)
  LOOP
    SELECT * INTO v_rate FROM rates WHERE id = v_id;
    SELECT count(*), min(n) INTO v_n, i FROM unnest(v_ids) WITH ORDINALITY AS u(id, n) WHERE u.id = v_id;
    v_amount := rate_amount_for_hours(v_rate, v_n);
    v_total := v_total + v_amount;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'rate_id', v_rate.id, 'rate_name', v_rate.name, 'rate_type', v_rate.rate_type,
      'hours', v_n, 'months', NULL, 'amount', v_amount,
      'from', p_start_at + make_interval(hours => i - 1)));
  END LOOP;

  SELECT * INTO v_first FROM rates WHERE id = v_ids[1];
  RETURN jsonb_build_object(
    'amount', v_total,
    'mode', CASE WHEN p_rate_id IS NULL THEN 'auto' ELSE 'rate' END,
    'rate_id', v_first.id, 'rate_name', v_first.name, 'rate_type', v_first.rate_type,
    'billed_hours', v_billed, 'billed_months', NULL, 'until', v_end,
    'breakdown', v_breakdown, 'segments', v_segments);
END;
$function$;

-- rate_auto bookkeeping: Automatic (rate_id NULL on save) resolves + marks auto; any other
-- explicit rate change clears it (unless the writer set rate_auto itself, e.g. 0056).
CREATE OR REPLACE FUNCTION public.parking_sessions_set_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rate_id IS DISTINCT FROM OLD.rate_id
     AND NEW.rate_changed_from IS NOT DISTINCT FROM OLD.rate_changed_from THEN
    NEW.rate_changed_from := NULL;
  END IF;
  IF NEW.rate_id IS NULL AND NEW.status IN ('active', 'overdue') AND NEW.started_at IS NOT NULL THEN
    NEW.rate_id := walk_in_auto_rate(NEW.location_id, COALESCE(NEW.vehicle_type, 'car'), NEW.started_at);
    NEW.rate_auto := true;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.rate_auto := COALESCE(NEW.rate_auto, false);
  ELSIF NEW.rate_id IS DISTINCT FROM OLD.rate_id AND NEW.rate_auto IS NOT DISTINCT FROM OLD.rate_auto THEN
    NEW.rate_auto := false;
  END IF;
  RETURN NEW;
END;
$$;

-- 0056's switch on deactivation now marks the session Automatic (priority split).
CREATE OR REPLACE FUNCTION public.rates_reassign_open_ended()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(OLD.active, false) AND NOT COALESCE(NEW.active, false) THEN
    UPDATE parking_sessions s
       SET rate_changed_from = NEW.id,
           rate_auto = true,
           rate_id = COALESCE(
             walk_in_auto_rate(s.location_id, COALESCE(s.vehicle_type, 'car'), s.started_at),
             (SELECT d.id FROM rates d WHERE d.location_id = s.location_id AND d.is_default
                AND d.active AND d.id <> NEW.id LIMIT 1))
     WHERE s.rate_id = NEW.id
       AND s.status IN ('active', 'overdue')
       AND COALESCE(s.billed_end_at, s.scheduled_end_at) IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.session_parking_quote(p_session_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_s parking_sessions%ROWTYPE;
  v_q jsonb;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  v_q := session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
    COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()),
    CASE WHEN v_s.rate_auto THEN NULL ELSE v_s.rate_id END);
  RETURN COALESCE(NULLIF(v_q->>'amount', '')::numeric, 0);
END;
$function$;

-- Backfill rate_auto for open sessions: last edit saved Automatic, or never edited and the
-- stored rate is what Automatic picks at the start (or it was moved by 0056).
UPDATE parking_sessions s SET rate_auto = true
 WHERE s.status IN ('active', 'overdue')
   AND (s.rate_changed_from IS NOT NULL
     OR COALESCE((SELECT (e.details ? 'rate_id') AND e.details->>'rate_id' IS NULL
                    FROM booking_events e WHERE e.session_id = s.id AND e.action = 'edit_session'
                   ORDER BY e.created_at DESC LIMIT 1),
                 s.rate_id = walk_in_auto_rate(s.location_id, COALESCE(s.vehicle_type, 'car'), s.started_at)));

CREATE OR REPLACE FUNCTION public.session_details(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_b jsonb;
  v_loc record;
  v_role text;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT l.name, l.operator_id, o.staff_can_waive INTO v_loc
    FROM locations l JOIN operators o ON o.id = l.operator_id WHERE l.id = v_s.location_id;
  SELECT role::text INTO v_role FROM operator_members
   WHERE operator_id = v_loc.operator_id AND profile_id = v_uid LIMIT 1;
  v_b := session_balance_parts(p_session_id);
  RETURN jsonb_build_object(
    'success', true,
    'session', jsonb_build_object(
      'id', v_s.id, 'location_id', v_s.location_id, 'location_name', v_loc.name,
      'plate', v_s.plate, 'vehicle_type', v_s.vehicle_type, 'note', v_s.note,
      'started_at', v_s.started_at, 'end_at', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at),
      'status', v_s.status, 'rate_id', v_s.rate_id, 'driver_id', v_s.driver_id,
      'rate_auto', v_s.rate_auto,
      'set_rate_name', (SELECT r.name FROM rates r WHERE r.id = v_s.rate_id),
      'rate_active', (SELECT r.active FROM rates r WHERE r.id = v_s.rate_id),
      'rate_changed_from', CASE WHEN v_s.rate_changed_from IS NULL THEN NULL ELSE
        (SELECT jsonb_build_object('id', r.id, 'name', r.name) FROM rates r WHERE r.id = v_s.rate_changed_from) END,
      'ended_at', v_s.ended_at, 'cancelled_at', v_s.cancelled_at,
      'reservation', v_s.status IN ('active', 'overdue') AND v_s.started_at > now()),
    'price', session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
      COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()),
      CASE WHEN v_s.rate_auto THEN NULL ELSE v_s.rate_id END)
      || jsonb_build_object('until_now', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at) IS NULL
        AND v_s.started_at <= now()),
    'parking', v_b->'parking', 'extra_fees', v_b->'extra_fees', 'paid', v_b->'paid',
    'balance', v_b->'balance', 'waived', v_b->'waived',
    'refunded', COALESCE((SELECT SUM(p.amount) FROM payments p
      WHERE p.folio_id = (v_b->>'folio_id')::uuid AND p.direction = 'refund'), 0),
    'refundable', session_refundable(p_session_id),
    'charges', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type,
        'description', c.description, 'amount', c.amount, 'created_at', c.created_at) ORDER BY c.created_at)
      FROM folio_charges c WHERE c.folio_id = (v_b->>'folio_id')::uuid AND c.voided_at IS NULL
        AND c.type IN ('additional_fee', 'adjustment')), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount,
        'direction', p.direction, 'method', p.method, 'note', p.note, 'received_at', p.received_at,
        'recorded_by', COALESCE(pr.display_name, pr.phone, 'Staff')) ORDER BY p.received_at)
      FROM payments p LEFT JOIN profiles pr ON pr.id = p.recorded_by
      WHERE p.folio_id = (v_b->>'folio_id')::uuid), '[]'::jsonb),
    'can_waive', v_role IN ('owner', 'manager') OR (v_role = 'staff' AND COALESCE(v_loc.staff_can_waive, false))
  );
END;
$function$;


NOTIFY pgrst, 'reload schema';
