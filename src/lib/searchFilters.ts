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

/** vehicle_type enum, in display order. */
export const VEHICLE_TYPES = ['car', 'suv', 'van', 'motorcycle', 'truck'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  car: 'Car',
  suv: 'SUV',
  van: 'Van',
  motorcycle: 'Motorcycle',
  truck: 'Truck',
};

export type DropdownOption<T extends string> = { value: T | null; label: string };

/** 'All' (no vehicle filter) plus each vehicle type. */
export const VEHICLE_FILTER_OPTIONS: DropdownOption<VehicleType>[] = [
  { value: null, label: 'All' },
  ...VEHICLE_TYPES.map((v) => ({ value: v, label: VEHICLE_TYPE_LABELS[v] })),
];

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === 'string' && (VEHICLE_TYPES as readonly string[]).includes(value);
}

/** Starting vehicle filter: the signed-in user's default vehicle's type, else All (null). */
export function defaultVehicleFilter(
  signedIn: boolean,
  defaultVehicleType: string | null | undefined
): VehicleType | null {
  return signedIn && isVehicleType(defaultVehicleType) ? defaultVehicleType : null;
}

export function optionLabel<T extends string>(options: DropdownOption<T>[], value: T | null) {
  return options.find((o) => o.value === value)?.label ?? 'All';
}

export const SORT_OPTIONS = ['distance', 'price', 'availability', 'rating', 'eta'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

/** Chip labels; 'availability' sorts by most available slots first. */
export const SORT_LABELS: Record<SortOption, string> = {
  distance: 'distance',
  price: 'price',
  availability: 'Most slots',
  rating: 'rating',
  eta: 'eta',
};
