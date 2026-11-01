// Edit listing map pin: when to offer 'Restore saved pin'.

type LatLng = { latitude: number; longitude: number };

/** Same spot (to ~1 cm), so float noise from the map doesn't count as a move. */
export function samePin(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.latitude - b.latitude) < 1e-7 && Math.abs(a.longitude - b.longitude) < 1e-7;
}

/** Show the restore button only when there is a saved pin and the pin moved away from it. */
export function showRestorePin(current: LatLng, saved: LatLng | null | undefined): boolean {
  return !!saved && !samePin(current, saved);
}

/** Map pin picker height: ~55% of the window, at least 320 px and at most 640 px. */
export const PICKER_MAP_FRACTION = 0.55;
export const PICKER_MAP_MIN = 320;
export const PICKER_MAP_MAX = 640;
export function pickerMapHeight(windowHeight: number): number {
  const h = Math.round((Number.isFinite(windowHeight) ? windowHeight : 0) * PICKER_MAP_FRACTION);
  return Math.min(PICKER_MAP_MAX, Math.max(PICKER_MAP_MIN, h));
}

type TouchLike = { identifier?: number | string };
type TouchListLike = ArrayLike<TouchLike> | null | undefined;
/** Fingers still on the map after a touch event (map pin picker scroll lock). Platforms
 *  differ on whether `touches` still lists the lifted finger at touch end, so the changed
 *  ones are always left out then. At touch start at least one finger is down. */
export function remainingTouches(
  // Arrays on native; DOM TouchLists on the web.
  ev: { touches?: TouchListLike; changedTouches?: TouchListLike } | null | undefined,
  ending: boolean
): number {
  const all = Array.from(ev?.touches ?? []);
  if (!ending) return Math.max(1, all.length);
  const changed = new Set(Array.from(ev?.changedTouches ?? []).map((t) => t?.identifier));
  return all.filter((t) => !changed.has(t?.identifier)).length;
}
