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

export function totalAvailableSlots(listings: SlotCountable[]): number {
  return listings.reduce((sum, l) => sum + availableSlots(l), 0);
}
