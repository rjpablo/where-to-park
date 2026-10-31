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
 * (snap points are sheet heights in px, lowest first): container = sheet top + sheet
 * height. Between snap points it keeps the previous value. (On web the container is the
 * whole window, taller than the search screen, so it can't be taken from the screen.)
 */
export function sheetContainerHeight(
  index: number,
  position: number,
  snapHeights: readonly number[],
  previous: number
): number {
  'worklet';
  const i = Math.round(index);
  if (Math.abs(index - i) < 0.001 && i >= 0 && i < snapHeights.length) {
    return position + snapHeights[i];
  }
  return previous;
}

/** Normal sheet height: a share of the search screen (below the header), kept above the
 *  minimized height. */
export function normalHeight(screenHeight: number, fraction: number, minimized: number): number {
  'worklet';
  return Math.max(Math.round(screenHeight * fraction), Math.ceil(minimized) + 1);
}

/** Maximized sheet height: up to `gapBelowHeader` px below the header, i.e. the search
 *  screen's height (it starts right under the header) minus the gap; kept above Normal. */
export function maximizedHeight(
  screenHeight: number,
  gapBelowHeader: number,
  normal: number
): number {
  'worklet';
  return Math.max(Math.round(screenHeight - gapBelowHeader), Math.ceil(normal) + 1);
}

export type SheetMode = 'minimized' | 'normal' | 'maximized';
export const SHEET_MODES: readonly SheetMode[] = ['minimized', 'normal', 'maximized'];

/** Snap index for a mode and back (snap points are [minimized, normal, maximized]). */
export function sheetModeIndex(mode: SheetMode): number {
  return Math.max(0, SHEET_MODES.indexOf(mode));
}
export function sheetModeAt(index: number): SheetMode {
  return SHEET_MODES[Math.min(SHEET_MODES.length - 1, Math.max(0, Math.round(index)))];
}

/** Handle tap: Minimized → Normal → Maximized → Minimized (dragging picks any mode). */
export function nextSheetMode(mode: SheetMode): SheetMode {
  return SHEET_MODES[(sheetModeIndex(mode) + 1) % SHEET_MODES.length];
}

/** Visible sheet height for a top position inside a container of the given height. */
export function sheetVisibleHeight(containerHeight: number, position: number): number {
  'worklet';
  return Math.max(0, containerHeight - position);
}
