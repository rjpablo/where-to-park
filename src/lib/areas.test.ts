import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areaAllowsVehicle,
  areaErrorMessage,
  areaStatusText,
  defaultAreaId,
  listingAvailability,
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
