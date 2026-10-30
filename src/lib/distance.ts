/** Distance filter range for search results (km). */
export const MIN_DISTANCE_KM = 0.5;
export const MAX_DISTANCE_KM = 50;
export const DEFAULT_DISTANCE_KM = 5;

const RATIO = Math.log(MAX_DISTANCE_KM / MIN_DISTANCE_KM);

export function clampDistanceKm(km: number): number {
  if (!Number.isFinite(km)) return DEFAULT_DISTANCE_KM;
  return Math.min(MAX_DISTANCE_KM, Math.max(MIN_DISTANCE_KM, km));
}

/** Round to friendly steps: 0.5 km up to 10 km, then whole km. */
export function roundDistanceKm(km: number): number {
  const c = clampDistanceKm(km);
  return c < 10 ? Math.max(MIN_DISTANCE_KM, Math.round(c * 2) / 2) : Math.round(c);
}

/** Slider position (0..1, logarithmic so short distances get more room) -> km. */
export function positionToKm(position: number): number {
  const t = Math.min(1, Math.max(0, position));
  return roundDistanceKm(MIN_DISTANCE_KM * Math.exp(t * RATIO));
}

export function kmToPosition(km: number): number {
  return Math.log(clampDistanceKm(km) / MIN_DISTANCE_KM) / RATIO;
}

/** Next/previous step for accessibility increment/decrement. */
export function stepDistanceKm(km: number, direction: 1 | -1): number {
  const step = km < 10 || (km === 10 && direction < 0) ? 0.5 : 1;
  return roundDistanceKm(km + direction * step);
}

export function formatDistanceKm(km: number): string {
  return km < 10 && km % 1 !== 0 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
