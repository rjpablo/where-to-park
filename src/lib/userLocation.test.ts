import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceLocationPending,
  locationMessage,
  openingSearchCenter,
  permissionFrom,
  recenterAction,
} from './userLocation.ts';

test('recenter button: center, wait, request or explain', () => {
  assert.equal(recenterAction('granted', true), 'center');
  assert.equal(recenterAction('granted', false), 'wait');
  assert.equal(recenterAction('unknown', false), 'request');
  assert.equal(recenterAction('denied', false), 'request');
  assert.equal(recenterAction('blocked', false), 'message');
  assert.equal(recenterAction('unavailable', false), 'message');
});

test('opening search uses a link, else the device, else nothing', () => {
  const link = { lat: 1, lng: 2 };
  const device = { lat: 3, lng: 4 };
  assert.deepEqual(openingSearchCenter(link, device), link);
  assert.deepEqual(openingSearchCenter(null, device), device);
  assert.deepEqual(openingSearchCenter(null, null), null);
});

test('a missing device fix is a wait only while a fix can still arrive', () => {
  assert.equal(deviceLocationPending('unknown', false), true);
  assert.equal(deviceLocationPending('granted', false), true);
  assert.equal(deviceLocationPending('granted', true), false);
  assert.equal(deviceLocationPending('denied', false), false);
  assert.equal(deviceLocationPending('blocked', false), false);
  assert.equal(deviceLocationPending('unavailable', false), false);
});

test('permission mapping and messages', () => {
  assert.equal(permissionFrom({ status: 'granted', granted: true }), 'granted');
  assert.equal(permissionFrom({ status: 'undetermined', canAskAgain: true }), 'unknown');
  assert.equal(permissionFrom({ status: 'denied', canAskAgain: true }), 'denied');
  assert.equal(permissionFrom({ status: 'denied', canAskAgain: false }), 'blocked');
  assert.equal(locationMessage('granted'), null);
  assert.equal(locationMessage('unknown'), null);
  assert.match(locationMessage('denied')!, /denied/);
  assert.match(locationMessage('blocked')!, /Settings/);
  assert.match(locationMessage('unavailable')!, /location/);
});
