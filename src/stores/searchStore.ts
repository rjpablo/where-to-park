import { create } from 'zustand';
import { supabase, type SearchResult } from '../lib/supabase';
import { DEFAULT_DISTANCE_KM } from '../lib/distance';

interface SearchState {
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  filters: {
    vehicleType: string | null;
    monthlyOnly: boolean;
    hideFull: boolean;
    /** Only show results within this distance of the search origin. */
    distanceKm: number;
  };
  sortBy: 'distance' | 'price' | 'availability' | 'rating' | 'eta';
  sheetPosition: 'peek' | 'expanded';
  cameraPosition: { lat: number; lng: number; zoom: number } | null;

  search: (lat: number, lng: number, radius?: number) => Promise<void>;
  setFilters: (filters: Partial<SearchState['filters']>) => void;
  setSortBy: (sortBy: SearchState['sortBy']) => void;
  setSheetPosition: (position: 'peek' | 'expanded') => void;
  setCameraPosition: (position: { lat: number; lng: number; zoom: number }) => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  results: [],
  loading: false,
  error: null,
  filters: {
    vehicleType: null,
    monthlyOnly: false,
    hideFull: false,
    distanceKm: DEFAULT_DISTANCE_KM,
  },
  sortBy: 'distance',
  sheetPosition: 'peek',
  cameraPosition: null,

  search: async (lat: number, lng: number, radius = 2000) => {
    set({ loading: true, error: null });

    try {
      const { filters, sortBy } = get();

      const { data, error } = await supabase.rpc('search_nearby', {
        p_lat: lat,
        p_lng: lng,
        p_radius_m: radius,
        p_vehicle_type: filters.vehicleType as any,
        p_monthly_only: filters.monthlyOnly,
        p_hide_full: filters.hideFull,
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
