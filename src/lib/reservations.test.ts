import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  areaForVehicle,
  driverSessionKind,
  plannedPriceDetail,
  reservationsAllowed,
} from './reservations.ts';

const now = Date.parse('2026-11-09T00:00:00Z');
const future = '2026-11-10T00:00:00Z';
const past = '2026-11-08T00:00:00Z';

test('reservations are allowed only when the policy says so', () => {
  assert.equal(reservationsAllowed(null), false);
  assert.equal(reservationsAllowed({ reservations_enabled: false }), false);
  assert.equal(reservationsAllowed([{ reservations_enabled: true }]), true);
});

test('area follows main, then the rest, and empty vehicle types take every type', () => {
  const areas = [
    { id: 'side', name: 'Side', is_main: false, sort_order: 1, vehicle_types: ['motorcycle'] },
    { id: 'main', name: 'Main', is_main: true, sort_order: 0, vehicle_types: ['car'] },
    { id: 'open', name: 'Open', is_main: false, sort_order: 2, vehicle_types: [] },
  ];
  assert.equal(areaForVehicle(areas, 'car')?.id, 'main');
  assert.equal(areaForVehicle(areas, 'motorcycle')?.id, 'side');
  assert.equal(areaForVehicle(areas, 'truck')?.id, 'open');
  assert.equal(areaForVehicle(areas, null), null);
});

test('driver sessions group by approval, then by whether they have started', () => {
  assert.equal(
    driverSessionKind({ approval_status: 'pending', status: 'active', started_at: future }, now),
    'waiting'
  );
  assert.equal(
    driverSessionKind({ approval_status: 'approved', status: 'active', started_at: future }, now),
    'approved'
  );
  assert.equal(
    driverSessionKind({ approval_status: null, status: 'active', started_at: future }, now),
    'approved'
  );
  assert.equal(driverSessionKind({ status: 'active', started_at: past }, now), 'active');
  assert.equal(driverSessionKind({ status: 'ended', started_at: past }, now), 'previous');
  assert.equal(
    driverSessionKind(
      { approval_status: 'rejected', cancelled_at: past, status: 'ended', started_at: future },
      now
    ),
    'rejected'
  );
  assert.equal(
    driverSessionKind(
      { approval_status: 'pending', cancelled_at: past, status: 'ended', started_at: future },
      now
    ),
    'cancelled'
  );
});

test('planned price explains billed hours and each rate', () => {
  const detail = plannedPriceDetail({
    amount: 180,
    billed_hours: 3,
    billed_months: null,
    breakdown: [
      { rate_name: 'Day', hours: 2, months: null, amount: 100 },
      { rate_name: 'Night', hours: 1, months: null, amount: 80 },
    ],
  });
  assert.equal(detail?.amount, 180);
  assert.equal(detail?.summary, '3 hours billed');
  assert.equal(detail?.note, null);
  assert.deepEqual(detail?.lines, [
    { label: 'Day: 2h', amount: 100 },
    { label: 'Night: 1h', amount: 80 },
  ]);
  assert.equal(
    plannedPriceDetail({
      amount: 8000,
      billed_months: 2,
      breakdown: [{ rate_name: 'Monthly', months: 2, amount: 8000 }],
    })?.summary,
    '2 months billed'
  );
  assert.deepEqual(
    plannedPriceDetail({
      amount: 180,
      billed_hours: 5,
      breakdown: [
        {
          rate_name: 'Valet',
          rate_type: 'flat_then_hourly',
          hours: 5,
          amount: 180,
          first_hours: 3,
          first_amount: 100,
          succeeding_hours: 2,
          succeeding_amount: 80,
        },
      ],
    })?.lines,
    [
      { label: 'Flat for first 3h', amount: 100 },
      { label: '2 succeeding hours', amount: 80 },
    ]
  );
  assert.equal(plannedPriceDetail(null), null);
  assert.equal(plannedPriceDetail({ amount: 50 })?.lines.length, 0);
});
