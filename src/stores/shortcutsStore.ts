import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import {
  GUEST_SHORTCUTS_KEY,
  appendShortcut,
  parseGuestShortcuts,
  removeShortcut,
  type Shortcut,
} from '../lib/shortcuts';

// Signed in: the location_shortcuts table (0053). Guests: this device only.
interface ShortcutsState {
  items: Shortcut[];
  loaded: boolean;
  userId: string | null;
  load: (userId: string | null) => Promise<void>;
  add: (location: { id: string; name: string }) => Promise<string | null>;
  remove: (locationId: string) => Promise<string | null>;
  reorder: (items: Shortcut[]) => Promise<string | null>;
}

async function saveGuest(items: Shortcut[]) {
  await AsyncStorage.setItem(
    GUEST_SHORTCUTS_KEY,
    JSON.stringify(items.map((s) => ({ locationId: s.locationId, name: s.name })))
  );
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  items: [],
  loaded: false,
  userId: null,
  load: async (userId) => {
    try {
      if (userId) {
        const { data, error } = await supabase
          .from('location_shortcuts')
          .select('location_id, position, locations(id, name, deleted_at)')
          .order('position');
        if (error) throw error;
        const items = (data || []).map((r: any) => {
          const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
          return {
            locationId: r.location_id,
            name: loc?.name ?? null,
            available: !!loc && !loc.deleted_at,
          };
        });
        set({ items, loaded: true, userId });
        return;
      }
      const stored = parseGuestShortcuts(await AsyncStorage.getItem(GUEST_SHORTCUTS_KEY));
      let visible = new Map<string, string>();
      if (stored.length) {
        const { data } = await supabase
          .from('locations')
          .select('id, name')
          .in(
            'id',
            stored.map((s) => s.locationId)
          )
          .is('deleted_at', null);
        visible = new Map((data || []).map((l: any) => [l.id, l.name]));
      }
      set({
        items: stored.map((s) => ({
          locationId: s.locationId,
          name: visible.get(s.locationId) ?? s.name,
          available: visible.has(s.locationId),
        })),
        loaded: true,
        userId: null,
      });
    } catch {
      set({ loaded: true });
    }
  },
  add: async (location) => {
    const { userId, items } = get();
    const next = appendShortcut(items, {
      locationId: location.id,
      name: location.name,
      available: true,
    });
    if (userId) {
      const { data, error } = await supabase.rpc('add_location_shortcut', {
        p_location_id: location.id,
      });
      if (error || data?.error) return error?.message || String(data.error);
      set({ items: next });
      return null;
    }
    set({ items: next });
    await saveGuest(next);
    return null;
  },
  remove: async (locationId) => {
    const { userId, items } = get();
    const next = removeShortcut(items, locationId);
    if (userId) {
      const { error } = await supabase
        .from('location_shortcuts')
        .delete()
        .eq('user_id', userId)
        .eq('location_id', locationId);
      if (error) return error.message;
    }
    set({ items: next });
    if (!userId) await saveGuest(next);
    return null;
  },
  reorder: async (next) => {
    const { userId, items } = get();
    set({ items: next });
    if (userId) {
      const { data, error } = await supabase.rpc('reorder_location_shortcuts', {
        p_location_ids: next.map((s) => s.locationId),
      });
      if (error || data?.error) {
        set({ items });
        return error?.message || String(data.error);
      }
      return null;
    }
    await saveGuest(next);
    return null;
  },
}));

/** Load (or reload) for the current user; call when a screen showing shortcuts opens. */
export function loadShortcuts(userId: string | null) {
  return useShortcutsStore.getState().load(userId);
}
