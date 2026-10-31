/** Rate types supported by the `rate_type` enum in the database. */
export const RATE_TYPES = ['hourly', 'daily', 'flat_then_hourly', 'monthly'] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  flat_then_hourly: 'Flat then hourly',
  monthly: 'Monthly',
};

export type DefaultRateInput = {
  rateType: RateType;
  hourly: string;
  daily: string;
  monthly: string;
  firstHours: string;
  firstAmount: string;
  succeeding: string;
};

function amount(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Returns an error message, or null when the rate fields are valid for the chosen type. */
export function validateDefaultRate(input: DefaultRateInput): string | null {
  switch (input.rateType) {
    case 'hourly':
      return amount(input.hourly) == null ? 'Hourly rate is required' : null;
    case 'daily':
      return amount(input.daily) == null ? 'Daily rate is required' : null;
    case 'monthly':
      return amount(input.monthly) == null ? 'Monthly rate is required' : null;
    case 'flat_then_hourly': {
      const hours = Number(input.firstHours);
      if (!Number.isInteger(hours) || hours < 1)
        return 'First hours must be a whole number of 1 or more';
      if (amount(input.firstAmount) == null) return 'Flat amount is required';
      if (amount(input.succeeding) == null) return 'Succeeding hourly rate is required';
      return null;
    }
    default:
      return 'Choose a rate type';
  }
}

/** upsert_rate amount params for the chosen type; other amounts are null. */
export function defaultRateParams(input: DefaultRateInput) {
  const t = input.rateType;
  return {
    p_rate_type: t,
    p_hourly_amount: t === 'hourly' ? amount(input.hourly) : null,
    p_daily_amount: t === 'daily' ? amount(input.daily) : null,
    p_monthly_amount: t === 'monthly' ? amount(input.monthly) : null,
    p_first_hours: t === 'flat_then_hourly' ? Number(input.firstHours) : null,
    p_first_amount: t === 'flat_then_hourly' ? amount(input.firstAmount) : null,
    p_succeeding_hourly_amount: t === 'flat_then_hourly' ? amount(input.succeeding) : null,
  };
}

export function describeDefaultRate(input: DefaultRateInput): string {
  switch (input.rateType) {
    case 'hourly':
      return `₱${input.hourly}/hour`;
    case 'daily':
      return `₱${input.daily}/day`;
    case 'monthly':
      return `₱${input.monthly}/month`;
    case 'flat_then_hourly':
      return `₱${input.firstAmount} for the first ${input.firstHours}h, then ₱${input.succeeding}/hour`;
    default:
      return '';
  }
}

/** Search filter dropdown: 'All' (no rate-type filter) plus every rate type. */
export const RATE_FILTER_OPTIONS: { value: RateType | null; label: string }[] = [
  { value: null, label: 'All rate types' },
  ...RATE_TYPES.map((r) => ({ value: r, label: RATE_TYPE_LABELS[r] })),
];

export function isRateType(value: unknown): value is RateType {
  return typeof value === 'string' && (RATE_TYPES as readonly string[]).includes(value);
}

export type DefaultCandidate = {
  is_default?: boolean | null;
  rate_type: string;
  active?: boolean | null;
  effective_from?: string | null;
  effective_to?: string | null;
  days_of_week?: number[] | null;
};

/** Whether 'Set as default' is offered for a rate. Mirrors set_default_rate (0042): any
 *  rate type (monthly too), but the default applies every day with no dates, and must be
 *  active. */
export function canBeDefault(rate: DefaultCandidate): boolean {
  if (rate.is_default) return false;
  if (rate.effective_from || rate.effective_to) return false;
  if (Array.isArray(rate.days_of_week) && rate.days_of_week.length > 0) return false;
  return rate.active !== false;
}

const RATE_ERRORS: Record<string, string> = {
  cannot_delete_default:
    "The default rate can't be deleted. Make another rate the default first, then delete this one.",
  not_found: 'That rate no longer exists. Refresh the list.',
  not_authenticated: 'Sign in again to change rates.',
  'Permission denied': 'Only the listing owner or a manager can change rates.',
  name_required: 'Give the rate a name.',
  hourly_amount_required: 'Enter the hourly amount.',
  daily_amount_required: 'Enter the daily amount.',
  monthly_amount_required: 'Enter the monthly amount.',
  flat_then_hourly_fields_required:
    'Enter the first hours, their amount and the hourly amount after.',
  days_of_week_invalid: 'Pick days from Monday to Sunday.',
  default_cannot_have_dates: "The default rate can't have effective dates.",
  default_cannot_have_days: "The default rate can't be limited to days of the week.",
  default_must_be_active: 'Only an active rate can be the default.',
  'No rate found':
    'No rate covers this stay. Monthly rates never price a stay, so add an hourly, daily or flat rate for this time.',
};

/** Friendly text for a rate RPC error code (unknown messages pass through). */
export function rateErrorMessage(code: unknown): string {
  const key = String(code ?? '').trim();
  return RATE_ERRORS[key] ?? (key || 'Something went wrong. Try again.');
}
