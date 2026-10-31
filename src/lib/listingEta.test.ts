import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceEtaLabel,
  etaFor,
  etaText,
  pickEtaOrigin,
  straightLineMeters,
} from './listingEta.ts';
import { formatDistance, formatDuration } from '../utils/formatters.ts';

const fmt = { distance: formatDistance, duration: formatDuration };

test('origin: the search centre (as the list), else my location, else none', () => {
  const s = { lat: 16.4023, lng: 120.596 };
  const me = { lat: 16.41, lng: 120.6 };
  assert.deepEqual(pickEtaOrigin(s, me), { ...s, kind: 'search' });
  assert.deepEqual(pickEtaOrigin(null, me), { ...me, kind: 'you' });
  assert.equal(pickEtaOrigin(null, null), null);
  assert.deepEqual(pickEtaOrigin({ lat: NaN, lng: 1 }, me), { ...me, kind: 'you' });
});

test('straight-line distance matches a known Baguio hop (~1.5 km)', () => {
  const d = straightLineMeters({ lat: 16.4023, lng: 120.596 }, { lat: 16.4166, lng: 120.598 });
  assert.ok(d > 1550 && d < 1620, String(d));
  assert.equal(straightLineMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('etaFor picks the listing from a get_etas response', () => {
  const etas = [
    { location_id: 'a', duration_s: 240, source: 'ors' },
    { location_id: 'b', duration_s: 300, source: 'estimate' },
  ];
  assert.deepEqual(etaFor(etas, 'b'), { duration_s: 300, source: 'estimate' });
  assert.equal(etaFor(etas, 'c'), null);
  assert.equal(etaFor(undefined, 'a'), null);
  assert.equal(etaFor([{ location_id: 'a', duration_s: null }], 'a'), null);
});

test('eta text matches the list: est. only for estimates', () => {
  assert.equal(etaText({ duration_s: 240, source: 'ors' }, formatDuration), '4min');
  assert.equal(etaText({ duration_s: 240, source: 'estimate' }, formatDuration), '4min est.');
  assert.equal(etaText(null, formatDuration), '');
});

test('details line: distance + eta + origin; distance only when routing fails', () => {
  assert.equal(
    distanceEtaLabel(1234, { duration_s: 240, source: 'estimate' }, 'search', fmt),
    '1.2km · 4min est. from the search area'
  );
  assert.equal(distanceEtaLabel(850, null, 'you', fmt), '850m from you');
  assert.equal(distanceEtaLabel(null, null, 'search', fmt), '');
  assert.equal(distanceEtaLabel(500, null, null, fmt), '');
});
