import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backFallback, BACK_FALLBACK_ROUTES } from './backFallback.ts';

const L = 'loc-1';

test('listing subpages fall back to that listing', () => {
  for (const r of [
    'operator/areas',
    'operator/rates',
    'operator/fees',
    'operator/staff',
    'operator/availability',
    'staff/checkin',
    'staff/sessions',
  ]) {
    assert.equal(backFallback(r, { locationId: L }), `/operator/hub/${L}`, r);
    assert.equal(backFallback(r, {}), '/operator/listings', `${r} without a listing`);
  }
  assert.equal(backFallback('operator/edit/[id]', { id: L }), `/operator/hub/${L}`);
  assert.equal(backFallback('operator/rates', { locationId: [L, 'x'] }), `/operator/hub/${L}`);
});

test('listing page and List Your Space fall back to My listings, My listings to search', () => {
  assert.equal(backFallback('operator/onboarding'), '/operator/listings');
  assert.equal(backFallback('operator/hub/[id]', { id: L }), '/operator/listings');
  assert.equal(backFallback('operator/listings'), '/search');
});

test('messages and chat', () => {
  assert.equal(backFallback('operator/inbox', { locationId: L }), `/operator/hub/${L}`);
  assert.equal(backFallback('operator/inbox', {}), '/search');
  assert.equal(backFallback('chat/[locationId]', { locationId: L }), `/location/${L}`);
  assert.equal(
    backFallback('chat/[locationId]', { locationId: L, driverId: 'd' }),
    '/operator/inbox'
  );
});

test('driver and admin screens fall back to search', () => {
  for (const r of [
    'auth',
    'profile',
    'notifications',
    'vehicles',
    'location/[id]',
    'admin/verify',
    'admin/reports',
  ])
    assert.equal(backFallback(r), '/search', r);
});

test('screens without Back have no fallback', () => {
  assert.equal(backFallback('search'), null);
  assert.equal(backFallback('index'), null);
  assert.ok(!BACK_FALLBACK_ROUTES.includes('search'));
});
