import { create } from 'zustand';
import { supabase, type SearchResult } from '../lib/supabase';
import { DEFAULT_DISTANCE_KM } from '../lib/distance';
import { searchFilterParams, type SearchFilters } from '../lib/searchFilters';
import type { SheetMode } from '../lib/sheetLayout';

interface SearchState {
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  filters: SearchFilters;
  sortBy: 'distance' | 'price' | 'availability' | 'rating' | 'eta';
  sheetPosition: SheetMode;
  cameraPosition: { lat: number; lng: number; zoom: number } | null;
  /** Centre of the last search: the origin of the list's distances and ETAs (and the details page's). */
  searchOrigin: { lat: number; lng: number } | null;

  /** The last search, so live updates can re-run it (radius in metres). */
  lastSearch: { lat: number; lng: number; radiusM: number } | null;

  search: (lat: number, lng: number, radius?: number) => Promise<void>;
  /**
   * Re-run the last search quietly (no loading state, results swapped in place) after a
   * live availability change. Skipped while a search is in flight; a failure keeps the
   * current results.
   */
  refresh: () => Promise<void>;
  setFilters: (filters: Partial<SearchState['filters']>) => void;
  setSortBy: (sortBy: SearchState['sortBy']) => void;
  setSheetPosition: (position: SheetMode) => void;
  setCameraPosition: (position: { lat: number; lng: number; zoom: number }) => void;
}

let searchSeq = 0;

async function runSearch(
  lat: number,
  lng: number,
  radius: number,
  state: Pick<SearchState, 'filters' | 'sortBy'>
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('search_nearby', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radius,
    ...(searchFilterParams(state.filters) as any),
    p_sort_by: state.sortBy,
    p_limit: 50,
  });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...row,
    latitude: Number(row.lat ?? row.latitude),
    longitude: Number(row.lng ?? row.longitude),
  }));
}

export const useSearchStore = create<SearchState>((set, get) => ({
  results: [],
  loading: false,
  error: null,
  filters: {
    vehicleType: null,
    rateType: null,
    showFull: false,
    distanceKm: DEFAULT_DISTANCE_KM,
  },
  sortBy: 'distance',
  // Every new search opens the sheet in Normal (SearchScreen snaps it there).
  sheetPosition: 'normal',
  cameraPosition: null,
  searchOrigin: null,
  lastSearch: null,

  search: async (lat: number, lng: number, radius = 2000) => {
    set({
      loading: true,
      error: null,
      searchOrigin: { lat, lng },
      lastSearch: { lat, lng, radiusM: radius },
    });
    searchSeq += 1;
    const seq = searchSeq;

    try {
      const results = await runSearch(lat, lng, radius, get());
      if (seq !== searchSeq) return;
      set({ results, loading: false, error: null });
    } catch (error: any) {
      console.error('Search error:', error);
      set({ loading: false, error: error?.message || 'Search failed' });
    }
  },

  refresh: async () => {
    const { lastSearch, loading } = get();
    if (!lastSearch || loading) return;
    const seq = searchSeq;
    try {
      const results = await runSearch(lastSearch.lat, lastSearch.lng, lastSearch.radiusM, get());
      // A new search started meanwhile: its results win.
      if (seq !== searchSeq || get().loading) return;
      set({ results });
    } catch (error) {
      console.warn('Live refresh failed', error);
    }
  },

  setFilters: (newFilters) => {
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
    }));
  },

  setSortBy: (sortBy) => {
    set({ sortBy });
  },

  setSheetPosition: (position) => {
    set({ sheetPosition: position });
  },

  setCameraPosition: (position) => {
    set({ cameraPosition: position });
  },
}));
