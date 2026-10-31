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

  search: (lat: number, lng: number, radius?: number) => Promise<void>;
  setFilters: (filters: Partial<SearchState['filters']>) => void;
  setSortBy: (sortBy: SearchState['sortBy']) => void;
  setSheetPosition: (position: SheetMode) => void;
  setCameraPosition: (position: { lat: number; lng: number; zoom: number }) => void;
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

  search: async (lat: number, lng: number, radius = 2000) => {
    set({ loading: true, error: null, searchOrigin: { lat, lng } });

    try {
      const { filters, sortBy } = get();

      const { data, error } = await supabase.rpc('search_nearby', {
        p_lat: lat,
        p_lng: lng,
        p_radius_m: radius,
        ...(searchFilterParams(filters) as any),
        p_sort_by: sortBy,
        p_limit: 50,
      });

      if (error) throw error;

      const results: SearchResult[] = (data || []).map((row: any) => ({
        ...row,
        latitude: Number(row.lat ?? row.latitude),
        longitude: Number(row.lng ?? row.longitude),
      }));

      set({ results, loading: false, error: null });
    } catch (error: any) {
      console.error('Search error:', error);
      set({ loading: false, error: error?.message || 'Search failed' });
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
