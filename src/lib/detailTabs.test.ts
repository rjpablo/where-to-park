import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETAIL_TABS, gridCellSize, tabLabel } from './detailTabs.ts';

test('tabs: Overview first, then Reviews and Photos', () => {
  assert.deepEqual(
    DETAIL_TABS.map((t) => t.key),
    ['overview', 'reviews', 'photos']
  );
  assert.equal(tabLabel('overview', 3, 4), 'Overview');
  assert.equal(tabLabel('reviews', 3, 4), 'Reviews (3)');
  assert.equal(tabLabel('photos', 3, 4), 'Photos (4)');
  assert.equal(tabLabel('reviews', 0, 0), 'Reviews');
  assert.equal(tabLabel('photos', 0, 0), 'Photos');
});

test('grid cells are square and fit the width', () => {
  assert.equal(gridCellSize(364), 118); // 3 × 118 + 2 × 4 = 362 ≤ 364
  assert.equal(gridCellSize(272), 88);
  assert.equal(gridCellSize(0), 0);
});
