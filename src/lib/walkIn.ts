// Walk-in sessions: Manila date/time fields, rate dropdown labels, payments, errors.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MANILA_MS = 8 * 3600_000;

/** Manila date (YYYY-MM-DD) and time (HH:MM) of an ISO timestamp; blanks for none. */
export function manilaDateTime(iso: string | null | undefined): { date: string; time: string } {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return { date: '', time: '' };
  const s = new Date(d.getTime() + MANILA_MS).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** Manila date + time → UTC ISO, or an error message naming the field. */
export function manilaToIso(date: string, time: string, field: string): string | { error: string } {
  if (!DATE_RE.test(date.trim())) return { error: `${field} date must be YYYY-MM-DD` };
  const m = time.trim().match(TIME_RE);
  if (!m) return { error: `${field} time must be HH:MM (24-hour)` };
  const d = new Date(`${date.trim()}T${m[1].padStart(2, '0')}:${m[2]}:00+08:00`);
  if (Number.isNaN(d.getTime()) || manilaDateTime(d.toISOString()).date !== date.trim())
    return { error: `${field} date is not a real date` };
  return d.toISOString();
}

export type SessionTimes = { startAt: string; endAt: string | null };

/** Start is required; end is optional (both blank = none) and must be after the start. */
export function sessionTimes(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
): SessionTimes | { error: string } {
  if (!startDate.trim() || !startTime.trim()) return { error: 'Start date and time are required' };
  const startAt = manilaToIso(startDate, startTime, 'Start');
  if (typeof startAt !== 'string') return startAt;
  if (!endDate.trim() && !endTime.trim()) return { startAt, endAt: null };
  if (!endDate.trim() || !endTime.trim())
    return { error: 'Enter both the end date and time, or clear the end' };
  const endAt = manilaToIso(endDate, endTime, 'End');
  if (typeof endAt !== 'string') return endAt;
  if (new Date(endAt) <= new Date(startAt)) return { error: 'End must be after the start' };
  return { startAt, endAt };
}

export type RateOption = {
  id: string;
  name: string;
  rate_type: string;
  is_default?: boolean;
  hourly_amount?: number | null;
  daily_amount?: number | null;
  monthly_amount?: number | null;
  first_hours?: number | null;
  first_amount?: number | null;
  succeeding_hourly_amount?: number | null;
};

const peso = (n: unknown) => `₱${Number(n ?? 0).toFixed(2)}`;

/** e.g. "Standard Rate · ₱50.00/h (default)". */
export function rateOptionLabel(r: RateOption): string {
  let price = '';
  switch (r.rate_type) {
    case 'hourly':
      price = `${peso(r.hourly_amount)}/h`;
      break;
    case 'daily':
      price = `${peso(r.daily_amount)}/day`;
      break;
    case 'monthly':
      price = `${peso(r.monthly_amount)}/month`;
      break;
    case 'flat_then_hourly':
      price = `${peso(r.first_amount)} first ${r.first_hours}h, then ${peso(r.succeeding_hourly_amount)}/h`;
      break;
  }
  return `${r.name} · ${price}${r.is_default ? ' (default)' : ''}`;
}

/** First dropdown option: what Automatic does right now. */
export function autoOptionLabel(auto: { mode: string; rate_name?: string } | null): string {
  if (!auto) return 'Automatic (no rate applies)';
  if (auto.mode === 'monthly') return `Automatic · ${auto.rate_name} (monthly)`;
  return 'Automatic · by priority, split across rates';
}

/** A chosen rate that is no longer applicable (vehicle/start changed) goes back to Automatic. */
export function keepRateChoice(rateId: string | null, options: RateOption[]): string | null {
  return rateId && options.some((o) => o.id === rateId) ? rateId : null;
}

export const PAYMENT_METHODS = ['cash', 'gcash', 'maya', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Card',
  other: 'Other',
};

/** Payment amount: more than 0, at most the balance (2 decimals). */
export function paymentAmountError(text: string, balance: number): string | null {
  const n = Number(text);
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return 'Enter an amount more than ₱0';
  if (Math.round(n * 100) > Math.round(balance * 100) + 0)
    return `The amount is more than the ${peso(balance)} balance`;
  return null;
}

/** Balance still to settle before the session can end (0 when settled). */
export function balanceToSettle(balance: unknown): number {
  const n = Number(balance);
  return Number.isFinite(n) && n > 0.01 ? Math.round(n * 100) / 100 : 0;
}

const ERRORS: Record<string, string> = {
  plate_required: 'Plate number is required',
  vehicle_required: 'Select the vehicle type',
  start_required: 'Start date and time are required',
  start_in_future: "The start can't be in the future",
  end_before_start: 'End must be after the start',
  no_applicable_rate:
    'No rate applies to this vehicle at this start time. Add a rate for it under Rates first.',
  rate_not_applicable: "The selected rate doesn't apply to this vehicle or start. Pick another.",
  no_longer_available: 'No space available right now',
  'Permission denied': "You don't have access to this listing's sessions.",
  session_not_active: 'This session has already ended.',
  folio_not_open: 'This session has already ended.',
  amount_required: 'Enter an amount more than ₱0',
  payment_exceeds_balance: 'The payment is more than the balance.',
  waiver_not_allowed: 'Staff cannot waive at this operator. Settle the balance with payments.',
  'No rate found': 'No rate covers this stay.',
  not_found: 'Session not found.',
};

/** Plain message for a walk-in RPC error code. */
export function walkInErrorMessage(code: unknown, balance?: unknown): string {
  const c = String(code ?? '');
  if (c === 'balance_due') return `Settle the ${peso(balance)} balance before ending the session.`;
  return ERRORS[c] || c || 'Something went wrong';
}
