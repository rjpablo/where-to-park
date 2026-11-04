import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatListingRating } from './rating.ts';

test('listing rating: stars with one decimal and review count', () => {
  assert.equal(formatListingRating(4.456, 12), '★ 4.5 (12)');
  assert.equal(formatListingRating('5', '1'), '★ 5.0 (1)');
});

test("listing rating: 'Not rated' when there are no reviews", () => {
  assert.equal(formatListingRating(null, 0), 'Not rated');
  assert.equal(formatListingRating(undefined, undefined), 'Not rated');
  assert.equal(formatListingRating(4, 0), 'Not rated');
  assert.equal(formatListingRating(null, 3), 'Not rated');
});
