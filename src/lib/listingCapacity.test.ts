import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListingCapacity } from './listingCapacity.ts';

test('capacity is a whole number of at least 1', () => {
  assert.deepEqual(parseListingCapacity('1'), { capacity: 1 });
  assert.deepEqual(parseListingCapacity('10'), { capacity: 10 });
  assert.deepEqual(parseListingCapacity(' 12 '), { capacity: 12 });
  assert.deepEqual(parseListingCapacity(''), { error: 'Capacity must be at least 1' });
  assert.deepEqual(parseListingCapacity('0'), { error: 'Capacity must be at least 1' });
  assert.deepEqual(parseListingCapacity('1.5'), { error: 'Capacity must be at least 1' });
  assert.deepEqual(parseListingCapacity('-3'), { error: 'Capacity must be at least 1' });
});
