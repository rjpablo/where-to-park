/** Capacity typed for a listing. The number is stored whether or not spots are
 * monitored, and it has to be a whole number of at least 1. */
export function parseListingCapacity(raw: string): { capacity: number } | { error: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    return { error: 'Capacity must be at least 1' };
  }
  return { capacity: Number(text) };
}
