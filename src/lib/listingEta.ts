/**
 * Distance and drive time to one listing, worked out the same way as the results
 * list: straight-line distance from the origin, plus the `get_etas` drive time
 * (OSM routing via the ETA cache, or the server's straight-line estimate).
 */

export type LatLng = { lat: number; lng: number };
export type Eta = { duration_s: number; source: string };
export type EtaOrigin = LatLng & { kind: 'search' | 'you' };

/**
 * Origin for the details page. The results list measures from the search centre,
 * so details do too (the numbers match the row that was tapped). Only when no
 * search has run (e.g. a link opened straight to details) is the user's current
 * location used; with neither, no origin (nothing is shown).
 */
export function pickEtaOrigin(
  searchOrigin: LatLng | null | undefined,
  userLocation: LatLng | null | undefined
): EtaOrigin | null {
  if (isLatLng(searchOrigin))
    return { lat: searchOrigin.lat, lng: searchOrigin.lng, kind: 'search' };
  if (isLatLng(userLocation)) return { lat: userLocation.lat, lng: userLocation.lng, kind: 'you' };
  return null;
}

function isLatLng(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/** Great-circle distance in metres (same radius as the map's distanceMeters). */
export function straightLineMeters(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The ETA for one listing from a get_etas response (`data.etas`), or null. */
export function etaFor(etas: unknown, locationId: string): Eta | null {
  if (!Array.isArray(etas)) return null;
  const row = etas.find((e: any) => e && e.location_id === locationId);
  if (!row || typeof row.duration_s !== 'number' || !Number.isFinite(row.duration_s)) return null;
  return { duration_s: Number(row.duration_s), source: String(row.source ?? '') };
}

/** Drive-time text as the list shows it: '4min', or '4min est.' for estimates. */
export function etaText(
  eta: Eta | null | undefined,
  formatDuration: (s: number) => string
): string {
  if (!eta) return '';
  return `${formatDuration(eta.duration_s)}${eta.source === 'estimate' ? ' est.' : ''}`;
}

/**
 * Details-page line, e.g. '1.2km · 4min est. from the search area' or '850m from you'
 * (distance only when the drive time can't be fetched). Empty when there's no origin
 * or no listing coordinates.
 */
export function distanceEtaLabel(
  distanceM: number | null | undefined,
  eta: Eta | null | undefined,
  originKind: EtaOrigin['kind'] | null | undefined,
  fmt: { distance: (m: number) => string; duration: (s: number) => string }
): string {
  if (distanceM == null || !Number.isFinite(distanceM) || !originKind) return '';
  const time = etaText(eta, fmt.duration);
  const from = originKind === 'you' ? 'from you' : 'from the search area';
  return `${fmt.distance(distanceM)}${time ? ` · ${time}` : ''} ${from}`;
}
