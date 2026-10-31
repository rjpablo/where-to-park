// Where the header Back goes when there is no history to go back to (web refresh, a
// deep link, a notification opening a screen directly). Keyed by expo-router route
// name; returns null for screens that have no Back (the search screen, the entry).

export type RouteParams = Record<string, string | string[] | undefined> | undefined;

const SEARCH = '/search';
const LISTINGS = '/operator/listings';

function one(params: RouteParams, key: string): string | undefined {
  const v = params?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? String(s) : undefined;
}

const hub = (id: string) => `/operator/hub/${encodeURIComponent(id)}`;

/** Listing subpage: back to that listing's page, or My listings without a listing. */
function listingParent(params: RouteParams, key = 'locationId'): string {
  const id = one(params, key);
  return id ? hub(id) : LISTINGS;
}

const PARENTS: Record<string, (p: RouteParams) => string> = {
  // Driver screens
  auth: () => SEARCH,
  profile: () => SEARCH,
  notifications: () => SEARCH,
  vehicles: () => SEARCH,
  'location/[id]': () => SEARCH,
  // A driver's chat goes back to the listing; an operator's (driverId set) to Messages.
  'chat/[locationId]': (p) => {
    if (one(p, 'driverId')) return '/operator/inbox';
    const id = one(p, 'locationId');
    return id ? `/location/${encodeURIComponent(id)}` : SEARCH;
  },
  // Operator workspace
  'operator/listings': () => SEARCH,
  'operator/onboarding': () => LISTINGS,
  'operator/hub/[id]': () => LISTINGS,
  'operator/edit/[id]': (p) => listingParent(p, 'id'),
  'operator/areas': (p) => listingParent(p),
  'operator/rates': (p) => listingParent(p),
  // New / Edit rate: back to that listing's Rates list.
  'operator/rate-edit': (p) => {
    const id = one(p, 'locationId');
    return id ? `/operator/rates?locationId=${encodeURIComponent(id)}` : LISTINGS;
  },
  'operator/fees': (p) => listingParent(p),
  'operator/staff': (p) => listingParent(p),
  'operator/availability': (p) => listingParent(p),
  'staff/checkin': (p) => listingParent(p),
  'staff/sessions': (p) => listingParent(p),
  // One session: back to that listing's Active Sessions.
  'staff/session': (p) => {
    const id = one(p, 'locationId');
    return id ? `/staff/sessions?locationId=${encodeURIComponent(id)}` : LISTINGS;
  },
  // Messages: from a listing's page back to it; from the sidebar back to search.
  'operator/inbox': (p) => {
    const id = one(p, 'locationId');
    return id ? hub(id) : SEARCH;
  },
  // Admin (opened from the sidebar on the search screen)
  'admin/verify': () => SEARCH,
  'admin/reports': () => SEARCH,
};

export function backFallback(routeName: string, params?: RouteParams): string | null {
  const parent = PARENTS[routeName];
  return parent ? parent(params) : null;
}

export const BACK_FALLBACK_ROUTES = Object.keys(PARENTS);
