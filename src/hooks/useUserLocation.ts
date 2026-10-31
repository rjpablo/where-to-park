import React from 'react';
import * as Location from 'expo-location';
import type { Coordinate } from '../components/map/types';
import { permissionFrom, type LocationPermission } from '../lib/userLocation';

export type UserLocation = { coordinate: Coordinate; accuracyM?: number };

/**
 * Current location for the map puck. Asks for permission once when the map
 * opens (never again after a denial unless the user taps recenter), then
 * watches position while mounted.
 */
export function useUserLocation() {
  const [permission, setPermission] = React.useState<LocationPermission>('unknown');
  const [location, setLocation] = React.useState<UserLocation | null>(null);
  const watchRef = React.useRef<Location.LocationSubscription | null>(null);
  const mounted = React.useRef(true);

  const startWatching = React.useCallback(async () => {
    if (watchRef.current) return;
    try {
      const apply = (pos: Location.LocationObject) => {
        if (!mounted.current) return;
        setLocation({
          coordinate: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          accuracyM: pos.coords.accuracy ?? undefined,
        });
      };
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) apply(last);
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 },
        apply
      );
      if (!last) {
        const now = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        apply(now);
      }
    } catch {
      if (mounted.current) setPermission('unavailable');
    }
  }, []);

  /** Ask for permission (shows the system dialog when Android still allows it). */
  const request = React.useCallback(async (): Promise<LocationPermission> => {
    try {
      const res = await Location.requestForegroundPermissionsAsync();
      const next = permissionFrom(res);
      if (mounted.current) setPermission(next);
      if (next === 'granted') startWatching();
      return next;
    } catch {
      if (mounted.current) setPermission('unavailable');
      return 'unavailable';
    }
  }, [startWatching]);

  React.useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const current = permissionFrom(await Location.getForegroundPermissionsAsync());
        if (current === 'granted') {
          setPermission('granted');
          startWatching();
        } else if (current === 'unknown') {
          await request(); // first launch: ask once, gracefully handled if denied
        } else {
          setPermission(current);
        }
      } catch {
        setPermission('unavailable');
      }
    })();
    return () => {
      mounted.current = false;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [request, startWatching]);

  return { permission, location, request };
}
