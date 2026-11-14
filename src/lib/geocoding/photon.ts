import { Platform } from 'react-native';
import { parsePhoton } from './photonParse';
import type { Coordinate } from '../../components/map/types';
import type { GeocodingProvider, PlaceSuggestion, ReverseOptions, SuggestOptions } from './types';

/**
 * Photon (https://photon.komoot.io), a free, keyless OpenStreetMap geocoder.
 * Usage policy: fair, moderate use with attribution; no bulk geocoding. We send
 * at most one request per debounced keystroke (and one reverse lookup per
 * searched coordinate), cancel stale requests, cache repeats and identify the
 * app with a User-Agent where the platform allows it.
 */
const PHOTON_URL = 'https://photon.komoot.io/api/';
const REVERSE_URL = 'https://photon.komoot.io/reverse';
/** Philippines bounding box (minLon, minLat, maxLon, maxLat). */
const PH_BBOX = '116.9,4.5,126.7,21.2';
const USER_AGENT = 'WhereToPark/1.0 (Android; parking finder, Philippines)';
const CACHE_LIMIT = 50;

function photonHeaders(): Record<string, string> {
  // Browsers forbid setting User-Agent; native platforms send ours.
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (Platform.OS !== 'web') headers['User-Agent'] = USER_AGENT;
  return headers;
}

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
  return value;
}

export function createPhotonProvider(fetchImpl: typeof fetch = fetch): GeocodingProvider {
  const cache = new Map<string, PlaceSuggestion[]>();
  const reverseCache = new Map<string, string | null>();
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

      const res = await fetchImpl(url, { headers: photonHeaders(), signal: options.signal });
      if (!res.ok) throw new Error(`Place search failed (${res.status})`);
      return remember(cache, url, parsePhoton(await res.json()));
    },
    async reverse(coordinate: Coordinate, options: ReverseOptions = {}) {
      const url =
        `${REVERSE_URL}?lat=${coordinate.latitude.toFixed(5)}` +
        `&lon=${coordinate.longitude.toFixed(5)}&lang=en`;
      if (reverseCache.has(url)) return reverseCache.get(url) ?? null;

      const res = await fetchImpl(url, { headers: photonHeaders(), signal: options.signal });
      if (!res.ok) throw new Error(`Place lookup failed (${res.status})`);
      const name = parsePhoton(await res.json())[0]?.name ?? null;
      return remember(reverseCache, url, name);
    },
  };
}
