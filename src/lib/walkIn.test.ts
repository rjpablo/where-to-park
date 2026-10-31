import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoOptionLabel,
  balanceToSettle,
  keepRateChoice,
  manilaDateTime,
  manilaToIso,
  paymentAmountError,
  rateOptionLabel,
  sessionTimes,
  walkInErrorMessage,
} from './walkIn.ts';

test('Manila date/time both ways', () => {
  assert.deepEqual(manilaDateTime('2026-11-01T14:00:00Z'), { date: '2026-11-01', time: '22:00' });
  assert.deepEqual(manilaDateTime('2026-11-01T16:30:00Z'), { date: '2026-11-02', time: '00:30' });
  assert.deepEqual(manilaDateTime(null), { date: '', time: '' });
  assert.equal(manilaToIso('2026-11-02', '0:30', 'Start'), '2026-11-01T16:30:00.000Z');
  assert.deepEqual(manilaToIso('2026-02-30', '10:00', 'Start'), {
    error: 'Start date is not a real date',
  });
  assert.deepEqual(manilaToIso('2026-11-02', '25:00', 'End'), {
    error: 'End time must be HH:MM (24-hour)',
  });
});

test('start required, end optional and after the start', () => {
  assert.deepEqual(sessionTimes('', '10:00', '', ''), {
    error: 'Start date and time are required',
  });
  assert.deepEqual(sessionTimes('2026-11-02', '', '', ''), {
    error: 'Start date and time are required',
  });
  assert.deepEqual(sessionTimes('2026-11-02', '10:00', '', ''), {
    startAt: '2026-11-02T02:00:00.000Z',
    endAt: null,
  });
  assert.deepEqual(sessionTimes('2026-11-02', '10:00', '2026-11-02', ''), {
    error: 'Enter both the end date and time, or clear the end',
  });
  assert.deepEqual(sessionTimes('2026-11-02', '10:00', '2026-11-02', '10:00'), {
    error: 'End must be after the start',
  });
  assert.deepEqual(sessionTimes('2026-11-02', '22:00', '2026-11-03', '01:00'), {
    startAt: '2026-11-02T14:00:00.000Z',
    endAt: '2026-11-02T17:00:00.000Z',
  });
});

test('rate dropdown labels and keeping a choice', () => {
  assert.equal(
    rateOptionLabel({
      id: 'a',
      name: 'Standard Rate',
      rate_type: 'hourly',
      hourly_amount: 50,
      is_default: true,
    }),
    'Standard Rate · ₱50.00/h (default)'
  );
  assert.equal(
    rateOptionLabel({ id: 'm', name: 'Monthly', rate_type: 'monthly', monthly_amount: 4000 }),
    'Monthly · ₱4000.00/month'
  );
  assert.equal(autoOptionLabel({ mode: 'split' }), 'Automatic · by priority, split across rates');
  assert.equal(
    autoOptionLabel({ mode: 'monthly', rate_name: 'Monthly' }),
    'Automatic · Monthly (monthly)'
  );
  assert.equal(autoOptionLabel(null), 'Automatic (no rate applies)');
  const opts = [{ id: 'a', name: 'A', rate_type: 'hourly' }];
  assert.equal(keepRateChoice('a', opts), 'a');
  assert.equal(keepRateChoice('sat-only', opts), null);
  assert.equal(keepRateChoice(null, opts), null);
});

test('payments and settling', () => {
  assert.equal(paymentAmountError('', 100), 'Enter an amount more than ₱0');
  assert.equal(paymentAmountError('0', 100), 'Enter an amount more than ₱0');
  assert.equal(paymentAmountError('abc', 100), 'Enter an amount more than ₱0');
  assert.equal(paymentAmountError('100.01', 100), 'The amount is more than the ₱100.00 balance');
  assert.equal(paymentAmountError('100', 100), null);
  assert.equal(paymentAmountError('40.5', 100), null);
  assert.equal(balanceToSettle('40'), 40);
  assert.equal(balanceToSettle(0.004), 0);
  assert.equal(balanceToSettle(-5), 0);
  assert.equal(balanceToSettle(null), 0);
  assert.equal(
    walkInErrorMessage('balance_due', 40),
    'Settle the ₱40.00 balance before ending the session.'
  );
  assert.equal(walkInErrorMessage('start_in_future'), "The start can't be in the future");
  assert.equal(walkInErrorMessage('weird_code'), 'weird_code');
});

test('waived amount from charges', async () => {
  const { waivedAmount, sessionWaived } = await import('./walkIn.ts');
  assert.equal(
    waivedAmount([
      { amount: -70, type: 'waiver' },
      { amount: 50, type: 'parking_fee' },
    ]),
    70
  );
  assert.equal(waivedAmount([{ amount: -70, type: 'waiver', voided_at: '2026-11-01' }]), 0);
  assert.equal(waivedAmount(null), 0);
  assert.equal(
    sessionWaived({ folios: [{ folio_charges: [{ amount: '-12.5', type: 'waiver' }] }] }),
    12.5
  );
  assert.equal(sessionWaived({ folios: { folio_charges: [{ amount: -5, type: 'waiver' }] } }), 5);
  assert.equal(sessionWaived({}), 0);
});
