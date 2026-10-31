/**
 * "Press back again to close the app" is Android-only (see useBackToExit.android.ts);
 * other platforms have no hardware back button, so this is a no-op.
 */
export function useBackToExit() {}
