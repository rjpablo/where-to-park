/** Distance filter range for search results (km). */
export const MIN_DISTANCE_KM = 0.5;
/**
 * Hard cap on the slider max. The max normally follows the searched area (see
 * sliderMaxKm); this only stops a fully zoomed-out map from asking for a
 * country-wide radius.
 */
export const MAX_DISTANCE_KM = 50;
export const DEFAULT_DISTANCE_KM = 5;

export function clampDistanceKm(km: number, maxKm = MAX_DISTANCE_KM): number {
  const max = Math.max(MIN_DISTANCE_KM, Math.min(MAX_DISTANCE_KM, maxKm));
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
 * At least 0.5 km, at most MAX_DISTANCE_KM.
 */
export function sliderMaxKm(farthestVisibleMeters: number): number {
  const km = Math.max(MIN_DISTANCE_KM, farthestVisibleMeters / 1000);
  const step = stepFor(km);
  const up = Math.ceil(km / step - 1e-9) * step;
  return Math.min(MAX_DISTANCE_KM, Math.max(MIN_DISTANCE_KM, up));
}

/**
 * Value to use after the max changes: the user's preferred distance (5 km by
 * default) if it fits, otherwise the max.
 */
export function fitDistanceToMax(preferredKm: number, maxKm: number): number {
  return roundDistanceKm(Math.min(preferredKm, maxKm), maxKm);
}

function ratio(maxKm: number): number {
  return Math.log(clampDistanceKm(maxKm) / MIN_DISTANCE_KM);
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
