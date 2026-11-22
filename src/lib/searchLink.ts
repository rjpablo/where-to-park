/** Decimal places stored in the search URL (~1 m). */
const COORD_DECIMALS = 5;

export type SearchCenter = { lat: number; lng: number };

export type SearchLink = SearchCenter & { place: string | null };

type Param = string | string[] | undefined;

type SearchLinkInput = {
  lat?: Param;
  lng?: Param;
  place?: Param;
};

/** Every query param a Find Parking link can carry. */
export type SearchLinkQuery = SearchLinkInput & {
  r?: Param;
  v?: Param;
  rate?: Param;
  free?: Param;
  full?: Param;
  sort?: Param;
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
export function forwardSearchParams(input: SearchLinkQuery): Record<string, string> | null {
  const link = parseSearchLink(input);
  if (!link) return null;
  const params = searchLinkParams(link);
  for (const key of FILTER_PARAM_KEYS) {
    const value = firstParam(input[key]);
    if (value) params[key] = value;
  }
  return params;
}

// Filter values a link may carry. Kept here (not imported) so this file stays
// self-contained for the Node unit tests; searchLink.test.ts checks they match
// searchFilters.ts and rates.ts.
export const LINK_VEHICLE_TYPES = ['car', 'suv', 'van', 'motorcycle', 'truck'] as const;
export const LINK_RATE_TYPES = ['hourly', 'daily', 'flat_then_hourly', 'monthly'] as const;
export const LINK_SORTS = ['distance', 'price', 'rating', 'eta', 'availability'] as const;
export type LinkSort = (typeof LINK_SORTS)[number];

/** Same limits as the distance slider (distance.ts MIN/MAX_DISTANCE_KM). */
const LINK_MIN_KM = 0.5;
const LINK_MAX_KM = 50;

/** Filter params, in the order they are written. `all` means no vehicle or rate filter. */
export const FILTER_PARAM_KEYS = ['r', 'v', 'rate', 'free', 'full', 'sort'] as const;

/** The search a link asks for. A field is missing when the link does not set it (or sets it badly). */
export type SearchLinkFilters = {
  distanceKm?: number;
  vehicleType?: string | null;
  rateType?: string | null;
  freeOnly?: boolean;
  showFull?: boolean;
  sortBy?: LinkSort;
};

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return value != null && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

function flag(value: string | undefined): boolean | undefined {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return undefined;
}

/** Filters from a link. Unknown or invalid values are dropped, so the screen keeps its own. */
export function parseSearchLinkFilters(input: SearchLinkQuery): SearchLinkFilters {
  const out: SearchLinkFilters = {};
  const r = Number(firstParam(input.r));
  if (firstParam(input.r) != null && Number.isFinite(r) && r > 0) {
    out.distanceKm = Math.min(LINK_MAX_KM, Math.max(LINK_MIN_KM, r));
  }
  const v = firstParam(input.v);
  if (v === 'all') out.vehicleType = null;
  else if (oneOf(LINK_VEHICLE_TYPES, v)) out.vehicleType = v;
  const rate = firstParam(input.rate);
  if (rate === 'all') out.rateType = null;
  else if (oneOf(LINK_RATE_TYPES, rate)) out.rateType = rate;
  const free = flag(firstParam(input.free));
  if (free !== undefined) out.freeOnly = free;
  const full = flag(firstParam(input.full));
  if (full !== undefined) out.showFull = full;
  const sort = oneOf(LINK_SORTS, firstParam(input.sort));
  if (sort) out.sortBy = sort;
  return out;
}

/** A stable key for the filters in a link, so the same link is applied once. */
export function searchLinkFiltersKey(filters: SearchLinkFilters): string {
  return JSON.stringify([
    filters.distanceKm ?? '',
    filters.vehicleType === undefined ? '' : (filters.vehicleType ?? 'all'),
    filters.rateType === undefined ? '' : (filters.rateType ?? 'all'),
    filters.freeOnly ?? '',
    filters.showFull ?? '',
    filters.sortBy ?? '',
  ]);
}

export type ShareableSearch = SearchCenter & {
  place?: string | null;
  distanceKm: number;
  vehicleType: string | null;
  rateType: string | null;
  freeOnly: boolean;
  showFull: boolean;
  sortBy: string;
};

/** Every param of a shared search: centre, name, radius, and each filter (defaults included). */
export function shareSearchParams(search: ShareableSearch): Record<string, string> {
  const params = searchLinkParams(search);
  params.r = String(Math.round(search.distanceKm * 100) / 100);
  params.v = oneOf(LINK_VEHICLE_TYPES, search.vehicleType ?? undefined) ?? 'all';
  params.rate = oneOf(LINK_RATE_TYPES, search.rateType ?? undefined) ?? 'all';
  params.free = search.freeOnly ? '1' : '0';
  params.full = search.showFull ? '1' : '0';
  params.sort = oneOf(LINK_SORTS, search.sortBy) ?? 'distance';
  return params;
}

function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** `https://<host>/search?...`, the link that opens the website or the installed app. */
export function buildSearchShareUrl(origin: string, search: ShareableSearch): string {
  return `${origin.replace(/\/+$/, '')}/search?${queryString(shareSearchParams(search))}`;
}

const SITE_NAME = 'Where To Park';

export function searchDocumentTitle(place?: string | null): string {
  const name = place?.trim();
  return name ? `Parking near ${name} | ${SITE_NAME}` : `Find Parking Near You | ${SITE_NAME}`;
}

/** Kept under ~160 characters so search engines show it whole. */
export function searchDocumentDescription(place?: string | null): string {
  const name = place?.trim();
  if (!name) {
    return 'Find parking near you. Compare open spots, hourly and daily rates, free parking, and distance on a live map with Where To Park.';
  }
  const full = `Find parking near ${name}. Compare open spots, hourly and daily rates, free parking, and distance on a live map.`;
  if (full.length <= 160) return full;
  return `Find parking near ${name}. See open spots, rates, and distance.`;
}

/** Canonical address for a search: the place only (filters are views of the same page). */
export function searchCanonicalUrl(
  origin: string,
  link: (SearchCenter & { place?: string | null }) | null
): string {
  const base = `${origin.replace(/\/+$/, '')}/search`;
  return link ? `${base}?${queryString(searchLinkParams(link))}` : base;
}

export type SearchSeo = {
  title: string;
  description: string;
  canonical: string;
  /** public/og-image.png, made by scripts/og/make-og-image.py. */
  image: string;
  imageWidth: number;
  imageHeight: number;
  imageAlt: string;
};

export const OG_IMAGE = { path: '/og-image.png', width: 1200, height: 630 } as const;

/** Title, description, canonical link and share image for the Find Parking page. */
export function searchSeo(
  origin: string,
  link: (SearchCenter & { place?: string | null }) | null
): SearchSeo {
  const place = link?.place ?? null;
  return {
    title: searchDocumentTitle(place),
    description: searchDocumentDescription(place),
    canonical: searchCanonicalUrl(origin, link),
    image: `${origin.replace(/\/+$/, '')}${OG_IMAGE.path}`,
    imageWidth: OG_IMAGE.width,
    imageHeight: OG_IMAGE.height,
    imageAlt: place
      ? `Where To Park: find parking near ${place}`
      : 'Where To Park: find parking near you on a live map',
  };
}
