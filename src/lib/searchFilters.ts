/** Search filters and how they map onto the search_nearby RPC. */

export type SearchFilters = {
  vehicleType: string | null;
  monthlyOnly: boolean;
  /** Include full listings (off by default: full listings are hidden). */
  showFull: boolean;
  /** Only show results within this distance of the search origin. */
  distanceKm: number;
};

export function searchFilterParams(filters: SearchFilters) {
  return {
    p_vehicle_type: filters.vehicleType,
    p_monthly_only: filters.monthlyOnly,
    p_hide_full: !filters.showFull,
  };
}
