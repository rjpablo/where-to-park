import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carouselCounter, clampIndex, indexFromOffset } from './carousel.ts';

test('clampIndex keeps the start inside the photos', () => {
  assert.equal(clampIndex(2, 5), 2);
  assert.equal(clampIndex(9, 5), 4);
  assert.equal(clampIndex(-1, 5), 0);
  assert.equal(clampIndex(NaN, 5), 0);
  assert.equal(clampIndex(3, 0), 0);
});

test('indexFromOffset snaps to the nearest page', () => {
  assert.equal(indexFromOffset(0, 400, 5), 0);
  assert.equal(indexFromOffset(410, 400, 5), 1);
  assert.equal(indexFromOffset(790, 400, 5), 2);
  assert.equal(indexFromOffset(5000, 400, 5), 4);
  assert.equal(indexFromOffset(100, 0, 5), 0);
});

test("counter reads '2/5'", () => {
  assert.equal(carouselCounter(1, 5), '2/5');
  assert.equal(carouselCounter(0, 1), '1/1');
  assert.equal(carouselCounter(7, 5), '5/5');
  assert.equal(carouselCounter(0, 0), '');
});
