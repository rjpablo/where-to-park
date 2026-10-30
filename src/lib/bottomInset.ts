// Bottom spacing for edge-to-edge screens. Import-free (unit tested).

/**
 * Bottom padding for a screen's scroll content (or bottom-pinned row): its own spacing
 * plus the system navigation bar inset. While the keyboard is up the nav bar is covered
 * and the root KeyboardAvoidingView already lifts the content, so the inset is dropped
 * (otherwise it would leave a gap above the keyboard).
 */
export function bottomPadding(base: number, navBarInset: number, keyboardVisible: boolean): number {
  return Math.max(0, base) + (keyboardVisible ? 0 : Math.max(0, navBarInset));
}
