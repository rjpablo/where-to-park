/** Listing details tabs: existing content first, then Reviews and Photos. */

export type DetailTab = 'overview' | 'reviews' | 'photos';

export const DETAIL_TABS: { key: DetailTab }[] = [
  { key: 'overview' },
  { key: 'reviews' },
  { key: 'photos' },
];

/** 'Overview', 'Reviews (3)', 'Photos (4)'; counts left off at 0. */
export function tabLabel(tab: DetailTab, reviewCount: number, photoCount: number): string {
  if (tab === 'reviews') return reviewCount > 0 ? `Reviews (${reviewCount})` : 'Reviews';
  if (tab === 'photos') return photoCount > 0 ? `Photos (${photoCount})` : 'Photos';
  return 'Overview';
}

/** Square grid cell size for `columns` across `width`, with `gap` between cells. */
export function gridCellSize(width: number, columns = 3, gap = 4): number {
  if (!(width > 0) || columns < 1) return 0;
  return Math.floor((width - gap * (columns - 1)) / columns);
}
