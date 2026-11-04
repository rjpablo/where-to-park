/** Pure helpers for the ImageCarousel (paging maths and the '2/5' counter). */

export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(Math.max(0, Math.round(index)), count - 1);
}

/** Page index for a horizontal scroll offset with full-width pages. */
export function indexFromOffset(offsetX: number, pageWidth: number, count: number): number {
  if (!(pageWidth > 0)) return 0;
  return clampIndex(offsetX / pageWidth, count);
}

/** Counter text, 1-based: '2/5'. Empty for no images. */
export function carouselCounter(index: number, count: number): string {
  if (count <= 0) return '';
  return `${clampIndex(index, count) + 1}/${count}`;
}
