import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoOptionLabel,
  filterByPlate,
  normalizePlate,
  canApplyPayment,
  paymentsDisplay,
  presetsForLocation,
  removableFees,
  canEditSession,
  canEditSessionDetails,
  paymentPrefill,
  plateActiveMessage,
  plateConflict,
  sessionReturnRoute,
  priceBreakdownLines,
  setRateLabel,
  balanceToSettle,
  keepRateChoice,
  manilaDateTime,
  manilaToIso,
  paymentAmountError,
  rateOptionLabel,
  sessionTimes,
  walkInErrorMessage,
  fullAreaPrompt,
  fullAreaTitle,
  isFullAreaPrompt,
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
  assert.equal(
    autoOptionLabel({ mode: 'rate', rate_name: 'Standard Rate' }),
    'Automatic (Standard Rate)'
  );
  assert.equal(
    autoOptionLabel({ mode: 'monthly', rate_name: 'Monthly' }),
    'Automatic (Monthly, monthly)'
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

test('reservations: future start, labels (0049)', async () => {
  const { isReservation, startsIn, walkInErrorMessage } = await import('./walkIn.ts');
  const now = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(isReservation({ started_at: '2026-11-01T02:00:00Z', status: 'active' }, now), true);
  assert.equal(isReservation({ started_at: '2026-10-31T23:00:00Z', status: 'active' }, now), false);
  assert.equal(isReservation({ started_at: '2026-11-01T02:00:00Z', status: 'ended' }, now), false);
  assert.equal(startsIn('2026-11-01T00:30:00Z', now), 'in 30min');
  assert.equal(startsIn('2026-11-01T05:00:00Z', now), 'in 5h');
  assert.equal(startsIn('2026-11-03T00:00:00Z', now), 'in 2d');
  assert.equal(startsIn('2026-10-31T00:00:00Z', now), 'now');
  assert.match(walkInErrorMessage('not_started'), /Cancel the reservation/);
});

test('refund amounts (0052)', async () => {
  const { refundAmountError, walkInErrorMessage } = await import('./walkIn.ts');
  assert.equal(refundAmountError('20', 30), null);
  assert.equal(refundAmountError('30', 30), null);
  assert.match(refundAmountError('30.01', 30) || '', /up to ₱30.00/);
  assert.match(refundAmountError('0', 30) || '', /more than ₱0/);
  assert.match(walkInErrorMessage('refund_needs_ended'), /after the session ends/);
});

test('negative balances', async () => {
  const { isNegativeBalance } = await import('./walkIn.ts');
  assert.equal(isNegativeBalance(-5), true);
  assert.equal(isNegativeBalance('-0.001'), false);
  assert.equal(isNegativeBalance(0), false);
  assert.equal(isNegativeBalance(10), false);
});

test('session set rate label and split breakdown lines (0057)', () => {
  assert.equal(
    setRateLabel({ set_rate_name: 'Standard Rate', rate_auto: true }),
    'Automatic (Standard Rate)'
  );
  assert.equal(setRateLabel({ set_rate_name: 'QA Weekend', rate_auto: false }), 'QA Weekend');
  assert.equal(setRateLabel({}), '');
  const split = {
    breakdown: [
      { rate_name: 'Standard Rate', hours: 2, amount: 100 },
      { rate_name: 'Weekend', hours: 2, amount: 160 },
    ],
  };
  assert.deepEqual(priceBreakdownLines(split, 'Standard Rate'), [
    'Standard Rate: 2h · ₱100.00',
    'Weekend: 2h · ₱160.00',
  ]);
  const one = { breakdown: [{ rate_name: 'Standard Rate', hours: 3, amount: 150 }] };
  assert.deepEqual(priceBreakdownLines(one, 'Standard Rate'), []);
  // all hours fell back to another rate (e.g. the set rate doesn't apply): show it
  assert.deepEqual(priceBreakdownLines(one, 'Weekend'), ['Standard Rate: 3h · ₱150.00']);
  assert.deepEqual(
    priceBreakdownLines({ breakdown: [{ rate_name: 'M', months: 2, amount: 8000 }] }, 'X'),
    ['M: 2 mo · ₱8,000.00']
  );
  assert.deepEqual(priceBreakdownLines(null), []);
  assert.deepEqual(
    priceBreakdownLines(
      {
        breakdown: [
          {
            rate_name: 'Valet',
            rate_type: 'flat_then_hourly',
            hours: 5,
            amount: 180,
            first_hours: 3,
            first_amount: 100,
            succeeding_hours: 2,
            succeeding_amount: 80,
          },
        ],
      },
      'Valet'
    ),
    ['Flat for first 3h · ₱100.00', '2 succeeding hours · ₱80.00']
  );
});

test('filterByPlate: case- and space-insensitive substring; empty query keeps all', () => {
  const list = [
    { plate: 'ABC 1234' },
    { plate: 'xyz-987' },
    { plate: null },
    { plate: 'NBC 1235' },
  ];
  assert.equal(normalizePlate(' ab c1 '), 'ABC1');
  assert.deepEqual(filterByPlate(list, ''), list);
  assert.deepEqual(filterByPlate(list, '   '), list);
  assert.deepEqual(filterByPlate(list, 'abc1'), [{ plate: 'ABC 1234' }]);
  assert.deepEqual(filterByPlate(list, 'BC 123'), [{ plate: 'ABC 1234' }, { plate: 'NBC 1235' }]);
  assert.deepEqual(filterByPlate(list, 'XYZ-9'), [{ plate: 'xyz-987' }]);
  assert.deepEqual(filterByPlate(list, 'zzz'), []);
});

test('sessionReturnRoute: back to Availability when opened from its Sessions tab', () => {
  assert.deepEqual(sessionReturnRoute('availability', { locationId: 'L', ended: 'ABC' }), {
    pathname: '/operator/availability',
    params: { locationId: 'L', ended: 'ABC' },
  });
  assert.equal(sessionReturnRoute(undefined, {}).pathname, '/operator/availability');
  assert.equal(sessionReturnRoute('other', {}).pathname, '/operator/availability');
});

test('plate_active: friendly message naming the plate, and the session to open', () => {
  assert.equal(
    plateActiveMessage('QZ 7001'),
    'QZ 7001 already has an active session at this listing. End it first, or open it below.'
  );
  assert.match(plateActiveMessage(''), /already has an active session/);
  assert.equal(walkInErrorMessage('plate_active').includes('already has an active session'), true);
  assert.deepEqual(plateConflict({ error: 'plate_active', session_id: 's1', plate: 'QZ 7001' }), {
    id: 's1',
    plate: 'QZ 7001',
  });
  assert.equal(plateConflict({ error: 'other', session_id: 's1' }), null);
  assert.equal(plateConflict(null), null);
});

test('session page actions: edit while open; pay only with a balance; prefill', () => {
  assert.equal(canEditSession({ status: 'active' }), true);
  assert.equal(canEditSession({ status: 'overdue' }), true);
  assert.equal(canEditSession({ status: 'ended' }), false);
  assert.equal(canEditSession(null), false);
  const at = Date.parse('2026-11-09T00:00:00Z');
  assert.equal(
    canEditSessionDetails({ status: 'active', started_at: '2026-11-08T00:00:00Z' }, at),
    true
  );
  assert.equal(
    canEditSessionDetails({ status: 'active', started_at: '2026-11-10T00:00:00Z' }, at),
    false
  );
  assert.equal(canApplyPayment({ status: 'active' }, '50.00'), true);
  assert.equal(canApplyPayment({ status: 'active' }, 0), false);
  assert.equal(canApplyPayment({ status: 'active' }, -20), false);
  assert.equal(canApplyPayment({ status: 'ended' }, 50), false);
  const future = { status: 'active', started_at: '2026-11-10T00:00:00Z' };
  assert.equal(canApplyPayment({ ...future, approval_status: 'pending' }, 50, at), false);
  assert.equal(canApplyPayment({ ...future, approval_status: 'approved' }, 50, at), true);
  assert.equal(canApplyPayment({ ...future, approval_status: null }, 50, at), true);
  assert.equal(paymentPrefill(undefined, '120.5'), '120.50');
  assert.equal(paymentPrefill('40', 120), '40.00');
  assert.equal(paymentPrefill('500', 120), '120.00');
  assert.equal(paymentPrefill('abc', 120), '120.00');
  assert.equal(paymentPrefill('40', 0), '');
});

test('fees and payments in the balance box (t132u)', () => {
  const charges = [
    { id: 'a', type: 'additional_fee' },
    { id: 'b', type: 'adjustment' },
    { id: 'c', type: 'additional_fee' },
  ];
  assert.deepEqual(
    removableFees(charges).map((c) => c.id),
    ['a', 'c']
  );
  assert.deepEqual(removableFees(null), []);
  assert.equal(paymentsDisplay([]), 'none');
  assert.equal(paymentsDisplay(undefined), 'none');
  assert.equal(paymentsDisplay([{}]), 'single');
  assert.equal(paymentsDisplay([{}, {}]), 'collapsible');
  const presets = [
    { id: 1, location_id: 'L', active: true },
    { id: 2, location_id: 'X', active: true },
    { id: 3, location_id: null, active: true },
    { id: 4, location_id: 'L', active: false },
  ];
  assert.deepEqual(
    presetsForLocation(presets, 'L').map((p) => p.id),
    [1, 3]
  );
  assert.equal(
    walkInErrorMessage('session_closed'),
    'This session has ended, so its fees can no longer be changed.'
  );
});

test('area errors (0067) have plain messages', () => {
  assert.match(walkInErrorMessage('vehicle_not_allowed'), /isn't allowed in this area/);
  assert.match(walkInErrorMessage('no_longer_available_area'), /in this area/);
  assert.match(walkInErrorMessage('area_not_found'), /Pick another area/);
});

test('full area (0083): server answer -> confirm prompt', () => {
  assert.equal(fullAreaPrompt({ error: 'no_longer_available' }), null);
  assert.equal(fullAreaPrompt(null), null);
  const a = fullAreaPrompt({ error: 'area_full', reason: 'no_spaces', area: 'Basement' });
  assert.ok(a && isFullAreaPrompt(a));
  assert.equal(fullAreaTitle(a!), 'Basement has no spots left.');
  const b = fullAreaPrompt({ error: 'area_full', reason: 'marked_full', area: '' });
  assert.equal(fullAreaTitle(b!), 'This area is marked Full.');
  assert.equal(isFullAreaPrompt('No space'), false);
  assert.equal(isFullAreaPrompt(null), false);
});
