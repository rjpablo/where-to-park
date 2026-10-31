import test from 'node:test';
import assert from 'node:assert/strict';
import { pathsNeedingUrl, sameMessages } from './signedUrls.ts';

test('pathsNeedingUrl: only missing or nearly expired paths, once, not in flight', () => {
  const now = 1_000_000;
  const cache = {
    fresh: { url: 'u1', expiresAt: now + 3_000_000 },
    stale: { url: 'u2', expiresAt: now + 60_000 },
    dataUrl: { url: 'data:', expiresAt: Number.POSITIVE_INFINITY },
  };
  const out = pathsNeedingUrl(
    ['fresh', 'stale', 'new', 'new', 'busy', 'dataUrl', ''],
    cache,
    new Set(['busy']),
    now,
    300_000
  );
  assert.deepEqual(out, ['stale', 'new']);
});

test('pathsNeedingUrl: repeated polls with a warm cache sign nothing (stable URLs)', () => {
  const now = 0;
  const cache = { a: { url: 'ua', expiresAt: 3_600_000 } };
  assert.deepEqual(pathsNeedingUrl(['a'], cache, new Set(), now, 300_000), []);
  assert.deepEqual(pathsNeedingUrl(['a'], cache, new Set(), now + 2_000, 300_000), []);
});

test('sameMessages compares ids, order, read state and body', () => {
  const a = [
    { id: '1', read_at: null, body: 'hi' },
    { id: '2', read_at: null, body: null },
  ];
  assert.equal(
    sameMessages(
      a,
      a.map((m) => ({ ...m }))
    ),
    true
  );
  assert.equal(sameMessages(a, [a[0]]), false);
  assert.equal(sameMessages(a, [a[1], a[0]]), false);
  assert.equal(sameMessages(a, [a[0], { ...a[1], read_at: 'now' }]), false);
  assert.equal(sameMessages(a, [{ ...a[0], body: 'edited' }, a[1]]), false);
});
