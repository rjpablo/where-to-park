import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionReasons,
  buildSidebarItems,
  EMPTY_COUNTS,
  formatCount,
  needsAttention,
  parseSidebarCounts,
  type SidebarCounts,
} from './sidebar.ts';

const base: SidebarCounts = { signed_in: true, triggers: {} };

test('badge: off for guests and when nothing is pending', () => {
  assert.equal(needsAttention(EMPTY_COUNTS), false);
  assert.equal(needsAttention({ ...EMPTY_COUNTS, unread_messages: 3 }), false);
  assert.equal(needsAttention({ ...base, listings: 4, vehicles: 2, pending_reports: 1 }), false);
});

test('badge: each trigger lights it by default (missing config = enabled)', () => {
  for (const key of [
    'unread_messages',
    'unread_notifications',
    'pending_verifications',
    'listing_reviewed',
    'profile_incomplete',
  ] as const) {
    assert.equal(needsAttention({ ...base, [key]: 1 }), true, key);
  }
});

test('badge: a trigger disabled in the database no longer lights it', () => {
  const counts: SidebarCounts = {
    signed_in: true,
    triggers: { unread_messages: false, unread_notifications: true },
    unread_messages: 5,
  };
  assert.equal(needsAttention(counts), false);
  assert.deepEqual(attentionReasons({ ...counts, unread_notifications: 1 }), [
    'unread_notifications',
  ]);
});

test('items: guest sees Sign in only', () => {
  assert.deepEqual(
    buildSidebarItems(null, EMPTY_COUNTS).map((i) => i.key),
    ['sign_in']
  );
});

test('items: driver vs operator vs admin are role-appropriate', () => {
  const driver = buildSidebarItems({ isAdmin: false, hasWorkspace: false }, base).map((i) => i.key);
  assert.deepEqual(driver, [
    'profile',
    'messages',
    'notifications',
    'list_space',
    'vehicles',
    'sign_out',
  ]);
  const op = buildSidebarItems({ isAdmin: false, hasWorkspace: true }, base).map((i) => i.key);
  assert.ok(op.includes('listings') && !op.includes('list_space') && !op.includes('verify'));
  const admin = buildSidebarItems({ isAdmin: true, hasWorkspace: true }, base);
  assert.deepEqual(
    admin.filter((i) => i.section === 'admin').map((i) => i.key),
    ['verify', 'moderation']
  );
  assert.equal(admin[admin.length - 1].key, 'sign_out');
});

test('items: each shows its own count; red only for enabled triggers', () => {
  const counts: SidebarCounts = {
    signed_in: true,
    triggers: { pending_verifications: false },
    unread_messages: 2,
    unread_notifications: 120,
    pending_verifications: 4,
    pending_reports: 1,
    listings: 3,
    vehicles: 2,
    profile_incomplete: 1,
  };
  const byKey = Object.fromEntries(
    buildSidebarItems({ isAdmin: true, hasWorkspace: true }, counts).map((i) => [i.key, i])
  );
  assert.equal(byKey.messages.countLabel, '2');
  assert.equal(byKey.messages.alert, true);
  assert.equal(byKey.notifications.countLabel, '99+');
  assert.equal(byKey.profile.countLabel, '!');
  assert.equal(byKey.profile.alert, true);
  assert.equal(byKey.listings.countLabel, '3');
  assert.equal(byKey.listings.alert, false);
  assert.equal(byKey.vehicles.countLabel, '2');
  assert.equal(byKey.verify.countLabel, '4');
  assert.equal(byKey.verify.alert, false, 'trigger disabled → grey');
  assert.equal(byKey.moderation.alert, false);
  assert.equal(byKey.sign_out.countLabel, '');
});

test('items: unseen verify/reject outcomes show on My listings in red', () => {
  const items = buildSidebarItems(
    { isAdmin: false, hasWorkspace: true },
    { ...base, listings: 3, listing_reviewed: 1 }
  );
  const listings = items.find((i) => i.key === 'listings')!;
  assert.equal(listings.countLabel, '1');
  assert.equal(listings.alert, true);
});

test('formatCount and parseSidebarCounts', () => {
  assert.equal(formatCount(0), '');
  assert.equal(formatCount(-1), '');
  assert.equal(formatCount(7), '7');
  assert.equal(formatCount(100), '99+');
  const parsed = parseSidebarCounts({
    signed_in: true,
    triggers: { unread_messages: false, bogus: true },
    unread_messages: '3',
    listings: null,
  });
  assert.equal(parsed.unread_messages, 3);
  assert.equal(parsed.listings, 0);
  assert.deepEqual(parsed.triggers, { unread_messages: false });
  assert.deepEqual(parseSidebarCounts(null), EMPTY_COUNTS);
});
