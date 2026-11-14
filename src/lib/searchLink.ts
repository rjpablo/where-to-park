/** Decimal places stored in the search URL (~1 m). */
const COORD_DECIMALS = 5;

export type SearchCenter = { lat: number; lng: number };

export type SearchLink = SearchCenter & { place: string | null };

type SearchLinkInput = {
  lat?: string | string[];
  lng?: string | string[];
  place?: string | string[];
};

function firstParam(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

export function formatSearchCoord(value: number): string {
  return value.toFixed(COORD_DECIMALS);
}

export function searchCenterKey(center: SearchCenter): string {
  return `${formatSearchCoord(center.lat)},${formatSearchCoord(center.lng)}`;
}

export function sameSearchCenter(a: SearchCenter, b: SearchCenter): boolean {
  return searchCenterKey(a) === searchCenterKey(b);
}

/** Coordinates from a Find Parking URL, or null when lat/lng are missing or invalid. */
export function parseSearchLink(input: SearchLinkInput): SearchLink | null {
  const lat = Number(firstParam(input.lat));
  const lng = Number(firstParam(input.lng));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const place = firstParam(input.place)?.trim() || null;
  return { lat, lng, place };
}

/** Query params to put on `/search`. `place` is omitted when there is no name. */
export function searchLinkParams(
  link: SearchCenter & { place?: string | null }
): Record<string, string> {
  const params: Record<string, string> = {
    lat: formatSearchCoord(link.lat),
    lng: formatSearchCoord(link.lng),
  };
  const place = link.place?.trim();
  if (place) params.place = place;
  return params;
}

/** Params the home route should copy onto `/search`, or null when there is nothing to copy. */
export function forwardSearchParams(input: SearchLinkInput): Record<string, string> | null {
  const link = parseSearchLink(input);
  return link ? searchLinkParams(link) : null;
}

export function searchDocumentTitle(place?: string | null): string {
  const name = place?.trim();
  return name ? `Where to park in ${name}` : 'Find Parking - Where To Park';
}

export function searchDocumentDescription(place?: string | null): string {
  const name = place?.trim();
  return name
    ? `Find parking near ${name}. See open spots, rates, and distance.`
    : 'Find parking near you. See open spots, rates, and distance.';
}
