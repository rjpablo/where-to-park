import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samePin, showRestorePin } from './pinRestore.ts';

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
