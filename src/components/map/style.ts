import Constants from 'expo-constants';

/**
 * Shared map style + camera for native and web adapters.
 * Swap MAP_STYLE_URL (or EXPO_PUBLIC_MAP_STYLE_URL) to change providers.
 */
export const MAP_STYLE_URL =
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_MAP_STYLE_URL) ||
  Constants.expoConfig?.extra?.mapStyleUrl ||
  'https://tiles.openfreemap.org/styles/liberty';

export const BAGUIO = {
  latitude: 16.412,
  longitude: 120.596,
};

/** Street-level default so Android does not open at world/country view. */
export const DEFAULT_MAP_ZOOM = 14.5;

/** OpenFreeMap liberty glyph stacks: Noto Sans Regular / Medium / Bold / Italic. */
export const MAP_LABEL_FONT = ['Noto Sans Bold'];

export function mapCenter(region?: { latitude: number; longitude: number }): [number, number] {
  return region ? [region.longitude, region.latitude] : [BAGUIO.longitude, BAGUIO.latitude];
}
