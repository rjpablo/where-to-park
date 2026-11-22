import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectionsError,
  formatManilaWhen,
  manilaToday,
  parseCollectionsReport,
  peso,
  presetRange,
  rangeFromDates,
  reportOperators,
  shiftManilaDate,
} from './collections.ts';

const NOW = new Date('2026-11-15T16:30:00.000Z'); // 16 Nov 2026, 00:30 in Manila

test('Manila day and a shift across a month end', () => {
  assert.equal(manilaToday(NOW), '2026-11-16');
  assert.equal(manilaToday(new Date('2026-11-15T15:59:00.000Z')), '2026-11-15');
  assert.equal(shiftManilaDate('2026-11-30', 1), '2026-12-01');
  assert.equal(shiftManilaDate('2026-11-16', -6), '2026-11-10');
});

test('preset ranges are Philippine days, end exclusive', () => {
  assert.deepEqual(presetRange('today', NOW), {
    from: '2026-11-15T16:00:00.000Z',
    to: '2026-11-16T16:00:00.000Z',
  });
  assert.deepEqual(presetRange('yesterday', NOW), {
    from: '2026-11-14T16:00:00.000Z',
    to: '2026-11-15T16:00:00.000Z',
  });
  assert.deepEqual(presetRange('last7', NOW), {
    from: '2026-11-09T16:00:00.000Z',
    to: '2026-11-16T16:00:00.000Z',
  });
  assert.deepEqual(presetRange('month', NOW), {
    from: '2026-10-31T16:00:00.000Z',
    to: '2026-11-30T16:00:00.000Z',
  });
});

test('a custom range covers the end date and refuses a backwards one', () => {
  assert.deepEqual(rangeFromDates('2026-11-16', '2026-11-16'), presetRange('today', NOW));
  assert.deepEqual(rangeFromDates('2026-02-30', '2026-03-01'), {
    error: 'Enter dates as YYYY-MM-DD.',
  });
  assert.deepEqual(rangeFromDates('2026-11-17', '2026-11-16'), {
    error: 'The end date is before the start.',
  });
});

test('peso, a Manila timestamp, and the refusal text', () => {
  assert.equal(peso(1234.5), '₱1,234.50');
  assert.equal(peso(0), '₱0.00');
  assert.equal(formatManilaWhen('2026-11-15T16:30:00.000Z'), '16 Nov 2026, 00:30');
  assert.equal(collectionsError('Permission denied'), 'Owners and managers only.');
  assert.equal(collectionsError('not_found'), 'That listing is not on this operator.');
});

test('the report payload fills every method and drops an unknown line', () => {
  const report = parseCollectionsReport({
    collected: '80.5',
    by_method: { cash: 100, gcash: '20' },
    extra_fees: 15,
    waived: 10,
    refunded: 20,
    open_balance: 40,
    lines_truncated: true,
    lines: [
      {
        id: 'p1',
        at: '2026-11-15T06:00:00.000Z',
        listing: 'Main lot',
        plate: 'ABC 123',
        direction: 'payment',
        method: 'cash',
        amount: 100,
        recorded_by: 'Juan',
      },
      { id: 'x', direction: 'void', amount: 1 },
    ],
  });
  assert.ok(!('error' in report));
  if ('error' in report) return;
  assert.equal(report.collected, 80.5);
  assert.equal(report.payments, 120);
  assert.deepEqual(
    report.byMethod.map((m) => [m.label, m.amount]),
    [
      ['Cash', 100],
      ['GCash', 20],
      ['Maya', 0],
      ['Card', 0],
      ['Other', 0],
    ]
  );
  assert.equal(report.extraFees, 15);
  assert.equal(report.waived, 10);
  assert.equal(report.refunded, 20);
  assert.equal(report.openBalance, 40);
  assert.equal(report.linesTruncated, true);
  assert.equal(report.lines.length, 1);
  assert.equal(report.lines[0].plate, 'ABC 123');
  assert.deepEqual(parseCollectionsReport({ error: 'Permission denied' }), {
    error: 'Owners and managers only.',
  });
  assert.equal('error' in parseCollectionsReport(null), true);
});

test('report operators keep owners and managers, earliest first', () => {
  assert.deepEqual(
    reportOperators([
      { operatorId: 'b', role: 'manager', createdAt: '2026-02-01', name: ' Second ' },
      { operatorId: 'a', role: 'staff', createdAt: '2026-01-01', name: 'Staff lot' },
      { operatorId: 'a', role: 'owner', createdAt: '2026-03-01', name: '' },
      { operatorId: 'b', role: 'owner', createdAt: '2026-04-01', name: 'Later' },
    ]),
    [
      { id: 'b', name: 'Second' },
      { id: 'a', name: 'Parking' },
    ]
  );
});
