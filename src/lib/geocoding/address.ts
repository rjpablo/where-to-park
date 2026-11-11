import type { Coordinate } from '../../components/map/types';

/** "Name, detail" for a geocoder result, skipping a repeated name. */
export function placeAddress(place: { name?: string | null; detail?: string | null }): string {
  const name = (place.name || '').trim();
  const detail = (place.detail || '').trim();
  if (name && detail && detail !== name) return `${name}, ${detail}`;
  return name || detail;
}

/** Last resort when a pin has no place name: the coordinates themselves. */
export function coordinateAddress(coordinate: Coordinate): string {
  return `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`;
}

/**
 * The address to store. A typed address wins. Otherwise the lookup (the pinned
 * place) is used, and the coordinates if that lookup fails.
 */
export async function resolveListingAddress(
  typed: string | null | undefined,
  coordinate: Coordinate,
  lookup: (coordinate: Coordinate) => Promise<string | null>
): Promise<string> {
  const given = (typed ?? '').trim();
  if (given) return given;
  try {
    const found = (await lookup(coordinate))?.trim();
    if (found) return found;
  } catch {
    // The pin still identifies the place.
  }
  return coordinateAddress(coordinate);
}
