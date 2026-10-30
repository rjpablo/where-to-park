import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteListing, deleteBlockedMessage, deleteOutcome } from './deleteListing.ts';

test('blocked message names the counts and what to do', () => {
  assert.equal(
    deleteBlockedMessage(2, 0),
    'This listing still has 2 active parking sessions. End every active session and cancel every active reservation first, then try again.'
  );
  assert.match(deleteBlockedMessage(1, 1), /1 active parking session and 1 active reservation\./);
  assert.match(deleteBlockedMessage(0, 3), /still has 3 active reservations\./);
  assert.match(deleteBlockedMessage(0, 0), /active sessions or reservations\./);
});

test('deleteOutcome maps RPC results', () => {
  assert.deepEqual(deleteOutcome({ success: true }), { kind: 'deleted' });
  const blocked = deleteOutcome({
    error: 'has_active',
    active_sessions: 1,
    active_reservations: 2,
  });
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.kind === 'blocked' && blocked.sessions, 1);
  assert.equal(blocked.kind === 'blocked' && blocked.reservations, 2);
  const forbidden = deleteOutcome({ error: 'forbidden' });
  assert.equal(
    forbidden.kind === 'error' && forbidden.message,
    'Only the listing owner can delete this listing.'
  );
  const notFound = deleteOutcome({ error: 'not_found' });
  assert.equal(notFound.kind, 'error');
  const reqErr = deleteOutcome(null, { message: 'network down' });
  assert.equal(reqErr.kind === 'error' && reqErr.message, 'network down');
  assert.equal(deleteOutcome(null).kind, 'error');
});

test('only owners can delete', () => {
  assert.equal(canDeleteListing('owner'), true);
  assert.equal(canDeleteListing('manager'), false);
  assert.equal(canDeleteListing('staff'), false);
  assert.equal(canDeleteListing(null), false);
});
