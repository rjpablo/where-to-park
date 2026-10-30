import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFilterParams, type SearchFilters } from './searchFilters.ts';

const base: SearchFilters = {
  vehicleType: null,
  monthlyOnly: false,
  showFull: false,
  distanceKm: 3,
};

test('full listings are hidden unless Show Full is on', () => {
  assert.equal(searchFilterParams(base).p_hide_full, true);
  assert.equal(searchFilterParams({ ...base, showFull: true }).p_hide_full, false);
});

test("vehicle dropdown: 'All' plus every vehicle type; All = no filter", async () => {
  const { VEHICLE_FILTER_OPTIONS, optionLabel } = await import('./searchFilters.ts');
  assert.deepEqual(
    VEHICLE_FILTER_OPTIONS.map((o) => o.label),
    ['All', 'Car', 'SUV', 'Van', 'Motorcycle', 'Truck']
  );
  assert.equal(VEHICLE_FILTER_OPTIONS[0].value, null);
  assert.equal(searchFilterParams({ ...base, vehicleType: null }).p_vehicle_type, null);
  assert.equal(searchFilterParams({ ...base, vehicleType: 'suv' }).p_vehicle_type, 'suv');
  assert.equal(optionLabel(VEHICLE_FILTER_OPTIONS, 'motorcycle'), 'Motorcycle');
  assert.equal(optionLabel(VEHICLE_FILTER_OPTIONS, null), 'All');
});

test('vehicle dropdown default: own default vehicle type, else All', async () => {
  const { defaultVehicleFilter } = await import('./searchFilters.ts');
  assert.equal(defaultVehicleFilter(true, 'van'), 'van');
  assert.equal(defaultVehicleFilter(true, null), null);
  assert.equal(defaultVehicleFilter(true, 'boat'), null);
  assert.equal(defaultVehicleFilter(false, 'van'), null);
});

test("sort: 'availability' is labelled 'Most slots'; others unchanged", async () => {
  const { SORT_LABELS, SORT_OPTIONS } = await import('./searchFilters.ts');
  assert.equal(SORT_LABELS.availability, 'Most slots');
  assert.deepEqual([...SORT_OPTIONS], ['distance', 'price', 'availability', 'rating', 'eta']);
  assert.equal(SORT_LABELS.distance, 'distance');
});
