/** Window in which a second hardware back press closes the app. */
export const BACK_TO_EXIT_WINDOW_MS = 2000;

export type BackPressResult = 'navigate' | 'up' | 'warn' | 'exit';

/**
 * "Press back again to close the app" state machine.
 * - Screens with history go back normally ('navigate').
 * - A screen opened without history that has a parent page (`fallback`, see
 *   backFallback.ts) goes one level up to it ('up'), level by level to Search.
 * - Only on a root screen without a parent (Search) does the first press warn and a
 *   second press within the window exit.
 */
export function createBackToExit(windowMs = BACK_TO_EXIT_WINDOW_MS) {
  let lastWarnAt = -Infinity;
  return (canGoBack: boolean, now: number, fallback: string | null = null): BackPressResult => {
    if (canGoBack || fallback) {
      lastWarnAt = -Infinity;
      return canGoBack ? 'navigate' : 'up';
    }
    if (now - lastWarnAt <= windowMs) {
      lastWarnAt = -Infinity;
      return 'exit';
    }
    lastWarnAt = now;
    return 'warn';
  };
}
