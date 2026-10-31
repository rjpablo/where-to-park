BEGIN;
SELECT plan(4);

SET LOCAL "request.jwt.claim.sub" TO '20000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.role" TO 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (set_tracking_mode('30000000-0000-0000-0000-000000000001', 'open_full')->>'success')::BOOLEAN,
  true,
  'Maria can switch SM City to Open/Full'
);

SELECT is(
  (set_open_status('30000000-0000-0000-0000-000000000001', false)->>'open_status')::BOOLEAN,
  false,
  'Toggle Full'
);

SELECT is(
  claim_capacity('30000000-0000-0000-0000-000000000001')->>'error',
  'no_longer_available',
  'Walk-in is refused while the lot is Full'
);

SELECT is(
  (set_open_status('30000000-0000-0000-0000-000000000001', true)->>'open_status')::BOOLEAN,
  true,
  'Toggle Open'
);

SELECT * FROM finish();
ROLLBACK;
