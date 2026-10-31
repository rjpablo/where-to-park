import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableSlots, searchSummary, totalAvailableSlots } from './availability.ts';

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
