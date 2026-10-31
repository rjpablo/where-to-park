-- Walk-in sessions: start/end times, rate choice, payments, settle before ending.
-- rj's flow (staff/operator): check in with vehicle + plate; start = now by default
-- (editable, never empty); optional end; rate picked by priority but changeable to
-- any other applicable rate; amount due shown for the selected rate up to the end
-- (or now); saved sessions are listed in Active Sessions and can be opened and
-- edited; multiple payments; ending computes the amount at the end (or now) and
-- needs the balance settled. "If the listing only has a monthly rate, then
-- sessions can only be monthly."
--
-- Rules (documented in docs/spec.md):
-- * Who: owners/managers of the listing's operator, or staff assigned to that
--   listing (same as the Active Sessions read policy): can_work_location().
--   start_walk_in, end_session and session_balance_preview had NO such check
--   before (any signed-in user could call them); they do now.
-- * Applicable rates for a session (walk_in_rates): active, all-vehicle or the
--   session's vehicle, not limited to an area or spot, and valid at the session's
--   START (date range and day of week, Asia/Manila). If any non-monthly rate is
--   applicable, monthly rates are left out (except the default); if only monthly
--   rates apply, only they are offered. The default is always applicable when it
--   matches the vehicle (it has no dates or days, 0042).
-- * Rate choice: parking_sessions.rate_id NULL = Automatic. Automatic = split
--   pricing across rates hour by hour (quote_price, 0043) when a non-monthly rate
--   applies, otherwise the best-ranked monthly rate. A chosen rate prices the
--   whole session at that rate.
-- * Monthly pricing: per STARTED month from the start (Asia/Manila calendar
--   months; 1 Jan 10:00 → 1 Feb 10:00 is one month, a minute more is two) ×
--   monthly amount.
-- * Amount due is priced up to the end: the billed end (staff override), else the
--   planned end (scheduled_end_at), else the actual end, else now. (Before, a
--   planned end in the future billed only up to now.)
-- * Balance = parking amount + extra fees/adjustments − payments.
-- * end_session refuses while the balance is above ₱0.01 ('balance_due'), unless
--   an allowed user gives a waiver note (existing waiver rule, unchanged). It no
--   longer writes anything when it refuses (before, a refused close left a parking
--   fee charge and a cash payment behind).
-- * Payments: record_session_payment, amount > 0 and not more than the balance.

ALTER TABLE parking_sessions
  ADD COLUMN IF NOT EXISTS rate_id uuid REFERENCES rates(id) ON DELETE SET NULL;
COMMENT ON COLUMN parking_sessions.rate_id IS 'Rate chosen for the session; NULL = Automatic';

-- Owner/manager of the location's operator, or staff assigned to the location.
CREATE OR REPLACE FUNCTION public.can_work_location(p_location_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1
      FROM locations l
      JOIN operator_members om ON om.operator_id = l.operator_id
     WHERE l.id = p_location_id
       AND om.profile_id = p_uid
       AND (om.role IN ('owner', 'manager') OR p_location_id = ANY (om.location_ids))
  );
