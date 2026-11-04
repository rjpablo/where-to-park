import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeogPoint } from './geog.ts';

test('reads the hex EWKB point PostgREST returns', () => {
  // SM City Baguio: POINT(120.5980 16.4166), SRID 4326
  const p = parseGeogPoint('0101000020E610000083C0CAA145265E407B832F4CA66A3040');
  assert.ok(p);
  assert.ok(Math.abs(p.lng - 120.598) < 1e-9 && Math.abs(p.lat - 16.4166) < 1e-9);
});

test('reads GeoJSON and rejects junk', () => {
  assert.deepEqual(parseGeogPoint({ type: 'Point', coordinates: [120.5, 16.4] }), {
    lat: 16.4,
    lng: 120.5,
  });
  assert.equal(parseGeogPoint(null), null);
  assert.equal(parseGeogPoint('xyz'), null);
  assert.equal(parseGeogPoint('0102000020E6100000'), null);
});

test('listingPoint: search row lat/lng first, else geog EWKB', async () => {
  const { listingPoint } = await import('./geog.ts');
  assert.deepEqual(listingPoint({ latitude: 16.4, longitude: '120.5' }), { lat: 16.4, lng: 120.5 });
  const ewkb = '0101000020E6100000' + hexDouble(120.598) + hexDouble(16.4166);
  assert.deepEqual(listingPoint({ latitude: NaN, longitude: NaN, geog: ewkb }), {
    lat: 16.4166,
    lng: 120.598,
  });
  assert.equal(listingPoint({}), null);
});

function hexDouble(n: number): string {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, true);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
