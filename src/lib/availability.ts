/** Minimal listing fields needed to count free slots (matches search_nearby rows). */
export type SlotCountable = {
  tracking_mode: 'count' | 'open_full' | 'slots';
  available_count: number | null;
};

/**
 * Free slots a listing contributes to cluster pins and the results summary.
 * Open/Full listings have no slot count, so they contribute 0.
 */
export function availableSlots(listing: SlotCountable): number {
  if (listing.tracking_mode === 'open_full') return 0;
  return Math.max(0, Math.floor(Number(listing.available_count) || 0));
}

/** A listing's free spaces from the one server source (0064: the free_spaces computed field /
 *  location_free_spaces); falls back to the cached available_count when not selected. */
export function freeSpaces(loc: {
  free_spaces?: number | null;
  available_count?: number | null;
}): number {
  const n = loc.free_spaces ?? loc.available_count;
  return Math.max(0, Math.floor(Number(n) || 0));
}

export function totalAvailableSlots(listings: SlotCountable[]): number {
  return listings.reduce((sum, l) => sum + availableSlots(l), 0);
}

/** Results sheet summary, e.g. "12 listings · 48 spots available". */
export function searchSummary(listings: SlotCountable[]): string {
  const n = listings.length;
  if (n === 0) return 'No listings found';
  const slots = totalAvailableSlots(listings);
  return `${n} ${n === 1 ? 'listing' : 'listings'} · ${slots} ${
    slots === 1 ? 'spot' : 'spots'
  } available`;
}

/**
 * Availability badge text for count / slot listings (results sheet and listing page, rj
 * t126u): the free count only, '1 spot', '0 spots', '12 spots' (no '/capacity'). A missing
 * or invalid count shows 'Unknown' (the badge's existing fallback) rather than a number.
 */
export function spotsLabel(available: number | string | null | undefined): string {
  if (available == null || available === '') return 'Unknown';
  const n = Number(available);
  if (!Number.isFinite(n) || n < 0) return 'Unknown';
  const whole = Math.floor(n);
  return `${whole} ${whole === 1 ? 'spot' : 'spots'}`;
}

/** Available slots editor: free spaces after changing held (Reserved + Unavailable) spaces. */
export function heldPreview(free: number, oldHeld: number, newHeld: number): number {
  return Math.max(0, Math.floor(free + oldHeld - newHeld));
}

/** Plain message for set_manual_counts errors. */
export function manualCountsError(code: unknown): string {
  const c = String(code ?? '');
  if (c === 'no_longer_available') return "That's more spaces than are free right now.";
  if (c === 'Permission denied') return "You don't have access to this listing.";
  return c || 'Something went wrong';
}
