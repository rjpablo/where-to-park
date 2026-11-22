/**
 * Area-specific rates (rj PAD-6, migration 0096). Every rate except the listing's default
 * belongs to one area. The default applies to any area, day and vehicle; an area rate
 * applies to that area's sessions and inherits its vehicle types.
 */
// Self-contained (node --test loads this file alone): same rules as areas.ts.
type Area = {
  id: string;
  name: string;
  is_main: boolean;
  vehicle_types: string[] | null;
};

function areaAllowsVehicle(area: Pick<Area, 'vehicle_types'>, vehicle: string): boolean {
  const t = area.vehicle_types;
  return !t || t.length === 0 || t.includes(vehicle);
}

/** Main first, then the operator's order, then name (as sortAreas). */
function sortAreas<T extends Pick<Area, 'is_main' | 'name'> & { sort_order?: number | null }>(
  areas: T[]
): T[] {
  return [...areas].sort(
    (a, b) =>
      Number(b.is_main) - Number(a.is_main) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.name.localeCompare(b.name)
  );
}

type RateLike = {
  id: string;
  is_default?: boolean | null;
  area_id?: string | null;
  vehicle_type?: string | null;
  deleted_at?: string | null;
};
type AreaLike = Pick<Area, 'id' | 'name' | 'is_main' | 'vehicle_types'> & {
  sort_order?: number | null;
};

export type AreaRateSection<R, A> = { area: A; rates: R[] };

/**
 * The default rate(s) first, then one section per area (Main first, then the operator's
 * order). Deleted rates, and rates whose area is gone, are left out.
 */
export function groupRatesByArea<R extends RateLike, A extends AreaLike>(
  rates: R[],
  areas: A[]
): { defaults: R[]; sections: AreaRateSection<R, A>[] } {
  const live = rates.filter((r) => !r.deleted_at);
  return {
    defaults: live.filter((r) => r.is_default),
    sections: sortAreas(areas).map((area) => ({
      area,
      rates: live.filter((r) => !r.is_default && r.area_id === area.id),
    })),
  };
}

/** Rates are grouped under area headings only when the listing has 2+ areas. */
export function showAreaHeadings(areas: unknown[]): boolean {
  return areas.length >= 2;
}

/**
 * Whether a rate applies to a vehicle (rate_fits_vehicle, 0098): an area rate takes
 * exactly its area's vehicle types (rj t239u); the default takes every vehicle. No
 * vehicle chosen: every rate counts.
 */
export function rateFitsVehicle(
  rate: RateLike,
  area: Pick<Area, 'vehicle_types'> | null | undefined,
  vehicle: string | null | undefined
): boolean {
  if (rate.deleted_at) return false;
  if (rate.is_default || !rate.area_id || !vehicle) return true;
  return !!area && areaAllowsVehicle(area, vehicle);
}
