// Results sheet geometry. Worklet-safe (used from Reanimated styles and reactions).

/** Collapsed sheet height: the measured top content (handle, title, summary, slider) plus the
 *  bottom inset, clamped so it never takes most of the screen. */
export function peekHeight(
  contentHeight: number,
  bottomInset: number,
  min: number,
  maxFraction: number,
  windowHeight: number
): number {
  'worklet';
  const h = Math.ceil(Math.max(0, contentHeight) + Math.max(0, bottomInset));
  return Math.min(Math.max(h, min), Math.round(windowHeight * maxFraction));
}

/**
 * The sheet's container height, worked out whenever the sheet rests on a snap point
 * (both snap points are sheet heights in px): container = sheet top + sheet height.
 * Between snap points it keeps the previous value. (On web the container is the whole
 * window, taller than the search screen, so it can't be taken from the screen.)
 */
export function sheetContainerHeight(
  index: number,
  position: number,
  peekPx: number,
  expandedPx: number,
  previous: number
): number {
  'worklet';
  if (Math.abs(index) < 0.001) return position + peekPx;
  if (Math.abs(index - 1) < 0.001) return position + expandedPx;
  return previous;
}

/** Expanded sheet height: a share of the screen, but always leaving the place search box
 *  (and a gap) uncovered, so the sheet's handle stays tappable on short screens. */
export function expandedHeight(
  screenHeight: number,
  fraction: number,
  keepClearTop: number,
  minHeight: number
): number {
  'worklet';
  const h = Math.min(Math.round(screenHeight * fraction), Math.round(screenHeight - keepClearTop));
  return Math.max(h, minHeight);
}

/** Visible sheet height for a top position inside a container of the given height. */
export function sheetVisibleHeight(containerHeight: number, position: number): number {
  'worklet';
  return Math.max(0, containerHeight - position);
}
