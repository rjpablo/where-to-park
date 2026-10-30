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
