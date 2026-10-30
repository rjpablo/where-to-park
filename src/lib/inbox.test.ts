import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUnreadFor,
  latestByThread,
  previewText,
  threadHasUnread,
  type InboxMessage,
} from './inbox.ts';

const DRIVER = 'driver';
const OWNER = 'owner';
const STAFF = 'staff';
const thread = { id: 't1', driver_id: DRIVER };
const msg = (over: Partial<InboxMessage>): InboxMessage => ({
  thread_id: 't1',
  sender_id: DRIVER,
  kind: 'text',
  body: 'Hi',
  read_at: null,
  hidden: false,
  created_at: '2026-10-31T00:00:00Z',
  ...over,
});

test('unread for the operator side: only unread messages from the driver', () => {
  assert.equal(isUnreadFor(msg({}), thread, OWNER), true);
  assert.equal(isUnreadFor(msg({ read_at: '2026-10-31T01:00:00Z' }), thread, OWNER), false);
  assert.equal(isUnreadFor(msg({ sender_id: STAFF }), thread, OWNER), false);
  assert.equal(isUnreadFor(msg({ sender_id: OWNER }), thread, OWNER), false);
  assert.equal(isUnreadFor(msg({ kind: 'system', sender_id: null }), thread, OWNER), false);
  assert.equal(isUnreadFor(msg({ hidden: true }), thread, OWNER), false);
});

test('unread for the driver: anything unread someone else sent', () => {
  assert.equal(isUnreadFor(msg({ sender_id: STAFF }), thread, DRIVER), true);
  assert.equal(isUnreadFor(msg({ sender_id: DRIVER }), thread, DRIVER), false);
  assert.equal(isUnreadFor(msg({}), thread, null), false);
});

test('threadHasUnread looks only at that thread', () => {
  const ms = [msg({ thread_id: 't2' }), msg({ read_at: 'x' })];
  assert.equal(threadHasUnread(thread, ms, OWNER), false);
  assert.equal(threadHasUnread(thread, [...ms, msg({})], OWNER), true);
});

test('latestByThread and previewText', () => {
  const a = msg({ body: 'old', created_at: '2026-10-31T00:00:00Z' });
  const b = msg({ body: '  new\nline ', created_at: '2026-10-31T00:05:00Z' });
  const latest = latestByThread([b, a]);
  assert.equal(latest.t1.body, '  new\nline ');
  assert.equal(previewText(latest.t1), 'new line');
  assert.equal(previewText(msg({ sender_id: OWNER, body: 'On my way' }), OWNER), 'You: On my way');
  assert.equal(previewText(msg({ kind: 'image', body: null })), '📷 Photo');
  assert.equal(previewText(msg({ hidden: true })), 'Message hidden');
  assert.equal(previewText(undefined), 'No messages yet');
});
