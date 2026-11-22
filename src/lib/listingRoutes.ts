/**
 * Where an owner lands for one listing: the listing menu (`/operator/hub/<id>`),
 * the page with Edit, Areas, Rates, Staff, Availability and the rest.
 * List Your Space opens it after a submit (rj PAD-5), not Location details.
 */
export function listingMenuRoute(locationId: string) {
  return { pathname: '/operator/hub/[id]' as const, params: { id: locationId } };
}
