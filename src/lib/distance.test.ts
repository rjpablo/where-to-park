import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DISTANCE_KM,
  SEARCH_START_ZOOM,
  centerToCornerMeters,
  fitDistanceToMax,
  formatDistanceKm,
  kmToPosition,
  positionToKm,
  roundDistanceKm,
  sliderMaxKm,
  stepDistanceKm,
} from './distance.ts';

test('slider ends map to the range limits', () => {
  assert.equal(positionToKm(0), 0.5);
  assert.equal(positionToKm(1), 50);
  assert.equal(positionToKm(-1), 0.5);
  assert.equal(positionToKm(2), 50);
});

test('position and km round-trip on the default', () => {
  assert.equal(positionToKm(kmToPosition(DEFAULT_DISTANCE_KM)), DEFAULT_DISTANCE_KM);
  assert.ok(kmToPosition(5) > 0.4 && kmToPosition(5) < 0.6, 'log scale puts 5 km mid-track');
  assert.equal(DEFAULT_DISTANCE_KM, 3);
});

test('rounding and steps', () => {
  assert.equal(roundDistanceKm(3.26), 3.5);
  assert.equal(roundDistanceKm(12.4), 12);
  assert.equal(roundDistanceKm(0.1), 0.5);
  assert.equal(stepDistanceKm(5, 1), 5.5);
  assert.equal(stepDistanceKm(10, 1), 11);
  assert.equal(stepDistanceKm(10, -1), 9.5);
  assert.equal(stepDistanceKm(50, 1), 50);
});

test('formatting', () => {
  assert.equal(formatDistanceKm(0.5), '0.5 km');
  assert.equal(formatDistanceKm(5), '5 km');
  assert.equal(formatDistanceKm(12), '12 km');
});

test('slider max follows the farthest visible edge, rounded up, min 0.5 km', () => {
  assert.equal(sliderMaxKm(1230), 1.5);
  assert.equal(sliderMaxKm(1500), 1.5);
  assert.equal(sliderMaxKm(120), 0.5);
  assert.equal(sliderMaxKm(12_300), 13);
  assert.equal(sliderMaxKm(400_000), 50, 'hard cap');
});

test('preferred/default distance is kept only when it fits under the max', () => {
  assert.equal(fitDistanceToMax(5, 13), 5);
  assert.equal(fitDistanceToMax(5, 1.5), 1.5);
  assert.equal(fitDistanceToMax(20, 13), 13);
});

test('slider scale ends at the dynamic max', () => {
  assert.equal(positionToKm(1, 1.5), 1.5);
  assert.equal(positionToKm(0, 1.5), 0.5);
  assert.equal(positionToKm(1, 0.5), 0.5);
  assert.equal(kmToPosition(1.5, 1.5), 1);
  assert.ok(roundDistanceKm(14, 13) <= 13);
});

test('opening zoom makes the 3 km default selectable at launch', () => {
  const lat = 16.4023; // Baguio
  const typical = centerToCornerMeters(412, 800, SEARCH_START_ZOOM, lat);
  assert.ok(typical >= 3000, `typical phone corner ${Math.round(typical)} m`);
  assert.ok(sliderMaxKm(typical) >= DEFAULT_DISTANCE_KM);
  const small = centerToCornerMeters(360, 580, SEARCH_START_ZOOM, lat);
  assert.ok(sliderMaxKm(small) >= DEFAULT_DISTANCE_KM, `small phone corner ${Math.round(small)} m`);
  assert.equal(fitDistanceToMax(DEFAULT_DISTANCE_KM, sliderMaxKm(typical)), 3);
  // "just enough": a quarter zoom closer would no longer reach 3 km on a small phone
  assert.ok(sliderMaxKm(centerToCornerMeters(360, 580, SEARCH_START_ZOOM + 0.25, lat)) < 3);
});
