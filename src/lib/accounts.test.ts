import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLabel,
  accountSubLabel,
  askedKeyFor,
  markSignedOut,
  otherAccounts,
  parseAccounts,
  removeAccount,
  tokenKey,
  upsertAccount,
} from './accounts.ts';

test('saved accounts: add, refresh, sign out, remove', () => {
  let list = upsertAccount([], { userId: 'a', displayName: 'Juan', phone: '+1' }, 1);
  list = upsertAccount(list, { userId: 'b', displayName: 'Ana', phone: '+2', isAdmin: true }, 2);
  list = upsertAccount(list, { userId: 'a', displayName: 'Juan D' }, 3);
  assert.deepEqual(
    list.map((a) => [a.userId, a.displayName, a.phone, a.addedAt]),
    [
      ['a', 'Juan D', '+1', 1],
      ['b', 'Ana', '+2', 2],
    ]
  );
  list = markSignedOut(list, 'b');
  assert.equal(list[1].status, 'signed_out');
  assert.equal(accountSubLabel(list[1]), 'Signed out · tap to sign in again');
  // Signing in again makes it active, same place
  list = upsertAccount(list, { userId: 'b' }, 9);
  assert.equal(list[1].status, 'active');
  assert.equal(list[1].isAdmin, true);
  assert.equal(accountSubLabel(list[1]), 'Admin · +2');
  assert.deepEqual(
    otherAccounts(list, 'a').map((a) => a.userId),
    ['b']
  );
  assert.deepEqual(
    otherAccounts(list, null).map((a) => a.userId),
    ['a', 'b']
  );
  assert.deepEqual(
    removeAccount(list, 'a').map((a) => a.userId),
    ['b']
  );
});

test('parse is defensive; no secrets in the list', () => {
  assert.deepEqual(parseAccounts(null), []);
  assert.deepEqual(parseAccounts('nope'), []);
  const parsed = parseAccounts(
    JSON.stringify([{ userId: 'a', refresh_token: 'x' }, { userId: 'a' }, { nope: 1 }, null])
  );
  assert.equal(parsed.length, 1);
  assert.ok(!('refresh_token' in parsed[0]));
  assert.equal(parsed[0].status, 'active');
});

test('labels and keys', () => {
  assert.equal(accountLabel({ displayName: ' ', phone: '+63' }), '+63');
  assert.equal(accountLabel({}), 'Account');
  assert.equal(tokenKey('1234-abcd'), 'wtp-acct-1234-abcd');
  assert.equal(tokenKey('a/b'), 'wtp-acct-a_b');
  assert.equal(askedKeyFor('wtp-shortcuts-asked', 'u1'), 'wtp-shortcuts-asked:u1');
});

test('email accounts (email + password sign-in): saved, labelled, kept on refresh', () => {
  let list = upsertAccount(
    [],
    { userId: 'e', displayName: null, phone: null, email: 'sarah@example.com' },
    1
  );
  assert.equal(accountLabel(list[0]), 'sarah@example.com');
  list = upsertAccount(list, { userId: 'e', displayName: 'Sarah' }, 2);
  assert.equal(list[0].email, 'sarah@example.com');
  assert.equal(accountLabel(list[0]), 'Sarah');
  assert.equal(accountSubLabel(list[0]), 'sarah@example.com');
  assert.equal(parseAccounts(JSON.stringify(list))[0].email, 'sarah@example.com');
  assert.equal(parseAccounts(JSON.stringify([{ userId: 'old', phone: '+63' }]))[0].email, null);
});

test('profile photo (rj t179u): saved, kept when unknown, cleared on remove', () => {
  let list = upsertAccount(
    [],
    { userId: 'u1', displayName: 'A', avatarUrl: 'avatars/u1/1.jpg' },
    1
  );
  assert.equal(list[0].avatarUrl, 'avatars/u1/1.jpg');
  list = upsertAccount(list, { userId: 'u1', displayName: 'A' }, 2);
  assert.equal(list[0].avatarUrl, 'avatars/u1/1.jpg');
  list = upsertAccount(list, { userId: 'u1', avatarUrl: null }, 3);
  assert.equal(list[0].avatarUrl, null);
  assert.equal(parseAccounts(JSON.stringify([{ userId: 'u2', avatarUrl: 5 }]))[0].avatarUrl, null);
});
