import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SLIDE_CONFIRM_THRESHOLD,
  clampSlide,
  slideConfirms,
  slideProgress,
  slideTravel,
} from './slideToConfirm.ts';

test('slideTravel: track minus knob and padding, never negative', () => {
  assert.equal(slideTravel(300, 52, 4), 240);
  assert.equal(slideTravel(40, 52, 4), 0);
});

test('clampSlide keeps the knob on the track', () => {
  assert.equal(clampSlide(-20, 240), 0);
  assert.equal(clampSlide(100, 240), 100);
  assert.equal(clampSlide(999, 240), 240);
  assert.equal(clampSlide(50, 0), 0);
  assert.equal(clampSlide(Number.NaN, 240), 0);
});

test('slideProgress is 0..1', () => {
  assert.equal(slideProgress(0, 240), 0);
  assert.equal(slideProgress(120, 240), 0.5);
  assert.equal(slideProgress(500, 240), 1);
  assert.equal(slideProgress(10, 0), 0);
});

test('slideConfirms only near the end of the track', () => {
  assert.equal(SLIDE_CONFIRM_THRESHOLD, 0.9);
  assert.equal(slideConfirms(240, 240), true);
  assert.equal(slideConfirms(216, 240), true);
  assert.equal(slideConfirms(215, 240), false);
  assert.equal(slideConfirms(120, 240), false);
  assert.equal(slideConfirms(0, 0), false);
});
