/** Distance filter range for search results (km). */
export const MIN_DISTANCE_KM = 0.5;
/**
 * Hard cap on the slider max. The max normally follows the searched area (see
 * sliderMaxKm); this only stops a fully zoomed-out map from asking for a
 * country-wide radius.
 */
export const MAX_DISTANCE_KM = 50;
export const DEFAULT_DISTANCE_KM = 3;

/**
 * Opening zoom of the search map. Low enough that the farthest visible corner is
 * at least DEFAULT_DISTANCE_KM away on a typical phone (map area ~412×800 dp at
 * Baguio's latitude ≈ 3.5 km), so the 3 km default is selectable at launch.
 * Smaller screens (~360×580 dp, ≈ 2.6 km) still get a 3 km max because the max
 * rounds up to the next 0.5 km step. See distance.test.ts.
 */
export const SEARCH_START_ZOOM = 13.25;

const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Metres per screen point at a zoom level (MapLibre, 512px tiles) and latitude. */
export function metersPerPoint(zoom: number, latitude: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Distance from the map centre to a corner for a map of the given size (points). */
export function centerToCornerMeters(
  width: number,
  height: number,
  zoom: number,
  latitude: number
): number {
  return Math.hypot(width / 2, height / 2) * metersPerPoint(zoom, latitude);
}

/**
 * Zoom at which the farthest map corner is `cornerMeters` from the centre.
 * A smaller distance is a closer zoom.
 */
export function zoomForCornerMeters(
  width: number,
  height: number,
  cornerMeters: number,
  latitude: number
): number | null {
  if (width <= 0 || height <= 0 || !(cornerMeters > 0)) return null;
  const half = Math.hypot(width / 2, height / 2);
  const cos = Math.cos((latitude * Math.PI) / 180);
  if (cos <= 0) return null;
  const zoom = Math.log2((half * EARTH_CIRCUMFERENCE_M * cos) / (512 * cornerMeters));
  return Number.isFinite(zoom) ? Math.max(0, zoom) : null;
}

/** Whole-kilometre range an admin may store as the search cap. */
export const SEARCH_CAP_MIN_KM = 1;
export const SEARCH_CAP_MAX_KM = 500;

/** Cap used for a search. A missing or unusable value keeps the 50 km default. */
export function searchCapKm(capKm: number | null | undefined): number {
  const n = typeof capKm === 'number' ? capKm : Number(capKm);
  if (!Number.isFinite(n) || n < MIN_DISTANCE_KM) return MAX_DISTANCE_KM;
  return n;
}

/** Admin entry: a whole number of kilometres from 1 to 500. */
export function parseSearchCapKm(raw: string): { km: number } | { error: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { error: 'Enter a whole number of kilometres' };
  const km = Number(text);
  if (km < SEARCH_CAP_MIN_KM || km > SEARCH_CAP_MAX_KM) {
    return { error: `Enter a distance from ${SEARCH_CAP_MIN_KM} to ${SEARCH_CAP_MAX_KM} km` };
  }
  return { km };
}

export function clampDistanceKm(km: number, maxKm = MAX_DISTANCE_KM): number {
  const max = Math.max(MIN_DISTANCE_KM, Number.isFinite(maxKm) ? maxKm : MAX_DISTANCE_KM);
  if (!Number.isFinite(km)) return Math.min(DEFAULT_DISTANCE_KM, max);
  return Math.min(max, Math.max(MIN_DISTANCE_KM, km));
}

/** Friendly steps: 0.5 km up to 10 km, then whole km. */
function stepFor(km: number): number {
  return km < 10 ? 0.5 : 1;
}

/** Round to friendly steps (0.5 km up to 10 km, then whole km), within [min, maxKm]. */
export function roundDistanceKm(km: number, maxKm = MAX_DISTANCE_KM): number {
  const c = clampDistanceKm(km, maxKm);
  const step = stepFor(c);
  return clampDistanceKm(Math.round(c / step) * step, maxKm);
}

/**
 * Slider max for a search: the distance from the search centre to the farthest
 * visible corner, rounded UP to a step so the whole visible map is covered.
 * At least 0.5 km, at most the search cap (50 km unless an admin changed it).
 */
function roundedUpKm(farthestVisibleMeters: number): number {
  const km = Math.max(MIN_DISTANCE_KM, farthestVisibleMeters / 1000);
  const step = stepFor(km);
  const up = Math.ceil(km / step - 1e-9) * step;
  return Math.max(MIN_DISTANCE_KM, up);
}

export function sliderMaxKm(farthestVisibleMeters: number, capKm = MAX_DISTANCE_KM): number {
  return Math.min(searchCapKm(capKm), roundedUpKm(farthestVisibleMeters));
}

/**
 * Toast when the visible area is wider than the cap, so the search used the
 * cap instead. Null when the area already fits.
 */
export function searchLimitMessage(
  farthestVisibleMeters: number,
  capKm = MAX_DISTANCE_KM
): string | null {
  const cap = searchCapKm(capKm);
  if (roundedUpKm(farthestVisibleMeters) <= cap) return null;
  const label = formatDistanceKm(cap);
  return `Search limited to ${label}.`;
}

/** Clamp a distance under a new max (rounded to a slider step). */
export function fitDistanceToMax(preferredKm: number, maxKm: number): number {
  return roundDistanceKm(Math.min(preferredKm, maxKm), maxKm);
}

/**
 * Slider value after a search computes its max. A NEW search (first load,
 * 'Search this area', incl. after picking a place) starts at the max so the
 * whole visible map is covered; re-running the same search because a filter or
 * sort changed keeps the user's value, clamped under the max.
 */
export function distanceAfterSearch(
  isNewSearch: boolean,
  currentKm: number,
  maxKm: number
): number {
  return isNewSearch ? fitDistanceToMax(maxKm, maxKm) : fitDistanceToMax(currentKm, maxKm);
}

function ratio(maxKm: number): number {
  return Math.log(clampDistanceKm(maxKm, maxKm) / MIN_DISTANCE_KM);
}

/** Slider position (0..1, logarithmic so short distances get more room) -> km. */
export function positionToKm(position: number, maxKm = MAX_DISTANCE_KM): number {
  const r = ratio(maxKm);
  const t = Math.min(1, Math.max(0, position));
  if (r <= 0) return MIN_DISTANCE_KM;
  return roundDistanceKm(MIN_DISTANCE_KM * Math.exp(t * r), maxKm);
}

export function kmToPosition(km: number, maxKm = MAX_DISTANCE_KM): number {
  const r = ratio(maxKm);
  if (r <= 0) return 1;
  return Math.log(clampDistanceKm(km, maxKm) / MIN_DISTANCE_KM) / r;
}

/** Next/previous step for accessibility increment/decrement. */
export function stepDistanceKm(km: number, direction: 1 | -1, maxKm = MAX_DISTANCE_KM): number {
  const step = km < 10 || (km === 10 && direction < 0) ? 0.5 : 1;
  return roundDistanceKm(km + direction * step, maxKm);
}

export function formatDistanceKm(km: number): string {
  return km < 10 && km % 1 !== 0 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
