import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { countViewers, viewerChannelName, viewerPresenceKey } from '../lib/viewerPresence';

const DEVICE_ID_KEY = 'wtp-viewer-device-id';
let deviceIdPromise: Promise<string> | null = null;

/** A random id kept on this device (all browser tabs share it), for guest presence. */
function getDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      try {
        const saved = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (saved) return saved;
        const id = Crypto.randomUUID();
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
        return id;
      } catch {
        return Crypto.randomUUID();
      }
    })();
  }
  return deviceIdPromise;
}

/**
 * Live number of people on this listing's details page (Realtime Presence on a public
 * channel per listing). Joins on mount, leaves on unmount and while the app is in the
 * background, and rejoins when it comes back. 0 until connected.
 */
export function useListingViewers(locationId: string | null | undefined): number {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [count, setCount] = React.useState(0);
  const [active, setActive] = React.useState(AppState.currentState !== 'background');

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      setActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    if (!locationId || !active) {
      setCount(0);
      return undefined;
    }
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    (async () => {
      const key = viewerPresenceKey(userId, await getDeviceId());
      if (cancelled) return;
      channel = supabase.channel(viewerChannelName(locationId), {
        config: { presence: { key } },
      });
      channel
        .on('presence', { event: 'sync' }, () => {
          if (channel) setCount(countViewers(channel.presenceState()));
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && channel) {
            await channel.track({ at: new Date().toISOString() });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setCount(0);
          }
        });
    })();
    return () => {
      cancelled = true;
      setCount(0);
      if (channel) {
        channel.untrack();
        supabase.removeChannel(channel);
      }
    };
  }, [locationId, userId, active]);

  return count;
}
