import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedVehicleTypes,
  vehicleForArea,
  areaAllowsVehicle,
  areaErrorMessage,
  areaStatusText,
  defaultAreaId,
  listingAvailability,
  listingPinLabel,
  visibleResults,
  sortAreas,
  vehicleTypesLabel,
} from './areas.ts';

const labels = { car: 'Car', suv: 'SUV', van: 'Van', motorcycle: 'Motorcycle', truck: 'Truck' };

test('Main sorts first, then sort order, then name', () => {
  const s = sortAreas([
    { name: 'B', is_main: false, sort_order: 2 },
    { name: 'A', is_main: false, sort_order: 2 },
    { name: 'Main', is_main: true, sort_order: 5 },
    { name: 'Z', is_main: false, sort_order: 1 },
  ]);
  assert.deepEqual(
    s.map((a) => a.name),
    ['Main', 'Z', 'A', 'B']
  );
});

test('area selectors default to the preferred area, else Main', () => {
  const areas = [
    { id: 'm', is_main: true },
    { id: 'r', is_main: false },
  ];
  assert.equal(defaultAreaId(areas, 'r'), 'r');
  assert.equal(defaultAreaId(areas, 'gone'), 'm');
  assert.equal(defaultAreaId(areas), 'm');
  assert.equal(defaultAreaId([{ id: 'm', is_main: true }], null), 'm');
  assert.equal(defaultAreaId([]), null);
});

test('vehicle types: none = all', () => {
  assert.equal(areaAllowsVehicle({ vehicle_types: null }, 'car'), true);
  assert.equal(areaAllowsVehicle({ vehicle_types: [] }, 'truck'), true);
  assert.equal(areaAllowsVehicle({ vehicle_types: ['motorcycle'] }, 'car'), false);
  assert.equal(areaAllowsVehicle({ vehicle_types: ['motorcycle'] }, 'motorcycle'), true);
  assert.equal(vehicleTypesLabel(null, labels), 'All vehicles');
  assert.equal(vehicleTypesLabel(['car', 'suv'], labels), 'Car, SUV');
  assert.equal(vehicleTypesLabel(Object.keys(labels), labels), 'All vehicles');
});

test('operator area status: count when monitored, Available/Full otherwise', () => {
  assert.equal(
    areaStatusText({ monitored: true, marked_full: false, capacity: 20, area_counted: 7 }),
    '7 / 20'
  );
  assert.equal(
    areaStatusText({ monitored: true, marked_full: true, capacity: 20, area_counted: 7 }),
    '7 / 20'
  );
  assert.equal(areaStatusText({ monitored: false, marked_full: false, capacity: 0 }), 'Available');
  assert.equal(areaStatusText({ monitored: false, marked_full: true, capacity: 0 }), 'Full');
});

test('driver availability text for mixed / unmonitored listings', () => {
  assert.deepEqual(listingAvailability(5, true), { text: '5 spots', full: false, count: 5 });
  assert.equal(listingAvailability(1, true).text, '1 spot');
  // monitored areas full, an unmonitored one Available
  assert.equal(listingAvailability(0, true).text, 'Available');
  // only unmonitored areas
  assert.deepEqual(listingAvailability(null, true), {
    text: 'Available',
    full: false,
    count: null,
  });
  assert.deepEqual(listingAvailability(null, false), { text: 'Full', full: true, count: null });
  // every area full, some monitored
  assert.deepEqual(listingAvailability(0, false), { text: '0 spots', full: true, count: 0 });
});

test('area error messages', () => {
  assert.match(areaErrorMessage('main_area_locked'), /Main/);
  assert.match(areaErrorMessage('capacity_below_in_use', { in_use: 4 }), /\(4\)/);
  assert.match(areaErrorMessage('vehicle_not_allowed', { area: 'Rooftop' }), /Rooftop/);
  assert.equal(areaErrorMessage('weird'), 'weird');
});

test('map pin labels (rj t140u)', () => {
  assert.equal(listingPinLabel(12, true), '12');
  // available, no monitored count: empty green pin
  assert.equal(listingPinLabel(null, true), '');
  assert.equal(listingPinLabel(0, true), '');
  // full (monitored or unmonitored): grey pin with 0
  assert.equal(listingPinLabel(0, false), '0');
  assert.equal(listingPinLabel(null, false), '0');
});

test('Full listings only with Show Full', () => {
  const rows = [
    { id: 'a', available_count: 3, open_status: true },
    { id: 'b', available_count: 0, open_status: false },
    { id: 'c', available_count: null, open_status: false },
    { id: 'd', available_count: null, open_status: true },
  ];
  assert.deepEqual(
    visibleResults(rows, false).map((r) => r.id),
    ['a', 'd']
  );
  assert.equal(visibleResults(rows, true).length, 4);
});

const ALL = ['car', 'suv', 'van', 'motorcycle', 'truck'] as const;

test("allowedVehicleTypes: the area's types in form order; none set = all", () => {
  assert.deepEqual(allowedVehicleTypes({ vehicle_types: ['motorcycle', 'car'] }, ALL), [
    'car',
    'motorcycle',
  ]);
  assert.deepEqual(allowedVehicleTypes({ vehicle_types: [] }, ALL), [...ALL]);
  assert.deepEqual(allowedVehicleTypes({ vehicle_types: null }, ALL), [...ALL]);
  assert.deepEqual(allowedVehicleTypes(null, ALL), [...ALL]);
});

test('vehicleForArea: keep, select the only one, or clear', () => {
  assert.equal(vehicleForArea('car', ['car', 'suv']), 'car');
  assert.equal(vehicleForArea('car', ['motorcycle']), 'motorcycle');
  assert.equal(vehicleForArea('car', ['suv', 'van']), null);
  assert.equal(vehicleForArea(null, ['motorcycle']), 'motorcycle');
  assert.equal(vehicleForArea(null, ['suv', 'van']), null);
});
