import React from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  AVAILABILITY_EVENT,
  AVAILABILITY_TOPIC,
  parseAvailabilityChange,
  type AvailabilityChange,
} from '../lib/liveAvailability';

// One shared subscription for the whole app: supabase.channel(topic) returns the existing
// channel for a topic, so Search and Location details (both mounted on the web stack)
// share it through a listener set, and it is removed when the last one unmounts.
type Listener = (change: AvailabilityChange) => void;
const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel(AVAILABILITY_TOPIC, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: AVAILABILITY_EVENT }, (msg) => {
      const change = parseAvailabilityChange(msg?.payload);
      if (change) listeners.forEach((l) => l(change));
    });
  channel.subscribe();
}

function release() {
  if (listeners.size === 0 && channel) {
    const leaving = channel;
    channel = null;
    supabase.removeChannel(leaving).catch(() => undefined);
  }
}

/**
 * Calls `onBatch` (debounced by `delayMs`) with the changes received since the last
 * call, for those `accept` keeps. Subscribes on mount, unsubscribes on unmount.
 */
export function useAvailabilityChanges(
  accept: (change: AvailabilityChange) => boolean,
  onBatch: (changes: AvailabilityChange[]) => void,
  delayMs: number,
  enabled = true
) {
  const acceptRef = React.useRef(accept);
  const batchRef = React.useRef(onBatch);
  acceptRef.current = accept;
  batchRef.current = onBatch;

  React.useEffect(() => {
    if (!enabled) return undefined;
    let pending: AvailabilityChange[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const listener: Listener = (change) => {
      if (!acceptRef.current(change)) return;
      pending.push(change);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const batch = pending;
        pending = [];
        batchRef.current(batch);
      }, delayMs);
    };
    listeners.add(listener);
    ensureChannel();
    return () => {
      if (timer) clearTimeout(timer);
      listeners.delete(listener);
      release();
    };
  }, [delayMs, enabled]);
}
