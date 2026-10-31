import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  manilaTimeNow,
  manilaToday,
  previewDayLabel,
  previewHours,
  previewStartAt,
} from './quotePreview.ts';

test('today and now are Manila, not UTC', () => {
  const lateUtc = new Date('2026-11-06T17:30:00Z'); // Sat 01:30 in Manila
  assert.equal(manilaToday(lateUtc), '2026-11-07');
  assert.equal(manilaTimeNow(lateUtc), '01:30');
});

test('start = Manila date + time', () => {
  assert.deepEqual(previewStartAt('2026-11-07', '07:30'), { startAt: '2026-11-06T23:30:00.000Z' });
  assert.deepEqual(previewStartAt('2026-11-07', '9:05'), { startAt: '2026-11-07T01:05:00.000Z' });
  assert.ok('error' in previewStartAt('2026-02-30', '10:00'));
  assert.ok('error' in previewStartAt('11/07/2026', '10:00'));
  assert.ok('error' in previewStartAt('2026-11-07', '25:00'));
  assert.ok('error' in previewStartAt('2026-11-07', ''));
});

test('hours', () => {
  assert.equal(previewHours('2'), 2);
  assert.equal(previewHours('1.5'), 1.5);
  assert.ok(typeof previewHours('0') === 'object');
  assert.ok(typeof previewHours('abc') === 'object');
  assert.ok(typeof previewHours('') === 'object');
});

test('day label', () => {
  assert.equal(previewDayLabel('2026-11-07'), 'Sat, Nov 7, 2026');
  assert.equal(previewDayLabel('2026-1'), '');
});
