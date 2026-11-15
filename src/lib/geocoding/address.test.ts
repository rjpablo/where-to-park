import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinateAddress, placeAddress, resolveListingAddress } from './address.ts';

test('place address joins the name and the detail once', () => {
  assert.equal(
    placeAddress({ name: 'Burnham Park', detail: 'Baguio, Cordillera' }),
    'Burnham Park, Baguio, Cordillera'
  );
  assert.equal(placeAddress({ name: 'Baguio', detail: 'Baguio' }), 'Baguio');
  assert.equal(placeAddress({ name: '', detail: 'Session Road' }), 'Session Road');
});

test('a typed address is kept; a blank one comes from the pin', async () => {
  const pin = { latitude: 16.412, longitude: 120.596 };
  const lookup = async () => 'Session Road, Baguio';
  assert.equal(await resolveListingAddress('  My gate  ', pin, lookup), 'My gate');
  assert.equal(await resolveListingAddress('   ', pin, lookup), 'Session Road, Baguio');
  assert.equal(
    await resolveListingAddress('', pin, async () => {
      throw new Error('offline');
    }),
    coordinateAddress(pin)
  );
  assert.equal(coordinateAddress(pin), '16.41200, 120.59600');
});
