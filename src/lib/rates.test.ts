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

test('canBeDefault: any type, but no dates, no days, active, not already default', async () => {
  const { canBeDefault } = await import('./rates.ts');
  assert.equal(canBeDefault({ rate_type: 'hourly' }), true);
  assert.equal(canBeDefault({ rate_type: 'monthly' }), true);
  assert.equal(canBeDefault({ rate_type: 'flat_then_hourly', days_of_week: [] }), true);
  assert.equal(canBeDefault({ rate_type: 'hourly', is_default: true }), false);
  assert.equal(canBeDefault({ rate_type: 'hourly', effective_from: '2026-12-24' }), false);
  assert.equal(canBeDefault({ rate_type: 'hourly', effective_to: '2026-12-26' }), false);
  assert.equal(canBeDefault({ rate_type: 'hourly', days_of_week: [0, 6] }), false);
  assert.equal(canBeDefault({ rate_type: 'hourly', active: false }), false);
});

test('rateErrorMessage maps codes, passes others through', async () => {
  const { rateErrorMessage } = await import('./rates.ts');
  assert.match(rateErrorMessage('cannot_delete_default'), /default rate can't be deleted/);
  assert.match(rateErrorMessage('Permission denied'), /owner or a manager/);
  assert.equal(rateErrorMessage('some other error'), 'some other error');
  assert.equal(rateErrorMessage(undefined), 'Something went wrong. Try again.');
});

test('the default is always applicable: no vehicle, area or spot (0047)', async () => {
  const { canBeDefault, rateErrorMessage } = await import('./rates.ts');
  const base = { rate_type: 'hourly', active: true };
  assert.equal(canBeDefault({ ...base }), true);
  assert.equal(canBeDefault({ ...base, vehicle_type: 'suv' }), false);
  assert.equal(canBeDefault({ ...base, area_id: 'a' }), false);
  assert.equal(canBeDefault({ ...base, slot_id: 's' }), false);
  assert.match(rateErrorMessage('default_cannot_have_vehicle'), /every vehicle/);
});

test('rate status errors: in-use count, default, archive (0048)', async () => {
  const { rateStatusErrorMessage, rateErrorMessage } = await import('./rates.ts');
  assert.match(
    rateStatusErrorMessage({ error: 'rate_in_use', sessions: 1 }),
    /^1 open session \(active or upcoming\) uses this rate/
  );
  assert.match(
    rateStatusErrorMessage({ error: 'rate_in_use', sessions: 3 }),
    /^3 open sessions .* use this rate. End them or pick another rate for them/
  );
  assert.match(
    rateStatusErrorMessage({ error: 'cannot_deactivate_default' }),
    /can't be deactivated/
  );
  assert.match(rateErrorMessage('archive_needs_inactive'), /Deactivate the rate/);
});
