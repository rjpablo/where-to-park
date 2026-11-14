/** Pure rules for the current-location puck and the recenter button. */

export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'blocked' | 'unavailable';

export type RecenterAction = 'center' | 'request' | 'wait' | 'message';

export const RECENTER_ZOOM = 15;

/**
 * What tapping the recenter button does:
 * - granted with a fix → fly to it; granted without a fix yet → wait for one
 * - unknown, or denied but Android may still ask → (re)request permission
 * - blocked ("don't ask again") or no location services → short message
 */
export function recenterAction(permission: LocationPermission, hasFix: boolean): RecenterAction {
  switch (permission) {
    case 'granted':
      return hasFix ? 'center' : 'wait';
    case 'unknown':
    case 'denied':
      return 'request';
    default:
      return 'message';
  }
}

/** Where Find Parking searches on open. A shared link wins. Otherwise the device
 *  fix. Nothing else is substituted. */
export function openingSearchCenter<T>(link: T | null, device: T | null): T | null {
  return link ?? device ?? null;
}

/** True while a device fix can still arrive. Denied, blocked, or unavailable is not a wait. */
export function deviceLocationPending(permission: LocationPermission, hasFix: boolean): boolean {
  if (hasFix) return false;
  return permission === 'unknown' || permission === 'granted';
}

export function locationMessage(permission: LocationPermission): string | null {
  switch (permission) {
    case 'denied':
      return 'Location permission denied. Tap ◎ to allow it and see where you are.';
    case 'blocked':
      return 'Location is blocked for this app. Turn it on in Settings to see where you are.';
    case 'unavailable':
      return "Can't get your location right now. Check that location is on.";
    default:
      return null;
  }
}

/** Map expo-location's permission response to our states. */
export function permissionFrom(res: {
  status: string;
  granted?: boolean;
  canAskAgain?: boolean;
}): LocationPermission {
  if (res.granted || res.status === 'granted') return 'granted';
  if (res.status === 'undetermined') return 'unknown';
  return res.canAskAgain === false ? 'blocked' : 'denied';
}
