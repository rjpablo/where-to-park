-- Split pricing (migration 0043): each billed hour is priced at the rate in effect at
-- that hour's start. Runs inside a transaction and rolls back (no data left behind).
-- Uses Burnham Park (seed location ...05), whose only rate is the default 'Car Rate',
-- hourly ₱40. Fails with an ASSERT message on the first wrong result.
BEGIN;

INSERT INTO rates (location_id, name, rate_type, hourly_amount, days_of_week, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000005', 'T Weekend', 'hourly', 60, '{0,6}', true, false);
INSERT INTO rates (location_id, name, rate_type, hourly_amount, effective_from, effective_to, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000005', 'T Holiday', 'hourly', 100,
        '2026-12-25 00:00+08', '2026-12-25 23:59:59+08', true, false);
INSERT INTO rates (location_id, name, rate_type, first_hours, first_amount, succeeding_hourly_amount,
                   vehicle_type, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000005', 'T Moto', 'flat_then_hourly', 3, 30, 10,
        'motorcycle', true, false);

DO $$
DECLARE
  L uuid := '30000000-0000-0000-0000-000000000005';
  q jsonb;
BEGIN
  -- rj's example: Sun 22:00 for 4 h = 2 × ₱60 (weekend) + 2 × ₱40 (Monday) = ₱200
  q := quote_price(L, 'car', '2026-11-01 22:00+08', 4);
  ASSERT (q->>'amount')::numeric = 200, 'Sun 22:00 4h: ' || q::text;
  ASSERT q->>'rate_name' = 'T Weekend', 'first-hour rate: ' || q::text;
  ASSERT jsonb_array_length(q->'breakdown') = 2, 'breakdown: ' || q::text;
  ASSERT q->'breakdown'->0->>'hours' = '2' AND (q->'breakdown'->1->>'amount')::numeric = 80, 'split: ' || q::text;
  ASSERT (q->'segments'->1->>'from')::timestamptz = '2026-11-02 00:00+08', 'segment boundary: ' || q::text;

  -- Sat 22:00 for 4 h stays on the weekend rate: ₱240, one entry
  q := quote_price(L, 'car', '2026-10-31 22:00+08', 4);
  ASSERT (q->>'amount')::numeric = 240 AND jsonb_array_length(q->'breakdown') = 1, 'Sat 22:00 4h: ' || q::text;

  -- Fri 23:00 for 2 h: ₱40 + ₱60
  q := quote_price(L, 'car', '2026-10-30 23:00+08', 2);
  ASSERT (q->>'amount')::numeric = 100, 'Fri 23:00 2h: ' || q::text;

  -- Started hours: Sun 22:30 for 2.2 h = 3 hours starting 22:30, 23:30, 00:30
  q := quote_price(L, 'car', '2026-11-01 22:30+08', 2.2);
  ASSERT (q->>'amount')::numeric = 160 AND (q->>'billed_hours')::int = 3, 'Sun 22:30 2.2h: ' || q::text;

  -- An hour starting exactly at midnight belongs to the new day: Sun 23:00 for 1 h = ₱60
  q := quote_price(L, 'car', '2026-11-01 23:00+08', 1);
  ASSERT (q->>'amount')::numeric = 60, 'Sun 23:00 1h: ' || q::text;

  -- Into a dated rate: Thu 24 Dec 22:00 for 4 h = 2 × ₱40 + 2 × ₱100
  q := quote_price(L, 'car', '2026-12-24 22:00+08', 4);
  ASSERT (q->>'amount')::numeric = 280, 'into holiday: ' || q::text;

  -- Past a dated rate's end: Fri 25 Dec 23:00 for 2 h = ₱100 + Sat ₱60
  q := quote_price(L, 'car', '2026-12-25 23:00+08', 2);
  ASSERT (q->>'amount')::numeric = 160, 'out of holiday: ' || q::text;

  -- No hours given = 1 billed hour
  q := quote_price(L, 'car', '2026-11-02 10:00+08', NULL);
  ASSERT (q->>'amount')::numeric = 40, 'no hours: ' || q::text;

  -- Vehicle-specific flat rate prices the motorcycle whole stay (Sun 22:00 5 h = 30 + 2 × 10)
  q := quote_price(L, 'motorcycle', '2026-11-01 22:00+08', 5);
  ASSERT (q->>'amount')::numeric = 50 AND jsonb_array_length(q->'breakdown') = 1, 'moto: ' || q::text;
END $$;

-- Daily max per rate: weekend ₱60/h capped at ₱100 per (started) 24 h of its own hours
UPDATE rates SET max_per_day = 100 WHERE name = 'T Weekend' AND location_id = '30000000-0000-0000-0000-000000000005';
DO $$
DECLARE
  L uuid := '30000000-0000-0000-0000-000000000005';
  q jsonb;
BEGIN
  -- Sat 00:00 for 30 h: all weekend, 30 h × ₱60 = ₱1,800 capped at 2 × ₱100
  q := quote_price(L, 'car', '2026-10-31 00:00+08', 30);
  ASSERT (q->>'amount')::numeric = 200, 'weekend cap 30h: ' || q::text;
  -- Sun 20:00 for 10 h: weekend 4 h capped at ₱100, Monday 6 h × ₱40 = ₱240 (not capped)
  q := quote_price(L, 'car', '2026-11-01 20:00+08', 10);
  ASSERT (q->>'amount')::numeric = 340, 'cap per segment: ' || q::text;
END $$;

-- An hour with no rate fails the quote: weekend only, with a monthly default (monthly
-- rates never price a stay in quote_price) and the hourly rate switched off
INSERT INTO rates (location_id, name, rate_type, monthly_amount, active, is_default)
VALUES ('30000000-0000-0000-0000-000000000005', 'T Monthly', 'monthly', 3000, true, false);
UPDATE rates SET is_default = false WHERE location_id = '30000000-0000-0000-0000-000000000005' AND is_default;
UPDATE rates SET is_default = true WHERE location_id = '30000000-0000-0000-0000-000000000005' AND name = 'T Monthly';
-- Fixture only (rolled back): skip the 0048/0050 in-use guard for open sessions.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE rates DISABLE TRIGGER rates_guard_deactivate;
UPDATE rates SET active = false WHERE location_id = '30000000-0000-0000-0000-000000000005' AND name = 'Car Rate';
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE rates ENABLE TRIGGER rates_guard_deactivate;
SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE
  q jsonb := quote_price('30000000-0000-0000-0000-000000000005', 'car', '2026-11-01 22:00+08', 4);
BEGIN
  ASSERT q->>'error' = 'No rate found', 'uncovered: ' || q::text;
  ASSERT (q->>'uncovered_from')::timestamptz = '2026-11-02 00:00+08', 'uncovered_from: ' || q::text;
END $$;

ROLLBACK;
