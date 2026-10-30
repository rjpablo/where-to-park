/**
 * Read a PostGIS geography point as PostgREST returns it: a hex EWKB string
 * (e.g. '0101000020E6100000…'), or GeoJSON `{ coordinates: [lng, lat] }`.
 */
export function parseGeogPoint(geog: unknown): { lat: number; lng: number } | null {
  if (geog && typeof geog === 'object' && Array.isArray((geog as any).coordinates)) {
    const [lng, lat] = (geog as any).coordinates.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (typeof geog !== 'string' || !/^[0-9a-fA-F]+$/.test(geog) || geog.length < 42) return null;
  const bytes = new Uint8Array(geog.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(geog.substr(i * 2, 2), 16);
  const view = new DataView(bytes.buffer);
  const little = bytes[0] === 1;
  const type = view.getUint32(1, little);
  if ((type & 0xff) !== 1) return null; // not a Point
  let offset = 5;
  if (type & 0x20000000) offset += 4; // SRID present
  if (bytes.length < offset + 16) return null;
  const lng = view.getFloat64(offset, little);
  const lat = view.getFloat64(offset + 8, little);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
