/** Areas (rj t139u, migration 0067): every listing has a Main area; spots, vehicle types,
 *  monitoring, Reserved/Unavailable, Full and sessions belong to an area. */
export type Area = {
  id: string;
  location_id?: string;
  name: string;
  is_main: boolean;
  sort_order?: number | null;
  capacity: number;
  vehicle_types: string[] | null;
  monitored: boolean;
  manual_reserved_count?: number | null;
  unavailable_count?: number | null;
  marked_full: boolean;
  /** Computed fields (select 'area_free, area_counted, area_occupied, area_full'). */
  area_free?: number | null;
  area_counted?: number | null;
  area_occupied?: number | null;
  area_full?: boolean | null;
};

export const AREA_SELECT =
  'id, location_id, name, is_main, sort_order, capacity, vehicle_types, monitored, manual_reserved_count, unavailable_count, marked_full, area_free, area_counted, area_occupied, area_full';

/** Main first, then the operator's order, then name. */
export function sortAreas<
  T extends Pick<Area, 'is_main' | 'name'> & { sort_order?: number | null },
>(areas: T[]): T[] {
  return [...areas].sort(
    (a, b) =>
      Number(b.is_main) - Number(a.is_main) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.name.localeCompare(b.name)
  );
}

/** The area a selector starts on: the preferred one if it is still there, else Main
 *  (the only choice when Main is the only area), else the first. */
export function defaultAreaId(
  areas: Pick<Area, 'id' | 'is_main'>[],
  preferred?: string | null
): string | null {
  if (preferred && areas.some((a) => a.id === preferred)) return preferred;
  return areas.find((a) => a.is_main)?.id ?? areas[0]?.id ?? null;
}

/** Whether an area takes a vehicle type (no list = every type). */
/** The vehicle types an area takes, in the given order (no restriction = all of them). */
export function allowedVehicleTypes<T extends string>(
  area: Pick<Area, 'vehicle_types'> | null | undefined,
  all: readonly T[]
): T[] {
  if (!area) return [...all];
  return all.filter((t) => areaAllowsVehicle(area, t));
}

/**
 * Vehicle after the area changes (rj): keep it if the area takes it; otherwise select the
 * only allowed type when there is exactly one, else clear it (staff pick one).
 */
export function vehicleForArea<T extends string>(
  current: T | null,
  allowed: readonly T[]
): T | null {
  if (current && allowed.includes(current)) return current;
  return allowed.length === 1 ? allowed[0] : null;
}

export function areaAllowsVehicle(
  area: Pick<Area, 'vehicle_types'>,
  vehicle: string | null | undefined
): boolean {
  const t = area.vehicle_types;
  return !vehicle || !t || t.length === 0 || t.includes(vehicle);
}

/** 'All vehicles' or the allowed types, e.g. 'Car, SUV'. */
export function vehicleTypesLabel(
  types: string[] | null | undefined,
  labels: Record<string, string>,
  allCount = Object.keys(labels).length
): string {
  if (!types || types.length === 0 || types.length >= allCount) return 'All vehicles';
  return types.map((t) => labels[t] || t).join(', ');
}

/** Operator status of one area: '7 / 20' when monitored (the real count, not 0 when
 *  switched Full), 'Available' / 'Full' when not monitored. */
export function areaStatusText(
  area: Pick<Area, 'monitored' | 'marked_full' | 'capacity'> & {
    area_counted?: number | null;
  }
): string {
  if (!area.monitored) return area.marked_full ? 'Full' : 'Available';
  return `${Math.max(0, Math.floor(Number(area.area_counted) || 0))} / ${area.capacity}`;
}

/**
 * What drivers see for a listing (search card, pin, Location details), from search_nearby /
 * the computed fields: `count` = free spaces over monitored areas (null when none is
 * monitored), `open` = not Full (Full only when every area is full).
 *  - Full: '0 spots' when some area is monitored, else 'Full'.
 *  - Not full with free monitored spots: 'n spots'.
 *  - Not full otherwise (only unmonitored areas, or the monitored ones are full but an
 *    unmonitored one is Available): 'Available'.
 */
export function listingAvailability(
  count: number | null | undefined,
  open: boolean | null | undefined
): { text: string; full: boolean; count: number | null } {
  const n =
    count == null || !Number.isFinite(Number(count))
      ? null
      : Math.max(0, Math.floor(Number(count)));
  const full = open === false;
  if (full) return { text: n == null ? 'Full' : '0 spots', full, count: n == null ? null : 0 };
  if (n != null && n > 0) return { text: `${n} ${n === 1 ? 'spot' : 'spots'}`, full, count: n };
  return { text: 'Available', full, count: n };
}

/** Plain messages for the area RPC errors. */
export function areaErrorMessage(
  code: unknown,
  extra?: { in_use?: number; area?: string }
): string {
  const c = String(code ?? '');
  switch (c) {
    case 'main_area_locked':
      return "The Main area can't be renamed or deleted.";
    case 'area_name_taken':
      return 'Another area already has that name.';
    case 'name_required':
      return 'Enter an area name.';
    case 'area_has_sessions':
      return 'This area has open sessions. End or move them first.';
    case 'capacity_invalid':
      return 'Enter the total number of spots (0 or more).';
    case 'capacity_below_in_use':
      return `Total spots can't be lower than the spots in use${
        extra?.in_use != null ? ` (${extra.in_use})` : ''
      }.`;
    case 'area_not_monitored':
      return "This area doesn't count spots.";
    case 'vehicle_not_allowed':
      return `This vehicle type isn't allowed in ${extra?.area || 'this area'}.`;
    case 'area_not_found':
      return 'That area no longer exists.';
    case 'no_longer_available':
      return "That's more spaces than are free right now.";
    case 'Permission denied':
      return "You don't have access to this listing.";
    default:
      return c || 'Something went wrong';
  }
}

/** Map-pin text (rj t140u): the free number; '0' on a Full listing's grey pin (also
 *  when no area is monitored); empty (a plain green pin) when available with no number. */
export function listingPinLabel(
  count: number | null | undefined,
  open: boolean | null | undefined
): string {
  const a = listingAvailability(count, open);
  if (a.full) return '0';
  return a.count != null && a.count > 0 ? String(a.count) : '';
}

/** Search results to show on the map and in the results sheet (rj t140u): Full listings
 *  only while 'Show Full' is on. The server already leaves them out (p_hide_full); this
 *  also drops them from rows still on screen until the new search comes back. */
export function visibleResults<
  T extends { available_count: number | null; open_status: boolean | null },
>(results: T[], showFull: boolean): T[] {
  return showFull
    ? results
    : results.filter((r) => !listingAvailability(r.available_count, r.open_status).full);
}
