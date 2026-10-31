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
  daysLabel,
  normalizeDays,
  toggleDay,
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
  // the default is never area-limited (0047); a normal rate keeps its area
  assert.equal(p.p_area_id, null);
  assert.equal(rateUpsertPayload('L', v, { ...rate, is_default: false }).p_area_id, 'a1');
  assert.equal(p.p_max_per_day, '500.00');
  assert.equal(p.p_is_default, true);
  assert.equal(p.p_hourly_amount, 60);
  // the default never carries dates/days
  assert.equal(p.p_effective_from, null);
  const nd = rateUpsertPayload('L', { ...v, days: [0] }, { ...rate, is_default: false });
  assert.equal(nd.p_effective_from, '2026-12-23T16:00:00.000Z');
  assert.deepEqual(nd.p_days_of_week, [0]);
  assert.equal(rateUpsertPayload('L', { ...v, days: [0] }, rate).p_days_of_week, null);
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

test('days of week: label, toggle, payload', () => {
  assert.equal(daysLabel([0, 6]), 'Sat, Sun');
  assert.equal(daysLabel([6, 0, 1]), 'Mon, Sat, Sun');
  assert.equal(daysLabel(null), 'Every day');
  assert.equal(daysLabel([]), 'Every day');
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.deepEqual(normalizeDays([6, 6, 9, -1, 0]), [0, 6]);
  assert.deepEqual(toggleDay([0], 6), [0, 6]);
  assert.deepEqual(toggleDay([0, 6], 0), [6]);
  assert.equal(rateUpsertPayload('L', { ...NEW_RATE }).p_days_of_week, null);
  assert.deepEqual(rateUpsertPayload('L', { ...NEW_RATE, days: [6, 0] }).p_days_of_week, [0, 6]);
  assert.deepEqual(formFromRate({ rate_type: 'hourly', days_of_week: [6, 0] }).days, [0, 6]);
});

test('vehicle type: optional, empty = all vehicles, kept on edit', () => {
  assert.equal(NEW_RATE.vehicleType, null);
  assert.equal(rateUpsertPayload('L', { ...NEW_RATE }).p_vehicle_type, null);
  assert.equal(rateUpsertPayload('L', { ...NEW_RATE, vehicleType: 'suv' }).p_vehicle_type, 'suv');
  const v = formFromRate({
    id: 'r',
    name: 'SUV',
    rate_type: 'hourly',
    hourly_amount: 90,
    vehicle_type: 'suv',
  });
  assert.equal(v.vehicleType, 'suv');
  assert.equal(formFromRate({ id: 'r', name: 'X', rate_type: 'hourly' }).vehicleType, null);
});

test('editing the default never sends a vehicle, an area or inactive', () => {
  const dflt = {
    id: 'd',
    name: 'Std',
    rate_type: 'hourly',
    hourly_amount: 50,
    is_default: true,
    area_id: 'a',
    active: false,
  };
  const p = rateUpsertPayload('L', { ...formFromRate(dflt), vehicleType: 'car' }, dflt);
  assert.equal(p.p_vehicle_type, null);
  assert.equal(p.p_area_id, null);
  assert.equal(p.p_active, true);
});
