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
