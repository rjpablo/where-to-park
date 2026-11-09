import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaForVehicle, driverSessionKind, reservationsAllowed } from './reservations.ts';

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