$function$;
REVOKE ALL ON FUNCTION public.can_work_location(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Started months from p_start to p_end (Manila calendar), at least 1.
CREATE OR REPLACE FUNCTION public.started_months(p_start timestamptz, p_end timestamptz)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_local timestamp := p_start AT TIME ZONE 'Asia/Manila';
  n integer;
BEGIN
  IF p_end IS NULL OR p_end <= p_start THEN
    RETURN 1;
  END IF;
  n := GREATEST(1, ((EXTRACT(YEAR FROM age(p_end AT TIME ZONE 'Asia/Manila', v_local)) * 12)
        + EXTRACT(MONTH FROM age(p_end AT TIME ZONE 'Asia/Manila', v_local)))::int);
  WHILE ((v_local + make_interval(months => n)) AT TIME ZONE 'Asia/Manila') < p_end LOOP
    n := n + 1;
  END LOOP;
  WHILE n > 1 AND ((v_local + make_interval(months => n - 1)) AT TIME ZONE 'Asia/Manila') >= p_end LOOP
    n := n - 1;
  END LOOP;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.started_months(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- Applicable rates for a session starting at p_start_at, best first.
CREATE OR REPLACE FUNCTION public.walk_in_rates(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz
)
RETURNS SETOF rates
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT *
      FROM rates
     WHERE location_id = p_location_id
       AND active = true
       AND area_id IS NULL
       AND slot_id IS NULL
       AND (vehicle_type IS NULL OR vehicle_type = p_vehicle_type)
       AND (effective_from IS NULL OR effective_from <= p_start_at)
       AND (effective_to IS NULL OR effective_to >= p_start_at)
       AND (days_of_week IS NULL OR cardinality(days_of_week) = 0
            OR EXTRACT(DOW FROM (p_start_at AT TIME ZONE 'Asia/Manila'))::int = ANY (days_of_week))
  )
  SELECT *
    FROM base
   WHERE rate_type != 'monthly'
      OR is_default
      OR NOT EXISTS (SELECT 1 FROM base b WHERE b.rate_type != 'monthly')
   ORDER BY
     CASE WHEN effective_from IS NOT NULL OR effective_to IS NOT NULL THEN 1 ELSE 2 END,
     CASE
       WHEN vehicle_type IS NOT NULL THEN 3
       WHEN days_of_week IS NOT NULL AND cardinality(days_of_week) > 0 THEN 4
       WHEN is_default THEN 5
       ELSE 6
     END,
     priority DESC,
     created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.walk_in_rates(uuid, vehicle_type, timestamptz) FROM PUBLIC, anon, authenticated;

-- Price of a session from p_start to p_end (NULL = now) with p_rate_id (NULL = Automatic).
CREATE OR REPLACE FUNCTION public.session_price(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_rate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    IF EXISTS (SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at) r
                WHERE r.rate_type != 'monthly') THEN
      v_q := quote_price(p_location_id, p_vehicle_type, p_start_at, v_hours);
      IF v_q ? 'error' THEN
        RETURN v_q || jsonb_build_object('mode', 'auto', 'until', v_end);
      END IF;
      RETURN v_q || jsonb_build_object('mode', 'auto', 'until', v_end);
    END IF;
    SELECT * INTO v_rate FROM walk_in_rates(p_location_id, p_vehicle_type, p_start_at) LIMIT 1;
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
REVOKE ALL ON FUNCTION public.session_price(uuid, vehicle_type, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- Parking amount of a session up to: billed end, else planned end, else actual end, else now.
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
    COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()), v_s.rate_id);
  RETURN COALESCE(NULLIF(v_q->>'amount', '')::numeric, 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.session_parking_quote(uuid) FROM PUBLIC, anon, authenticated;

-- Shared validation for the start/edit RPCs; NULL = OK, else an error code.
CREATE OR REPLACE FUNCTION public.walk_in_input_error(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_started_at timestamptz,
  p_end_at timestamptz,
  p_rate_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_plate IS NULL OR btrim(p_plate) = '' THEN RETURN 'plate_required'; END IF;
  IF p_vehicle_type IS NULL THEN RETURN 'vehicle_required'; END IF;
  IF p_started_at IS NULL THEN RETURN 'start_required'; END IF;
  IF p_started_at > now() + interval '5 minutes' THEN RETURN 'start_in_future'; END IF;
  IF p_end_at IS NOT NULL AND p_end_at <= p_started_at THEN RETURN 'end_before_start'; END IF;
  IF NOT EXISTS (SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_started_at)) THEN
    RETURN 'no_applicable_rate';
  END IF;
  IF p_rate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM walk_in_rates(p_location_id, p_vehicle_type, p_started_at) r WHERE r.id = p_rate_id
  ) THEN
    RETURN 'rate_not_applicable';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.walk_in_input_error(uuid, vehicle_type, text, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- Rate dropdown: Automatic + applicable rates for this vehicle and start.
CREATE OR REPLACE FUNCTION public.walk_in_rate_options(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rates jsonb;
  v_split boolean;
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
  SELECT * INTO v_top FROM walk_in_rates(p_location_id, p_vehicle_type, COALESCE(p_start_at, now())) LIMIT 1;
  v_split := EXISTS (SELECT 1 FROM jsonb_array_elements(v_rates) e WHERE e->>'rate_type' <> 'monthly');
  RETURN jsonb_build_object(
    'success', true,
    'rates', v_rates,
    'auto', CASE
      WHEN v_top.id IS NULL THEN NULL
      WHEN v_split THEN jsonb_build_object('mode', 'split')
      ELSE jsonb_build_object('mode', 'monthly', 'rate_id', v_top.id, 'rate_name', v_top.name)
    END
  );
END;
$function$;

-- Amount due preview for the check-in / edit form (end NULL = up to now).
CREATE OR REPLACE FUNCTION public.walk_in_quote(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_start_at timestamptz,
  p_end_at timestamptz DEFAULT NULL,
  p_rate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_err text;
BEGIN
  IF NOT can_work_location(p_location_id, auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, 'x', p_start_at, p_end_at, p_rate_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;
  RETURN session_price(p_location_id, p_vehicle_type, p_start_at, p_end_at, p_rate_id)
    || jsonb_build_object('until_now', p_end_at IS NULL);
END;
$function$;

DROP FUNCTION IF EXISTS public.start_walk_in(uuid, vehicle_type, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.start_walk_in(
  p_location_id uuid,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_note text DEFAULT NULL,
  p_scheduled_end_at timestamptz DEFAULT NULL,
  p_started_at timestamptz DEFAULT NULL,
  p_rate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_start timestamptz := COALESCE(p_started_at, now());
  v_err text;
  v_claim jsonb;
  v_session_id uuid;
  v_folio_id uuid;
  v_operator_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT can_work_location(p_location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_err := walk_in_input_error(p_location_id, p_vehicle_type, p_plate, v_start, p_scheduled_end_at, p_rate_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;

  v_claim := claim_capacity(p_location_id, NULL, v_start, p_scheduled_end_at, 'session');
  IF v_claim->>'error' IS NOT NULL THEN
    RETURN v_claim;
  END IF;

  SELECT operator_id INTO v_operator_id FROM locations WHERE id = p_location_id;

  INSERT INTO parking_sessions (
    location_id, plate, vehicle_type, note, scheduled_end_at,
    started_at, status, rate_id, rate_snapshot
  ) VALUES (
    p_location_id, upper(btrim(p_plate)), p_vehicle_type, NULLIF(btrim(p_note), ''), p_scheduled_end_at,
    v_start, 'active', p_rate_id,
    session_price(p_location_id, p_vehicle_type, v_start,
      COALESCE(p_scheduled_end_at, v_start + interval '1 hour'), p_rate_id)
  ) RETURNING id INTO v_session_id;

  INSERT INTO folios (operator_id, location_id, session_id, status)
  VALUES (v_operator_id, p_location_id, v_session_id, 'open')
  RETURNING id INTO v_folio_id;

  INSERT INTO availability_events (location_id, change, actor)
  VALUES (p_location_id, 'walk_in_started', v_uid);

  RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'folio_id', v_folio_id);
END;
$function$;

-- Edit an active session: start, end (NULL clears it), vehicle, plate, rate (NULL = Automatic).
CREATE OR REPLACE FUNCTION public.update_walk_in_session(
  p_session_id uuid,
  p_started_at timestamptz,
  p_end_at timestamptz,
  p_vehicle_type vehicle_type,
  p_plate text,
  p_rate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_err text;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  v_err := walk_in_input_error(v_s.location_id, p_vehicle_type, p_plate, p_started_at, p_end_at, p_rate_id);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_err);
  END IF;

  UPDATE parking_sessions
     SET started_at = p_started_at,
         scheduled_end_at = p_end_at,
         billed_end_at = p_end_at,
         vehicle_type = p_vehicle_type,
         plate = upper(btrim(p_plate)),
         rate_id = p_rate_id,
         status = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN 'active'::session_status ELSE status END,
         overdue_minutes = CASE WHEN p_end_at IS NULL OR p_end_at > now() THEN NULL ELSE overdue_minutes END,
         updated_at = now()
   WHERE id = p_session_id;

  INSERT INTO booking_events (session_id, action, actor, details)
  VALUES (p_session_id, 'edit_session', v_uid, jsonb_build_object(
    'started_at', p_started_at, 'end_at', p_end_at, 'vehicle_type', p_vehicle_type,
    'plate', upper(btrim(p_plate)), 'rate_id', p_rate_id));

  RETURN jsonb_build_object('success', true, 'parking', session_parking_quote(p_session_id));
END;
$function$;

-- Live balance of an open session's folio.
CREATE OR REPLACE FUNCTION public.session_balance_parts(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_folio uuid;
  v_parking numeric := session_parking_quote(p_session_id);
  v_extra numeric;
  v_paid numeric;
BEGIN
  SELECT id INTO v_folio FROM folios WHERE session_id = p_session_id LIMIT 1;
  SELECT COALESCE(SUM(amount), 0) INTO v_extra FROM folio_charges
   WHERE folio_id = v_folio AND voided_at IS NULL AND type IN ('additional_fee', 'adjustment');
  SELECT COALESCE(SUM(CASE direction WHEN 'refund' THEN -amount ELSE amount END), 0) INTO v_paid
    FROM payments WHERE folio_id = v_folio;
  RETURN jsonb_build_object('folio_id', v_folio, 'parking', v_parking, 'extra_fees', v_extra,
    'paid', v_paid, 'balance', v_parking + v_extra - v_paid);
END;
$function$;
REVOKE ALL ON FUNCTION public.session_balance_parts(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.session_balance_preview(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_s parking_sessions%ROWTYPE;
  v_b jsonb;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, auth.uid()) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  v_b := session_balance_parts(p_session_id);
  RETURN jsonb_build_object('success', true, 'parking_so_far', v_b->'parking',
    'extra_fees', v_b->'extra_fees', 'paid', v_b->'paid', 'live_balance', v_b->'balance');
END;
$function$;

-- Everything the session page shows.
CREATE OR REPLACE FUNCTION public.session_details(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
      'status', v_s.status, 'rate_id', v_s.rate_id, 'driver_id', v_s.driver_id),
    'price', session_price(v_s.location_id, v_s.vehicle_type, v_s.started_at,
      COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at, now()), v_s.rate_id)
      || jsonb_build_object('until_now', COALESCE(v_s.billed_end_at, v_s.scheduled_end_at, v_s.ended_at) IS NULL),
    'parking', v_b->'parking', 'extra_fees', v_b->'extra_fees', 'paid', v_b->'paid',
    'balance', v_b->'balance',
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

-- Record a payment toward an open session (cash, GCash, Maya, card, other).
CREATE OR REPLACE FUNCTION public.record_session_payment(
  p_session_id uuid,
  p_amount numeric,
  p_method payment_method DEFAULT 'cash',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_s parking_sessions%ROWTYPE;
  v_folio record;
  v_b jsonb;
  v_id uuid;
BEGIN
  SELECT * INTO v_s FROM parking_sessions WHERE id = p_session_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT can_work_location(v_s.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id FOR UPDATE;
  IF v_folio.id IS NULL OR v_folio.status <> 'open' OR v_s.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'folio_not_open');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'amount_required');
  END IF;
  v_b := session_balance_parts(p_session_id);
  IF p_amount > (v_b->>'balance')::numeric + 0.005 THEN
    RETURN jsonb_build_object('error', 'payment_exceeds_balance', 'balance', v_b->'balance');
  END IF;
  INSERT INTO payments (folio_id, direction, amount, method, source, recorded_by, received_at, note)
  VALUES (v_folio.id, 'payment', round(p_amount, 2), COALESCE(p_method, 'cash'), 'staff', v_uid, now(),
          NULLIF(btrim(p_note), ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'payment_id', v_id,
    'balance', (session_balance_parts(p_session_id))->'balance');
END;
$function$;

-- End a session: amount at the end (or now); refuse while a balance remains.
CREATE OR REPLACE FUNCTION public.end_session(
  p_session_id uuid,
  p_cash_amount numeric DEFAULT NULL,
  p_waive_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session parking_sessions%ROWTYPE;
  v_folio record;
  v_b jsonb;
  v_cash numeric := CASE WHEN p_cash_amount > 0 THEN p_cash_amount ELSE 0 END;
  v_balance numeric;
  v_role text;
  v_staff_can_waive boolean;
  v_notify jsonb;
BEGIN
  SELECT * INTO v_session FROM parking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;
  IF NOT can_work_location(v_session.location_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'Permission denied');
  END IF;
  IF v_session.status NOT IN ('active', 'overdue') THEN
    RETURN jsonb_build_object('error', 'session_not_active');
  END IF;
  SELECT * INTO v_folio FROM folios WHERE session_id = p_session_id FOR UPDATE;
  IF v_folio.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_b := session_balance_parts(p_session_id);
  v_balance := (v_b->>'balance')::numeric - v_cash;

  IF v_balance > 0.01 THEN
    IF p_waive_note IS NULL OR btrim(p_waive_note) = '' THEN
      RETURN jsonb_build_object('error', 'balance_due', 'balance', v_balance);
    END IF;
    SELECT om.role::text, o.staff_can_waive INTO v_role, v_staff_can_waive
      FROM operator_members om JOIN operators o ON o.id = om.operator_id
     WHERE om.operator_id = v_folio.operator_id AND om.profile_id = v_uid LIMIT 1;
    IF NOT (v_role IN ('owner', 'manager') OR (v_role = 'staff' AND v_staff_can_waive)) THEN
      RETURN jsonb_build_object('error', 'waiver_not_allowed', 'balance', v_balance);
    END IF;
  END IF;

  -- Only now write: the parking fee at its final amount, any cash, any waiver.
  UPDATE folio_charges SET voided_at = now()
   WHERE folio_id = v_folio.id AND type = 'parking_fee' AND voided_at IS NULL;
  INSERT INTO folio_charges (folio_id, type, description, amount, added_by)
  VALUES (v_folio.id, 'parking_fee', 'Parking fee', (v_b->>'parking')::numeric, v_uid);
  IF v_cash > 0 THEN
    INSERT INTO payments (folio_id, amount, method, source, recorded_by)
    VALUES (v_folio.id, v_cash, 'cash', 'staff', v_uid);
  END IF;
  IF v_balance > 0.01 THEN
    INSERT INTO folio_charges (folio_id, type, description, amount, note, added_by)
    VALUES (v_folio.id, 'waiver', 'Waived balance', -v_balance, btrim(p_waive_note), v_uid);
  END IF;

  UPDATE parking_sessions
     SET status = 'ended', ended_at = now(), ended_by = v_uid,
         billed_end_at = COALESCE(billed_end_at, scheduled_end_at, now())
   WHERE id = p_session_id;
  UPDATE folios SET status = 'settled' WHERE id = v_folio.id;

  INSERT INTO booking_events (session_id, from_status, to_status, action, actor)
  VALUES (p_session_id, v_session.status, 'ended', 'end_session', v_uid);

  v_notify := notify_session_staff(p_session_id, 'session_ended', 'Session ended',
    COALESCE(v_session.plate, 'Session') || ' was closed');

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'amount', (v_b->>'parking')::numeric + (v_b->>'extra_fees')::numeric,
    'final_balance', LEAST(v_balance, 0),
    'push_tokens', COALESCE(v_notify->'push_tokens', '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.walk_in_rate_options(uuid, vehicle_type, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.walk_in_quote(uuid, vehicle_type, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.session_balance_preview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.session_details(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_session_payment(uuid, numeric, payment_method, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_session(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walk_in_rate_options(uuid, vehicle_type, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.walk_in_quote(uuid, vehicle_type, timestamptz, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_walk_in(uuid, vehicle_type, text, text, timestamptz, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_walk_in_session(uuid, timestamptz, timestamptz, vehicle_type, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_balance_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_details(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_session_payment(uuid, numeric, payment_method, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_session(uuid, numeric, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
