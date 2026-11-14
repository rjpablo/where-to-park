import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerMapHeight, remainingTouches, samePin, showRestorePin } from './pinRestore.ts';

const saved = { latitude: 16.412345, longitude: 120.596789 };

test('restore shows only after the pin moves away from the saved one', () => {
  assert.equal(showRestorePin(saved, saved), false);
  assert.equal(showRestorePin({ latitude: 16.413, longitude: 120.596789 }, saved), true);
  assert.equal(showRestorePin({ latitude: 16.412345, longitude: 120.5968 }, saved), true);
});

test('no saved pin (onboarding): never shows', () => {
  assert.equal(showRestorePin(saved, null), false);
  assert.equal(showRestorePin(saved, undefined), false);
});

test('float noise is the same pin', () => {
  assert.equal(samePin(saved, { latitude: 16.41234500001, longitude: 120.59678899999 }), true);
});

test('pickerMapHeight: ~55% of the window, clamped', () => {
  assert.equal(pickerMapHeight(860), 473);
  assert.equal(pickerMapHeight(400), 320);
  assert.equal(pickerMapHeight(1400), 640);
  assert.equal(pickerMapHeight(NaN), 320);
});

test('remainingTouches: start counts fingers, end leaves out lifted ones either way', () => {
  assert.equal(remainingTouches(undefined, false), 1);
  assert.equal(remainingTouches({ touches: [{ identifier: 1 }, { identifier: 2 }] }, false), 2);
  // touches still lists the lifted finger
  const lifted = { touches: [{ identifier: 1 }], changedTouches: [{ identifier: 1 }] };
  assert.equal(remainingTouches(lifted, true), 0);
  // touches already without it
  assert.equal(remainingTouches({ touches: [], changedTouches: [{ identifier: 1 }] }, true), 0);
  // pinch: one of two fingers lifted
  const pinch = {
    touches: [{ identifier: 1 }, { identifier: 2 }],
    changedTouches: [{ identifier: 2 }],
  };
  assert.equal(remainingTouches(pinch, true), 1);
  assert.equal(remainingTouches(null, true), 0);
  // array-likes (web TouchList)
  const list = { length: 1, 0: { identifier: 7 } };
  assert.equal(remainingTouches({ touches: list, changedTouches: list }, true), 0);
});
