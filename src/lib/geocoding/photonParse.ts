import type { PlaceSuggestion } from './types';

/** Pure Photon GeoJSON -> PlaceSuggestion mapping (no React Native imports, unit-tested). */
const ZOOM_BY_TYPE: Record<string, number> = {
  house: 18,
  street: 17,
  locality: 15,
  district: 14,
  city: 13,
  county: 11,
  state: 9,
  country: 6,
  other: 17,
};

function detailLine(p: Record<string, any>): string {
  const parts = [
    p.street && p.housenumber ? `${p.housenumber} ${p.street}` : p.street,
    p.locality || p.district,
    p.city || p.county,
    p.state,
  ].filter((v, i, arr) => v && v !== p.name && arr.indexOf(v) === i);
  return parts.join(', ');
}

export function parsePhoton(json: any): PlaceSuggestion[] {
  const seen = new Set<string>();
  const out: PlaceSuggestion[] = [];
  for (const f of json?.features || []) {
    const p = f?.properties || {};
    const [lng, lat] = f?.geometry?.coordinates || [];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city;
    if (!name) continue;
    const detail = detailLine(p);
    const key = `${name}|${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Photon extent: [minLon, maxLat, maxLon, minLat]
    const e = Array.isArray(p.extent) && p.extent.length === 4 ? p.extent : null;
    out.push({
      id: `${p.osm_type || 'X'}${p.osm_id || out.length}`,
      name,
      detail,
      coordinate: { latitude: lat, longitude: lng },
      bounds: e
        ? {
            ne: { latitude: Math.max(e[1], e[3]), longitude: Math.max(e[0], e[2]) },
            sw: { latitude: Math.min(e[1], e[3]), longitude: Math.min(e[0], e[2]) },
          }
        : undefined,
      zoom: ZOOM_BY_TYPE[p.type] ?? 16,
    });
  }
  return out;
}
