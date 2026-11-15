import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannerUnitId, PROD_BANNER_UNIT_ID, shouldShowAds, TEST_BANNER_UNIT_ID } from './ads.ts';

test('development builds always use the Google test banner', () => {
  assert.equal(bannerUnitId(true), TEST_BANNER_UNIT_ID);
  assert.equal(bannerUnitId(true, 'ca-app-pub-1/2'), TEST_BANNER_UNIT_ID);
});

test('release builds use the env unit, else the real Where To Park unit', () => {
  assert.equal(bannerUnitId(false), PROD_BANNER_UNIT_ID);
  assert.equal(bannerUnitId(false, '  '), PROD_BANNER_UNIT_ID);
  assert.equal(bannerUnitId(false, 'ca-app-pub-1/2'), 'ca-app-pub-1/2');
});

test('admins never see ads; everyone else does', () => {
  assert.equal(shouldShowAds(null), true);
  assert.equal(shouldShowAds({ is_admin: false }), true);
  assert.equal(shouldShowAds({}), true);
  assert.equal(shouldShowAds({ is_admin: true }), false);
});
