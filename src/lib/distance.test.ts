import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DISTANCE_KM,
  formatDistanceKm,
  kmToPosition,
  positionToKm,
  roundDistanceKm,
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
