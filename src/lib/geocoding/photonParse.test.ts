import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoton } from './photonParse.ts';

const sample = {
  features: [
    {
      properties: {
        osm_type: 'W',
        osm_id: 330642136,
        type: 'other',
        name: 'Burnham Park',
        district: 'District 18',
        city: 'Baguio',
        state: 'Cordillera Administrative Region',
        extent: [120.592, 16.4132, 120.5975, 16.4027],
      },
      geometry: { type: 'Point', coordinates: [120.596, 16.408] },
    },
    {
      properties: {
        osm_type: 'N',
        osm_id: 1,
        type: 'city',
        name: 'Baguio',
        state: 'Cordillera Administrative Region',
      },
      geometry: { type: 'Point', coordinates: [120.59, 16.41] },
    },
    {
      properties: {
        osm_type: 'N',
        osm_id: 2,
        type: 'city',
        name: 'Baguio',
        state: 'Cordillera Administrative Region',
      },
      geometry: { type: 'Point', coordinates: [120.59, 16.41] },
    },
    { properties: { name: 'No geometry' } },
  ],
};

test('maps Photon features to suggestions', () => {
  const out = parsePhoton(sample);
  assert.equal(out.length, 2, 'drops duplicates and features without geometry');
  assert.equal(out[0].name, 'Burnham Park');
  assert.equal(out[0].detail, 'District 18, Baguio, Cordillera Administrative Region');
  assert.deepEqual(out[0].coordinate, { latitude: 16.408, longitude: 120.596 });
  assert.deepEqual(out[0].bounds, {
    ne: { latitude: 16.4132, longitude: 120.5975 },
    sw: { latitude: 16.4027, longitude: 120.592 },
  });
  assert.equal(out[1].zoom, 13);
  assert.equal(out[1].bounds, undefined);
});

test('handles empty or malformed responses', () => {
  assert.deepEqual(parsePhoton(null), []);
  assert.deepEqual(parsePhoton({ features: 'nope' }), []);
});
