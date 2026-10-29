import { create } from 'zustand';
import { supabase, type SearchResult } from '../lib/supabase';

interface SearchState {
  results: SearchResult[];
  loading: boolean;
  filters: {
    vehicleType: string | null;
    monthlyOnly: boolean;
    hideFull: boolean;
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
  filters: {
    vehicleType: null,
    monthlyOnly: false,
    hideFull: false,
  },
  sortBy: 'distance',
  sheetPosition: 'peek',
  cameraPosition: null,

  search: async (lat: number, lng: number, radius = 2000) => {
    set({ loading: true });

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

      set({ results: data || [], loading: false });
    } catch (error) {
      console.error('Search error:', error);
      set({ loading: false });
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
