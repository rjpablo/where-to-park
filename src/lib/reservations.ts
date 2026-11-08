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
