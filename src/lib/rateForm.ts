// New/Edit rate form <-> upsert_rate payload. Dates are Asia/Manila calendar days.

export type RateFormValues = {
  name: string;
  rateType: 'hourly' | 'daily' | 'flat_then_hourly' | 'monthly';
  hourly: string;
  daily: string;
  monthly: string;
  firstHours: string;
  firstAmount: string;
  succeeding: string;
  /** YYYY-MM-DD (Manila) or '' */
  from: string;
  /** YYYY-MM-DD (Manila) or '', inclusive */
  to: string;
  /** Days of week the rate applies on (0 = Sunday … 6 = Saturday); empty = every day */
  days: number[];
  /** Vehicle type the rate is for ('car', 'suv', …); null = all vehicles */
  vehicleType: string | null;
};

export const NEW_RATE: RateFormValues = {
  name: 'Custom Rate',
  rateType: 'hourly',
  hourly: '50',
  daily: '400',
  monthly: '4000',
  firstHours: '3',
  firstAmount: '100',
  succeeding: '40',
  from: '',
  to: '',
  days: [],
  vehicleType: null,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Manila calendar day (YYYY-MM-DD) of a stored timestamp. */
export function manilaDate(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 'Effective from' day → the start of that Manila day (UTC ISO). */
export function fromDayStart(day: string): string | null {
  return DATE_RE.test(day) ? new Date(`${day}T00:00:00+08:00`).toISOString() : null;
}

/** 'Effective to' day (inclusive) → the last second of that Manila day (UTC ISO). */
export function toDayEnd(day: string): string | null {
  return DATE_RE.test(day) ? new Date(`${day}T23:59:59+08:00`).toISOString() : null;
}

/** Form values for an existing rate row. */
export function formFromRate(rate: any): RateFormValues {
  const s = (v: unknown, fallback: string) => (v == null ? fallback : String(v));
  return {
    name: rate.name ?? '',
    rateType: rate.rate_type,
    hourly: s(rate.hourly_amount, NEW_RATE.hourly),
    daily: s(rate.daily_amount, NEW_RATE.daily),
    monthly: s(rate.monthly_amount, NEW_RATE.monthly),
    firstHours: s(rate.first_hours, NEW_RATE.firstHours),
    firstAmount: s(rate.first_amount, NEW_RATE.firstAmount),
    succeeding: s(rate.succeeding_hourly_amount, NEW_RATE.succeeding),
    from: manilaDate(rate.effective_from),
    to: manilaDate(rate.effective_to),
    days: normalizeDays(rate.days_of_week),
    vehicleType: rate.vehicle_type ?? null,
  };
}

/** Returns an error message, or null when the dates are usable. */
export function rateDatesError(v: Pick<RateFormValues, 'from' | 'to'>): string | null {
  if (v.from && !DATE_RE.test(v.from)) return 'Effective from must be YYYY-MM-DD';
  if (v.to && !DATE_RE.test(v.to)) return 'Effective to must be YYYY-MM-DD';
  if (v.from && v.to && v.to < v.from) return 'Effective to is before Effective from';
  return null;
}

/** upsert_rate arguments. On edit, fields the form doesn't show (area, max per day,
 *  active, default) keep the rate's current values instead of being cleared. */
export function rateUpsertPayload(
  locationId: string,
  v: RateFormValues,
  existing?: any
): Record<string, unknown> {
  const t = v.rateType;
  return {
    p_location_id: locationId,
    p_rate_id: existing?.id ?? null,
    p_name: v.name.trim(),
    p_rate_type: t,
    p_is_default: existing?.is_default ?? false,
    p_hourly_amount: t === 'hourly' ? Number(v.hourly) : null,
    p_daily_amount: t === 'daily' ? Number(v.daily) : null,
    p_monthly_amount: t === 'monthly' ? Number(v.monthly) : null,
    p_first_hours: t === 'flat_then_hourly' ? Number(v.firstHours) : null,
    p_first_amount: t === 'flat_then_hourly' ? Number(v.firstAmount) : null,
    p_succeeding_hourly_amount: t === 'flat_then_hourly' ? Number(v.succeeding) : null,
    p_max_per_day: existing?.max_per_day ?? null,
    p_area_id: existing?.is_default ? null : (existing?.area_id ?? null),
    p_active: existing?.is_default ? true : (existing?.active ?? true),
    // The default rate applies every day with no dates (0042): never send them for it.
    p_effective_from: existing?.is_default ? null : fromDayStart(v.from),
    p_effective_to: existing?.is_default ? null : toDayEnd(v.to),
    p_days_of_week: existing?.is_default || !v.days.length ? null : normalizeDays(v.days),
    // The default applies to every vehicle (0047).
    p_vehicle_type: existing?.is_default ? null : v.vehicleType || null,
  };
}

/** Day chips in display order (Monday first), with the stored value (0 = Sunday). */
export const WEEK_DAYS: { value: number; short: string }[] = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
];

/** Valid, unique, sorted day numbers. */
export function normalizeDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  const ok = days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(ok)].sort((a, b) => a - b);
}

/** Toggle one day in the selection. */
export function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : normalizeDays([...days, day]);
}

/** Row label: 'Sat, Sun' (Monday-first order), 'Every day' when not limited. */
export function daysLabel(days: unknown): string {
  const set = new Set(normalizeDays(days));
  if (set.size === 0 || set.size === 7) return 'Every day';
  return WEEK_DAYS.filter((d) => set.has(d.value))
    .map((d) => d.short)
    .join(', ');
}
