import { Platform } from 'react-native';
import { parsePhoton } from './photonParse';
import type { GeocodingProvider, PlaceSuggestion, SuggestOptions } from './types';

/**
 * Photon (https://photon.komoot.io), a free, keyless OpenStreetMap geocoder.
 * Usage policy: fair, moderate use with attribution; no bulk geocoding. We send
 * at most one request per debounced keystroke, cancel stale requests, cache
 * repeats and identify the app with a User-Agent where the platform allows it.
 */
const PHOTON_URL = 'https://photon.komoot.io/api/';
/** Philippines bounding box (minLon, minLat, maxLon, maxLat). */
const PH_BBOX = '116.9,4.5,126.7,21.2';
const USER_AGENT = 'WhereToPark/1.0 (Android; parking finder, Philippines)';
const CACHE_LIMIT = 50;

export function createPhotonProvider(fetchImpl: typeof fetch = fetch): GeocodingProvider {
  const cache = new Map<string, PlaceSuggestion[]>();
  return {
    id: 'photon',
    attribution: 'Search by Photon · © OpenStreetMap contributors',
    minQueryLength: 3,
    debounceMs: 350,
    async suggest(query: string, options: SuggestOptions = {}) {
      const q = query.trim();
      if (q.length < 3) return [];
      const limit = options.limit ?? 6;
      const params = [`q=${encodeURIComponent(q)}`, `limit=${limit}`, 'lang=en', `bbox=${PH_BBOX}`];
      if (options.near) {
        params.push(`lat=${options.near.latitude.toFixed(4)}`);
        params.push(`lon=${options.near.longitude.toFixed(4)}`);
      }
      const url = `${PHOTON_URL}?${params.join('&')}`;
      const cached = cache.get(url);
      if (cached) return cached;

      // Browsers forbid setting User-Agent; native platforms send ours.
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (Platform.OS !== 'web') headers['User-Agent'] = USER_AGENT;
      const res = await fetchImpl(url, { headers, signal: options.signal });
      if (!res.ok) throw new Error(`Place search failed (${res.status})`);
      const results = parsePhoton(await res.json());
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(url, results);
      return results;
    },
  };
}
