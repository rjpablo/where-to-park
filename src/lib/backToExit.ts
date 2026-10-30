/** Window in which a second hardware back press closes the app. */
export const BACK_TO_EXIT_WINDOW_MS = 2000;

export type BackPressResult = 'navigate' | 'warn' | 'exit';

/**
 * "Press back again to close the app" state machine.
 * - Screens with history go back normally ('navigate').
 * - On a root screen the first press warns; a second press within the window exits.
 */
export function createBackToExit(windowMs = BACK_TO_EXIT_WINDOW_MS) {
  let lastWarnAt = -Infinity;
  return (canGoBack: boolean, now: number): BackPressResult => {
    if (canGoBack) {
      lastWarnAt = -Infinity;
      return 'navigate';
    }
    if (now - lastWarnAt <= windowMs) {
      lastWarnAt = -Infinity;
      return 'exit';
    }
    lastWarnAt = now;
    return 'warn';
  };
}
