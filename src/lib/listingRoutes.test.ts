import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listingMenuRoute } from './listingRoutes.ts';

test('the listing menu route is the operator hub for that listing', () => {
  assert.deepEqual(listingMenuRoute('abc-123'), {
    pathname: '/operator/hub/[id]',
    params: { id: 'abc-123' },
  });
});

test('List Your Space opens the listing menu, replacing the form, on every submit path', () => {
  const src = readFileSync(new URL('../../app/operator/onboarding.tsx', import.meta.url), 'utf8');
  assert.match(src, /router\.replace\(listingMenuRoute\(locationId\)\)/);
  assert.doesNotMatch(src, /\/location\/\$\{/);
  assert.doesNotMatch(src, /router\.push\(/);
  // Submit, "Open listing" after an error, and "Continue without photo" all go through openListing.
  assert.equal((src.match(/openListing\(/g) ?? []).length, 3);
});
