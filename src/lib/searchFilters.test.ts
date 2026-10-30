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
