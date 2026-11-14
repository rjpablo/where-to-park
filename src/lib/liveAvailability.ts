/**
 * Live availability (rj t143u). The server broadcasts { id, lat, lng } on the public
 * Realtime topic 'listing-availability' whenever a published listing's availability
 * changes (migration 0068). Clients never trust a number from the wire: they re-read
 * through search_nearby / free_spaces, the one source.
 */
export const AVAILABILITY_TOPIC = 'listing-availability';
export const AVAILABILITY_EVENT = 'changed';
/** Changes inside this window are batched into one refresh. */
export const LIVE_REFRESH_DEBOUNCE_MS = 800;

export interface AvailabilityChange {
  id: string;
  lat?: number | null;
  lng?: number | null;
}

export function parseAvailabilityChange(payload: unknown): AvailabilityChange | null {
  const p = payload as any;
  if (!p || typeof p.id !== 'string') return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  return {
    id: p.id,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Should this change refresh the current search? Yes when the listing is in the
 * results (its number, Full state or visibility may change) or when it sits inside the
 * searched circle (it may now enter them, e.g. it stopped being Full). No search yet: no.
 */
export function changeAffectsSearch(
  change: AvailabilityChange,
  resultIds: ReadonlySet<string> | readonly string[],
  search: { lat: number; lng: number; radiusM: number } | null
): boolean {
  if (!search) return false;
  const ids = resultIds instanceof Set ? resultIds : new Set(resultIds as readonly string[]);
  if (ids.has(change.id)) return true;
  if (change.lat == null || change.lng == null) return true; // unknown position: be safe
  return metersBetween(search, { lat: change.lat, lng: change.lng }) <= search.radiusM;
}
