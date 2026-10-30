import { createPhotonProvider } from './photon';
import type { GeocodingProvider } from './types';

export * from './types';

let provider: GeocodingProvider | null = null;

/**
 * The app's geocoder. Swap providers here (e.g. a Nominatim or paid adapter)
 * without touching the search UI.
 */
export function getGeocoder(): GeocodingProvider {
  if (!provider) provider = createPhotonProvider();
  return provider;
}

/** Test/override hook. */
export function setGeocoder(next: GeocodingProvider | null) {
  provider = next;
}
