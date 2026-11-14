import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeAffectsSearch, parseAvailabilityChange } from './liveAvailability.ts';

const search = { lat: 16.4023, lng: 120.596, radiusM: 2000 };

test('parseAvailabilityChange reads id and position', () => {
  assert.deepEqual(parseAvailabilityChange({ id: 'a', lat: 16.4, lng: '120.5' }), {
    id: 'a',
    lat: 16.4,
    lng: 120.5,
  });
  assert.deepEqual(parseAvailabilityChange({ id: 'a' }), { id: 'a', lat: null, lng: null });
});

test('parseAvailabilityChange rejects payloads without an id', () => {
  assert.equal(parseAvailabilityChange(null), null);
  assert.equal(parseAvailabilityChange({ lat: 1 }), null);
});

test('changeAffectsSearch ignores everything before a search', () => {
  assert.equal(changeAffectsSearch({ id: 'a', lat: 16.4023, lng: 120.596 }, ['a'], null), false);
});

test('changeAffectsSearch: a listing in the results refreshes, wherever it is', () => {
  assert.equal(changeAffectsSearch({ id: 'a', lat: 0, lng: 0 }, new Set(['a']), search), true);
});

test('changeAffectsSearch: a listing inside the circle could enter the results', () => {
  assert.equal(changeAffectsSearch({ id: 'b', lat: 16.41, lng: 120.6 }, ['a'], search), true);
});

test('changeAffectsSearch ignores listings outside the searched circle', () => {
  assert.equal(changeAffectsSearch({ id: 'b', lat: 14.6, lng: 121.0 }, ['a'], search), false);
});

test('changeAffectsSearch refreshes when the position is unknown', () => {
  assert.equal(changeAffectsSearch({ id: 'b', lat: null, lng: null }, ['a'], search), true);
});
