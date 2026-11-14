import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableSlots,
  freeSpaces,
  heldPreview,
  manualCountsError,
  searchSummary,
  spotsLabel,
  totalAvailableSlots,
} from './availability.ts';

test('count listings contribute their free slots; open/full contribute 0', () => {
  assert.equal(availableSlots({ tracking_mode: 'count', available_count: 7 }), 7);
  assert.equal(availableSlots({ tracking_mode: 'slots', available_count: 2 }), 2);
  assert.equal(availableSlots({ tracking_mode: 'open_full', available_count: 30 }), 0);
  assert.equal(availableSlots({ tracking_mode: 'count', available_count: null }), 0);
  assert.equal(availableSlots({ tracking_mode: 'count', available_count: -3 }), 0);
});

test('totals add up', () => {
  assert.equal(
    totalAvailableSlots([
      { tracking_mode: 'count', available_count: 5 },
      { tracking_mode: 'count', available_count: 8 },
      { tracking_mode: 'open_full', available_count: 1 },
    ]),
    13
  );
  assert.equal(totalAvailableSlots([]), 0);
});

test('summary line wording', () => {
  assert.equal(searchSummary([]), 'No listings found');
  assert.equal(
    searchSummary([{ tracking_mode: 'count', available_count: 1 }]),
    '1 listing · 1 spot available'
  );
  assert.equal(
    searchSummary([
      { tracking_mode: 'count', available_count: 40 },
      { tracking_mode: 'count', available_count: 8 },
      { tracking_mode: 'open_full', available_count: 0 },
    ]),
    '3 listings · 48 spots available'
  );
});

test('spotsLabel: free count only, singular for 1, Unknown when missing', () => {
  assert.equal(spotsLabel(0), '0 spots');
  assert.equal(spotsLabel(1), '1 spot');
  assert.equal(spotsLabel(12), '12 spots');
  assert.equal(spotsLabel('3'), '3 spots');
  assert.equal(spotsLabel(null), 'Unknown');
  assert.equal(spotsLabel(undefined), 'Unknown');
  assert.equal(spotsLabel(NaN), 'Unknown');
  assert.equal(spotsLabel(-1), 'Unknown');
});

test('freeSpaces: the server free_spaces first, else the cached count; never below 0', () => {
  assert.equal(freeSpaces({ free_spaces: 9, available_count: 10 }), 9);
  assert.equal(freeSpaces({ free_spaces: 0, available_count: 10 }), 0);
  assert.equal(freeSpaces({ available_count: 7 }), 7);
  assert.equal(freeSpaces({ free_spaces: null, available_count: null }), 0);
  assert.equal(freeSpaces({ free_spaces: -2 }), 0);
});

test('slots editor: preview and errors', () => {
  assert.equal(heldPreview(79, 0, 2), 77);
  assert.equal(heldPreview(5, 4, 0), 9);
  assert.equal(heldPreview(1, 0, 3), 0);
  assert.equal(
    manualCountsError('no_longer_available'),
    "That's more spaces than are free right now."
  );
  assert.equal(manualCountsError('x'), 'x');
});
