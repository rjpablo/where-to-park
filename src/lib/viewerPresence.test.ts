import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countViewers,
  viewerChannelName,
  viewerPresenceKey,
  viewersLabel,
} from './viewerPresence.ts';

test('channel name per listing', () => {
  assert.equal(viewerChannelName('abc'), 'listing-viewers:abc');
});

test('presence key: user id when signed in, device id for guests', () => {
  assert.equal(viewerPresenceKey('user-1', 'dev-9'), 'u:user-1');
  assert.equal(viewerPresenceKey(null, 'dev-9'), 'g:dev-9');
  assert.equal(viewerPresenceKey(undefined, 'dev-9'), 'g:dev-9');
});

test('countViewers counts unique keys, not tabs', () => {
  assert.equal(countViewers(null), 0);
  assert.equal(countViewers({}), 0);
  assert.equal(countViewers({ 'u:1': [{}, {}], 'g:a': [{}] }), 2);
  assert.equal(countViewers({ 'u:1': [], 'g:a': [{}] }), 1);
});

test('viewersLabel always shows a number', () => {
  assert.equal(viewersLabel(0), '👁 0 viewing now');
  assert.equal(viewersLabel(3), '👁 3 viewing now');
  assert.equal(viewersLabel(-1), '👁 0 viewing now');
  assert.equal(viewersLabel(Number.NaN), '👁 0 viewing now');
});
