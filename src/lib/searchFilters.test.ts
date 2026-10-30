import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFilterParams, type SearchFilters } from './searchFilters.ts';

const base: SearchFilters = {
  vehicleType: null,
  rateType: null,
  showFull: false,
  distanceKm: 3,
};

test('full listings are hidden unless Show Full is on', () => {
  assert.equal(searchFilterParams(base).p_hide_full, true);
  assert.equal(searchFilterParams({ ...base, showFull: true }).p_hide_full, false);
});

test("vehicle dropdown: 'All vehicles' plus every vehicle type; All = no filter", async () => {
  const { VEHICLE_FILTER_OPTIONS, optionLabel } = await import('./searchFilters.ts');
  assert.deepEqual(
    VEHICLE_FILTER_OPTIONS.map((o) => o.label),
    ['All vehicles', 'Car', 'SUV', 'Van', 'Motorcycle', 'Truck']
  );
  assert.equal(VEHICLE_FILTER_OPTIONS[0].value, null);
  assert.equal(searchFilterParams({ ...base, vehicleType: null }).p_vehicle_type, null);
  assert.equal(searchFilterParams({ ...base, vehicleType: 'suv' }).p_vehicle_type, 'suv');
  assert.equal(optionLabel(VEHICLE_FILTER_OPTIONS, 'motorcycle'), 'Motorcycle');
  assert.equal(optionLabel(VEHICLE_FILTER_OPTIONS, null), 'All vehicles');
});

test('vehicle dropdown default: own default vehicle type, else All', async () => {
  const { defaultVehicleFilter } = await import('./searchFilters.ts');
  assert.equal(defaultVehicleFilter(true, 'van'), 'van');
  assert.equal(defaultVehicleFilter(true, null), null);
  assert.equal(defaultVehicleFilter(true, 'boat'), null);
  assert.equal(defaultVehicleFilter(false, 'van'), null);
});

test("sort: 'availability' is labelled 'Open spots' and comes last; others unchanged", async () => {
  const { SORT_LABELS, SORT_OPTIONS } = await import('./searchFilters.ts');
  assert.equal(SORT_LABELS.availability, 'Open spots');
  assert.deepEqual([...SORT_OPTIONS], ['distance', 'price', 'rating', 'eta', 'availability']);
  assert.equal(SORT_OPTIONS[SORT_OPTIONS.length - 1], 'availability');
  assert.equal(SORT_LABELS.distance, 'distance');
});

test("rate dropdown: 'All rate types' plus every rate type; All = no rate filter", async () => {
  const { RATE_FILTER_OPTIONS } = await import('./rates.ts');
  assert.deepEqual(
    RATE_FILTER_OPTIONS.map((o) => [o.value, o.label]),
    [
      [null, 'All rate types'],
      ['hourly', 'Hourly'],
      ['daily', 'Daily'],
      ['flat_then_hourly', 'Flat then hourly'],
      ['monthly', 'Monthly'],
    ]
  );
  assert.equal(searchFilterParams(base).p_rate_type, null);
  assert.equal(searchFilterParams({ ...base, rateType: 'daily' }).p_rate_type, 'daily');
  assert.equal(searchFilterParams({ ...base, rateType: 'monthly' }).p_monthly_only, false);
});
