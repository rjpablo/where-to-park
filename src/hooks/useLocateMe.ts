import React from 'react';
import type { Coordinate } from '../components/map/types';
import { locationMessage, recenterAction } from '../lib/userLocation';
import { useUserLocation } from './useUserLocation';

const NOTICE_MS = 4000;

/**
 * The ◎ 'my location' behaviour shared by Parking Search and the map pin picker: asks for
 * permission once when the map opens, and on tap calls `onLocate` with the device location
 * (waiting for the first fix, or asking again when Android still allows it). `notice` is a
 * short message (finding your location, denied, unavailable) that fades after a few seconds.
 */
export function useLocateMe(onLocate: (coordinate: Coordinate) => void) {
  const { permission, location, request } = useUserLocation();
  const [notice, setNotice] = React.useState<string | null>(null);
  const pending = React.useRef(false);
  const onLocateRef = React.useRef(onLocate);
  onLocateRef.current = onLocate;

  const locate = React.useCallback(async () => {
    const action = recenterAction(permission, !!location);
    if (action === 'center' && location) {
      onLocateRef.current(location.coordinate);
      return;
    }
    if (action === 'wait') {
      pending.current = true;
      setNotice('Finding your location…');
      return;
    }
    if (action === 'request') {
      const next = await request();
      if (next === 'granted') {
        pending.current = true;
        return;
      }
      setNotice(locationMessage(next));
      return;
    }
    setNotice(locationMessage(permission));
  }, [permission, location, request]);

  // Act as soon as the first fix arrives after a tap.
  React.useEffect(() => {
    if (pending.current && location) {
      pending.current = false;
      setNotice(null);
      onLocateRef.current(location.coordinate);
    }
  }, [location]);
  // A denial at launch gets one short message.
  React.useEffect(() => {
    const msg = locationMessage(permission);
    if (msg) setNotice(msg);
  }, [permission]);
  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return { permission, location, notice, locate };
}
