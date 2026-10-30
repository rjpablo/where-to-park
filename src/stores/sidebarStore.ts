import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { EMPTY_COUNTS, parseSidebarCounts, type SidebarCounts } from '../lib/sidebar';

interface SidebarState {
  counts: SidebarCounts;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Re-read counts (cheap single RPC); screens call this after marking things read. */
  refresh: () => Promise<void>;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;

export const useSidebarStore = create<SidebarState>((set) => ({
  counts: EMPTY_COUNTS,
  open: false,
  setOpen: (open) => set({ open }),
  refresh: () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const { data, error } = await supabase.rpc('get_sidebar_counts');
        if (!error) set({ counts: parseSidebarCounts(data) });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
  reset: () => set({ counts: EMPTY_COUNTS, open: false }),
}));

/** Fire-and-forget refresh for screens that just changed something. */
export function refreshSidebarCounts() {
  useSidebarStore.getState().refresh();
}
