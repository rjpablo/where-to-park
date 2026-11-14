import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendShortcut,
  dragTargetIndex,
  moveItem,
  parseGuestShortcuts,
  removeShortcut,
  shortcutLabel,
  sidebarShortcuts,
} from './shortcuts.ts';

const s = (id: string, available = true) => ({ locationId: id, name: id.toUpperCase(), available });

test('append at the bottom, no duplicates; remove', () => {
  let l = appendShortcut([], s('a'));
  l = appendShortcut(l, s('b'));
  l = appendShortcut(l, s('a'));
  assert.deepEqual(
    l.map((x) => x.locationId),
    ['a', 'b']
  );
  assert.deepEqual(
    removeShortcut(l, 'a').map((x) => x.locationId),
    ['b']
  );
});

test('moveItem and drag target', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveItem(['a', 'b'], 1, 9), ['a', 'b']);
  assert.equal(dragTargetIndex(0, 130, 64, 4), 2);
  assert.equal(dragTargetIndex(3, -500, 64, 4), 0);
  assert.equal(dragTargetIndex(1, 20, 64, 4), 1);
});

test('sidebar shows the first 3; labels for gone listings', () => {
  assert.deepEqual(
    sidebarShortcuts([s('a'), s('b'), s('c'), s('d')]).map((x) => x.locationId),
    ['a', 'b', 'c']
  );
  assert.equal(shortcutLabel(s('a')), 'A');
  assert.equal(shortcutLabel(s('a', false)), 'A (no longer available)');
  assert.equal(
    shortcutLabel({ locationId: 'x', name: null, available: false }),
    'Listing no longer available'
  );
});

test('guest storage parsing', () => {
  assert.deepEqual(parseGuestShortcuts(null), []);
  assert.deepEqual(parseGuestShortcuts('nope'), []);
  assert.deepEqual(
    parseGuestShortcuts('[{"locationId":"a","name":"A"},{"locationId":"a"},{"x":1}]'),
    [{ locationId: 'a', name: 'A' }]
  );
});

test('guest -> account merge helpers', async () => {
  const { shortcutSetKey, shortcutsToMerge } = await import('./shortcuts.ts');
  assert.equal(shortcutSetKey(['b', 'a', 'b']), 'a,b');
  assert.equal(shortcutSetKey(['a', 'b']), shortcutSetKey(['b', 'a']));
  assert.equal(shortcutSetKey([]), '');
  assert.deepEqual(shortcutsToMerge(['a'], ['c', 'a', 'b', 'c']), ['c', 'b']);
});
