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

test('split quote parts: per rate, Manila start times', async () => {
  const { quoteParts, manilaWeekdayTime } = await import('./quotePreview.ts');
  assert.equal(manilaWeekdayTime('2026-11-01T14:00:00+00:00'), 'Sun 22:00');
  assert.equal(manilaWeekdayTime('2026-11-01T16:00:00+00:00'), 'Mon 00:00');
  assert.equal(manilaWeekdayTime('nope'), '');
  // rj's example: Sun 22:00 for 4 h, weekend ₱60/h then weekday ₱40/h = ₱200
  const q = {
    amount: 200,
    breakdown: [
      {
        rate_id: 'w',
        rate_name: 'Weekend',
        hours: 2,
        amount: 120,
        from: '2026-11-01T14:00:00+00:00',
      },
      {
        rate_id: 'd',
        rate_name: 'Car Rate',
        hours: 2,
        amount: 80,
        from: '2026-11-01T16:00:00+00:00',
      },
    ],
  };
  const parts = quoteParts(q);
  assert.deepEqual(
    parts.map((p) => [p.rateName, p.hours, p.amount, p.from]),
    [
      ['Weekend', 2, 120, 'Sun 22:00'],
      ['Car Rate', 2, 80, 'Mon 00:00'],
    ]
  );
  assert.equal(
    parts.reduce((s, p) => s + p.amount, 0),
    q.amount
  );
  assert.deepEqual(quoteParts({ amount: 40 }), []);
  assert.deepEqual(quoteParts(null), []);
});
