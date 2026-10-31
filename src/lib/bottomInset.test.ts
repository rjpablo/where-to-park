import test from 'node:test';
import assert from 'node:assert/strict';
import { bottomPadding } from './bottomInset.ts';

test('bottomPadding: own spacing plus the nav bar inset, once', () => {
  assert.equal(bottomPadding(24, 48, false), 72);
  assert.equal(bottomPadding(0, 48, false), 48);
  assert.equal(bottomPadding(24, 0, false), 24); // web / no nav bar
});

test('bottomPadding: no nav bar inset while the keyboard is up', () => {
  assert.equal(bottomPadding(24, 48, true), 24);
  assert.equal(bottomPadding(-5, -1, false), 0);
});
