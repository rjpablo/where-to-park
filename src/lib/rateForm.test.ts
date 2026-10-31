import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_RATE,
  formFromRate,
  fromDayStart,
  manilaDate,
  rateDatesError,
  rateUpsertPayload,
  toDayEnd,
} from './rateForm.ts';

test('dates are Manila days; "to" covers the whole last day', () => {
  assert.equal(fromDayStart('2026-12-24'), '2026-12-23T16:00:00.000Z');
  assert.equal(toDayEnd('2026-12-26'), '2026-12-26T15:59:59.000Z');
  assert.equal(fromDayStart(''), null);
  assert.equal(toDayEnd('12/26'), null);
});

test('stored timestamps read back as the same Manila day (no -1 day shift)', () => {
  assert.equal(manilaDate('2026-12-23T16:00:00+00:00'), '2026-12-24');
  assert.equal(manilaDate('2026-12-26T15:59:59+00:00'), '2026-12-26');
  assert.equal(manilaDate(fromDayStart('2026-01-01')), '2026-01-01');
  assert.equal(manilaDate(null), '');
});

test('edit keeps hidden fields (area, max per day, active, default)', () => {
  const rate = {
    id: 'r1',
    name: 'Weekend',
    rate_type: 'hourly',
    hourly_amount: '60.00',
    is_default: true,
    area_id: 'a1',
    max_per_day: '500.00',
    active: true,
    effective_from: '2026-12-23T16:00:00+00:00',
    effective_to: null,
  };
  const v = formFromRate(rate);
  assert.equal(v.hourly, '60.00');
  assert.equal(v.from, '2026-12-24');
  const p = rateUpsertPayload('L', v, rate);
  assert.equal(p.p_rate_id, 'r1');
  assert.equal(p.p_area_id, 'a1');
  assert.equal(p.p_max_per_day, '500.00');
  assert.equal(p.p_is_default, true);
  assert.equal(p.p_hourly_amount, 60);
  assert.equal(p.p_effective_from, '2026-12-23T16:00:00.000Z');
});

test('new rate payload', () => {
  const p = rateUpsertPayload('L', { ...NEW_RATE, name: ' Night ', to: '2026-12-26' });
  assert.equal(p.p_rate_id, null);
  assert.equal(p.p_name, 'Night');
  assert.equal(p.p_is_default, false);
  assert.equal(p.p_active, true);
  assert.equal(p.p_daily_amount, null);
  assert.equal(p.p_effective_to, '2026-12-26T15:59:59.000Z');
});

test('date validation', () => {
  assert.equal(rateDatesError({ from: '', to: '' }), null);
  assert.equal(
    rateDatesError({ from: '2026-12-26', to: '2026-12-24' }),
    'Effective to is before Effective from'
  );
  assert.match(rateDatesError({ from: '24/12', to: '' }) || '', /YYYY-MM-DD/);
});
