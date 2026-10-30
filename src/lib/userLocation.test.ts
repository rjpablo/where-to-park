import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationMessage, permissionFrom, recenterAction } from './userLocation.ts';

test('recenter button: center, wait, request or explain', () => {
  assert.equal(recenterAction('granted', true), 'center');
  assert.equal(recenterAction('granted', false), 'wait');
  assert.equal(recenterAction('unknown', false), 'request');
  assert.equal(recenterAction('denied', false), 'request');
  assert.equal(recenterAction('blocked', false), 'message');
  assert.equal(recenterAction('unavailable', false), 'message');
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

test('recenter button rides just above the sheet and hides when there is no room', async () => {
  const { recenterButtonTop } = await import('./userLocation.ts');
  // peek: sheet top at 60% of a 780 px screen
  assert.equal(recenterButtonTop(468, 46, 16, 140), 406);
  // dragging the sheet up moves the button with it
  assert.equal(recenterButtonTop(300, 46, 16, 140), 238);
  // expanded (sheet top at 15%): no room below the search box -> hidden
  assert.equal(recenterButtonTop(117, 46, 16, 140), null);
  assert.equal(recenterButtonTop(201, 46, 16, 140), null);
  assert.equal(recenterButtonTop(202, 46, 16, 140), 140);
});
