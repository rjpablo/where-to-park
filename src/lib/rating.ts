/** Rating text for a listing card: '★ 4.5 (12)', or 'Not rated' without reviews. */
export function formatListingRating(
  avgRating: number | string | null | undefined,
  reviewCount: number | string | null | undefined
): string {
  const count = Number(reviewCount ?? 0);
  const avg = Number(avgRating);
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(avg) || avg <= 0) {
    return 'Not rated';
  }
  return `★ ${avg.toFixed(1)} (${count})`;
}
