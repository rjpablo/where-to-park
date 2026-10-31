// Pure helpers for the SlideToConfirm component (kept separate so they can be unit tested).

/** How far along the track (0 to 1) the knob must be dragged before releasing confirms. */
export const SLIDE_CONFIRM_THRESHOLD = 0.9;

/** The distance the knob can travel: the track width minus the knob and its side padding. */
export function slideTravel(trackWidth: number, knobSize: number, padding: number): number {
  return Math.max(0, trackWidth - knobSize - padding * 2);
}

/** Clamp a drag offset to the track. */
export function clampSlide(dx: number, travel: number): number {
  if (!(travel > 0) || !Number.isFinite(dx)) return 0;
  return Math.min(Math.max(dx, 0), travel);
}

/** Progress (0 to 1) for an offset. */
export function slideProgress(offset: number, travel: number): number {
  if (!(travel > 0)) return 0;
  return clampSlide(offset, travel) / travel;
}

/** Whether releasing at this offset confirms (dragged to the end, or close enough). */
export function slideConfirms(
  offset: number,
  travel: number,
  threshold: number = SLIDE_CONFIRM_THRESHOLD
): boolean {
  return travel > 0 && slideProgress(offset, travel) >= threshold;
}
