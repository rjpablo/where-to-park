BEGIN;
SELECT plan(3);

SELECT ok(
  (SELECT COUNT(*) FROM search_nearby(16.4023, 120.5960, 5000, NULL, true, false, 'distance', 50)
    WHERE has_monthly = false) = 0,
  'Monthly filter returns only listings with an active Monthly rate'
);

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM search_nearby(16.4023, 120.5960, 5000, NULL, true, false, 'distance', 50)),
  '>=',
  2,
  'SM City and Session Road both have Monthly rates'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM locations
    WHERE id = '30000000-0000-0000-0000-000000000005'
      AND availability_updated_at < NOW() - (stale_after_min || ' minutes')::INTERVAL
  ),
  'Burnham Park Street Parking is past the 2h stale threshold'
);

SELECT * FROM finish();
ROLLBACK;
