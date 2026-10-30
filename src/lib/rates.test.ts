import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRateParams, validateDefaultRate, type DefaultRateInput } from './rates.ts';

const base: DefaultRateInput = {
  rateType: 'hourly',
  hourly: '50',
  daily: '',
  monthly: '',
  firstHours: '3',
  firstAmount: '',
  succeeding: '',
};

test('hourly rate needs an hourly amount', () => {
  assert.equal(validateDefaultRate(base), null);
  assert.match(String(validateDefaultRate({ ...base, hourly: '' })), /Hourly/);
});

test('daily and monthly need their own amounts', () => {
  assert.match(String(validateDefaultRate({ ...base, rateType: 'daily' })), /Daily/);
  assert.equal(validateDefaultRate({ ...base, rateType: 'daily', daily: '300' }), null);
  assert.equal(validateDefaultRate({ ...base, rateType: 'monthly', monthly: '3500' }), null);
});

test('flat then hourly needs hours, flat amount and succeeding amount', () => {
  const flat = { ...base, rateType: 'flat_then_hourly' as const };
  assert.ok(validateDefaultRate(flat));
  assert.equal(validateDefaultRate({ ...flat, firstAmount: '100', succeeding: '30' }), null);
  assert.ok(
    validateDefaultRate({ ...flat, firstHours: '0', firstAmount: '100', succeeding: '30' })
  );
});

test('params only carry the chosen type amounts', () => {
  const p = defaultRateParams({ ...base, rateType: 'daily', daily: '300' });
  assert.equal(p.p_rate_type, 'daily');
  assert.equal(p.p_daily_amount, 300);
  assert.equal(p.p_hourly_amount, null);
  assert.equal(p.p_first_hours, null);
});
