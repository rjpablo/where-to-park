/** Dropdown value for typing a vehicle instead of picking a saved one. */
export const INPUT_VEHICLE = 'input';

export type DriverSessionKind =
  'waiting' | 'approved' | 'active' | 'previous' | 'rejected' | 'cancelled';

export const DRIVER_SESSION_SECTIONS: { kind: DriverSessionKind; title: string }[] = [
  { kind: 'waiting', title: 'Waiting for approval' },
  { kind: 'approved', title: 'Approved reservations' },
  { kind: 'active', title: 'Active' },
  { kind: 'previous', title: 'Previous' },
  { kind: 'rejected', title: 'Rejected' },
  { kind: 'cancelled', title: 'Cancelled' },
];

type PolicyRow = { reservations_enabled?: boolean | null };

/** PostgREST may hand back the one policy row as an object or a one-element array. */
function onePolicy(policies: unknown): PolicyRow | null {
  if (Array.isArray(policies)) return (policies[0] as PolicyRow) ?? null;
  if (policies && typeof policies === 'object') return policies as PolicyRow;
  return null;
}

/** True only when the listing policy explicitly allows driver requests. */
export function reservationsAllowed(policies: unknown): boolean {
  return onePolicy(policies)?.reservations_enabled === true;
}

type AreaPick = {
  is_main?: boolean | null;
  name?: string | null;
  sort_order?: number | null;
  vehicle_types?: string[] | null;
};

/** The area a driver request is assigned: main when it takes the vehicle, else the next. */
export function areaForVehicle<T extends AreaPick>(
  areas: T[],
  vehicle: string | null | undefined
): T | null {
  if (!vehicle) return null;
  const takes = (area: AreaPick) => {
    const types = area.vehicle_types;
    return !types || types.length === 0 || types.includes(vehicle);
  };
  return (
    [...areas]
      .sort(
        (a, b) =>
          Number(!!b.is_main) - Number(!!a.is_main) ||
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          String(a.name ?? '').localeCompare(String(b.name ?? ''))
      )
      .find(takes) ?? null
  );
}

type KindInput = {
  approval_status?: string | null;
  cancelled_at?: string | null;
  status?: string | null;
  started_at?: string | null;
};

/** How a driver's own session is grouped. Rejected stays distinct from cancelled. */
export function driverSessionKind(s: KindInput, now = Date.now()): DriverSessionKind {
  if (s.approval_status === 'rejected') return 'rejected';
  if (s.cancelled_at) return 'cancelled';
  const start = s.started_at ? new Date(s.started_at).getTime() : NaN;
  const future = Number.isFinite(start) && start > now;
  if (future && s.status !== 'ended') {
    return s.approval_status === 'pending' ? 'waiting' : 'approved';
  }
  if (s.status === 'active' || s.status === 'overdue') return 'active';
  return 'previous';
}

const ERRORS: Record<string, string> = {
  reservations_disabled: 'This listing is not taking reservation requests.',
  start_not_future: 'The start has to be in the future.',
  end_required: 'Enter an end date and time.',
  end_before_start: 'End must be after the start.',
  no_applicable_rate: 'No rate applies to this vehicle for that stay.',
  no_area: 'No area at this listing takes this vehicle type.',
  nickname_required: 'Enter a name to save this vehicle.',
  vehicle_not_found: 'That saved vehicle is no longer available.',
  plate_required: 'Enter a plate number.',
  vehicle_required: 'Choose a vehicle type.',
  not_pending: 'This reservation can no longer be changed.',
  same_plate_overlap:
    'This reservation overlaps another reservation for the same plate, so it cannot be approved.',
  not_authenticated: 'Sign in to reserve a spot.',
  not_found: 'That listing or reservation could not be found.',
  'Permission denied': "You don't have access to do that.",
  already_started: 'This reservation has already started.',
  session_not_active: 'This reservation is already closed.',
  area_not_found: 'That area no longer exists.',
  vehicle_not_allowed: "This vehicle type isn't allowed in that area.",
};

export function reservationErrorMessage(code: unknown): string {
  const c = String(code ?? '');
  return ERRORS[c] || c || 'Something went wrong';
}

export type PlannedPriceLine = { label: string; amount: number };

/** What to show under the total: billed time, the sentence that explains it, and each rate. */
export type PlannedPriceDetail = {
  amount: number | null;
  summary: string | null;
  note: string | null;
  lines: PlannedPriceLine[];
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One rate in a price breakdown. A flat rate becomes the flat window plus succeeding hours. */
function pricePartLines(part: Record<string, unknown>, named: boolean): PlannedPriceLine[] {
  const amount = finite(part.amount);
  if (amount == null) return [];
  const name = String(part.rate_name || 'Rate');
  const months = finite(part.months);
  if (months != null && months > 0) return [{ label: `${name}: ${months} mo`, amount }];

  const firstHours = finite(part.first_hours);
  const firstAmount = finite(part.first_amount);
  if (
    part.rate_type === 'flat_then_hourly' &&
    firstHours != null &&
    firstHours > 0 &&
    firstAmount != null
  ) {
    const prefix = named ? `${name} · ` : '';
    const lines: PlannedPriceLine[] = [
      { label: `${prefix}Flat for first ${firstHours}h`, amount: firstAmount },
    ];
    const succeedingHours = finite(part.succeeding_hours);
    const succeedingAmount = finite(part.succeeding_amount);
    if (succeedingHours != null && succeedingHours > 0 && succeedingAmount != null) {
      lines.push({
        label: `${prefix}${succeedingHours} succeeding ${succeedingHours === 1 ? 'hour' : 'hours'}`,
        amount: succeedingAmount,
      });
    }
    return lines;
  }

  const hours = finite(part.hours);
  if (hours != null) return [{ label: `${name}: ${hours}h`, amount }];
  return [{ label: name, amount }];
}

/** Reads a session_price / reservation quote object. Null when it has nothing to show. */
export function plannedPriceDetail(price: unknown): PlannedPriceDetail | null {
  if (!price || typeof price !== 'object') return null;
  const row = price as Record<string, unknown>;
  const amount = finite(row.amount);
  const parts = Array.isArray(row.breakdown) ? row.breakdown : [];
  const named = parts.length > 1;
  const lines: PlannedPriceLine[] = [];
  let monthly = false;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (finite(p.months) != null && finite(p.months)! > 0) monthly = true;
    lines.push(...pricePartLines(p, named));
  }
  const billedMonths = finite(row.billed_months);
  const billedHours = finite(row.billed_hours);
  let summary: string | null = null;
  if (monthly || (billedMonths != null && billedMonths > 0)) {
    const n = billedMonths != null && billedMonths > 0 ? billedMonths : null;
    summary =
      n == null ? 'Billed in started months' : `${n} ${n === 1 ? 'month' : 'months'} billed`;
  } else if (billedHours != null && billedHours > 0) {
    summary = `${billedHours} ${billedHours === 1 ? 'hour' : 'hours'} billed`;
  }
  if (amount == null && lines.length === 0 && !summary) return null;
  return { amount, summary, note: null, lines };
}
