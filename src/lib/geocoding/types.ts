import type { Coordinate } from '../../components/map/types';

/** A place suggestion from any geocoding provider. */
export interface PlaceSuggestion {
  id: string;
  /** Primary line, e.g. "Burnham Park". */
  name: string;
  /** Secondary line, e.g. "Baguio, Cordillera Administrative Region". */
  detail: string;
  coordinate: Coordinate;
  /** Area to frame when the provider knows the place's extent. */
  bounds?: { ne: Coordinate; sw: Coordinate };
  /** Suggested zoom when there are no bounds (street vs city etc.). */
  zoom: number;
}

export interface SuggestOptions {
  /** Rank places near this point first (usually the map centre). */
  near?: Coordinate;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Swappable geocoding provider, mirroring the swappable map adapter in
 * src/components/map. Implementations must respect their service's usage policy.
 */
export interface GeocodingProvider {
  readonly id: string;
  /** Attribution to show next to results. */
  readonly attribution: string;
  /** Minimum query length worth sending. */
  readonly minQueryLength: number;
  /** Recommended debounce for as-you-type requests (ms). */
  readonly debounceMs: number;
  suggest(query: string, options?: SuggestOptions): Promise<PlaceSuggestion[]>;
}
