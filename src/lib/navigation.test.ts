import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  geoUri,
  NAV_APP_OPTIONS,
  navigateLabel,
  navigationUrl,
  preferredNavApp,
} from './navigation.ts';

const t = { lat: 16.4166, lng: 120.598, name: 'SM City (Main) Parking' };

test('profile choice picks the app', () => {
  assert.equal(
    navigationUrl('google_maps', t, 'android'),
    'https://www.google.com/maps/dir/?api=1&destination=16.4166,120.598'
  );
  assert.equal(
    navigationUrl('waze', t, 'android'),
    'https://waze.com/ul?ll=16.4166,120.598&navigate=yes'
  );
  assert.equal(navigationUrl('default', t, 'android'), geoUri(t));
  assert.equal(navigationUrl('default', t, 'web'), navigationUrl('google_maps', t, 'web'));
  assert.equal(navigationUrl('default', t, 'ios'), 'maps://?daddr=16.4166,120.598');
});

test('geo: URI carries coordinates and an encoded label', () => {
  assert.equal(geoUri(t), 'geo:16.4166,120.598?q=16.4166,120.598(SM%20City%20Main%20Parking)');
  assert.equal(geoUri({ lat: 1, lng: 2 }), 'geo:1,2?q=1,2');
});

test('guests and unset preference use the phone default; labels', () => {
  assert.equal(preferredNavApp(null), 'default');
  assert.equal(preferredNavApp(undefined), 'default');
  assert.equal(preferredNavApp('default'), 'default');
  assert.equal(preferredNavApp('waze'), 'waze');
  assert.equal(navigateLabel('default'), 'Navigate');
  assert.equal(navigateLabel('waze'), 'Navigate with Waze');
  assert.equal(navigateLabel('google_maps'), 'Navigate with Google Maps');
});

test('profile maps-app dropdown options', () => {
  assert.deepEqual(
    NAV_APP_OPTIONS.map((o) => [o.value, o.label]),
    [
      ['default', 'Phone default'],
      ['google_maps', 'Google Maps'],
      ['waze', 'Waze'],
    ]
  );
});
