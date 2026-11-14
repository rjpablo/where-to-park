BEGIN;
SELECT plan(3);

SELECT cmp_ok(
  jsonb_array_length(get_etas(16.4023, 120.5960, NULL)->'etas'),
  '>=',
  4,
  'get_etas returns estimates for published listings'
);

SELECT is(
  (get_etas(16.4023, 120.5960, ARRAY['30000000-0000-0000-0000-000000000002'::uuid])->'etas'->0->>'source'),
  'estimate',
  'Without ORS the source is estimate fallback'
);

SELECT cmp_ok(
  (SELECT COUNT(*)::INTEGER FROM eta_cache WHERE source = 'estimate'),
  '>=',
  1,
  'Estimates are cached per origin cell'
);

SELECT * FROM finish();
ROLLBACK;
