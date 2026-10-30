// Live "N viewing now" on a listing's details page (Supabase Realtime Presence).
// Pure helpers; the hook is in src/hooks/useListingViewers.ts.

/** Realtime channel name for one listing's viewers. */
export function viewerChannelName(locationId: string): string {
  return `listing-viewers:${locationId}`;
}

/**
 * Presence key for this viewer. Signed-in users are keyed by their user id, so one person
 * counts once however many tabs or devices they use; guests by a random id kept on the
 * device (in a browser it's shared by all tabs), so a guest counts once per device/browser.
 */
export function viewerPresenceKey(userId: string | null | undefined, deviceId: string): string {
  return userId ? `u:${userId}` : `g:${deviceId}`;
}

/** Number of unique viewers in a presence state ({ key: metas[] }). */
export function countViewers(
  state: Record<string, unknown[] | undefined> | null | undefined
): number {
  if (!state) return 0;
  return Object.values(state).filter((metas) => Array.isArray(metas) && metas.length > 0).length;
}

/** The label under the listing name. Always shown, 0 while connecting or offline. */
export function viewersLabel(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `👁 ${n} viewing now`;
}
