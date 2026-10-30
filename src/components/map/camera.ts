/**
 * Pure camera math shared by the native and web map adapters (Web Mercator,
 * 512px tiles as used by MapLibre).
 */
export type LngLat = [number, number];
export type Insets = { top: number; right: number; bottom: number; left: number };
export type Size = { width: number; height: number };

const TILE = 512;
const MAX_LAT = 85.0511287798;

function mercX(lng: number): number {
  return (lng + 180) / 360;
}

function mercY(lat: number): number {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
}

function lngFromX(x: number): number {
  return x * 360 - 180;
}

function latFromY(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Camera (centre + zoom) that shows every point inside the part of the map not
 * covered by overlays (`insets`), with `margin` px to spare on each side.
 * Identical points fall back to `fallbackZoom`. Zoom is capped at `maxZoom`.
 */
export function cameraForPoints(
  points: LngLat[],
  size: Size,
  {
    insets = NO_INSETS,
    margin = 48,
    maxZoom = 18,
    fallbackZoom = 16,
  }: { insets?: Insets; margin?: number; maxZoom?: number; fallbackZoom?: number } = {}
): { center: LngLat; zoom: number } | null {
  if (!points.length || size.width <= 0 || size.height <= 0) return null;
  const xs = points.map((p) => mercX(p[0]));
  const ys = points.map((p) => mercY(p[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const availW = Math.max(1, size.width - insets.left - insets.right - 2 * margin);
  const availH = Math.max(1, size.height - insets.top - insets.bottom - 2 * margin);
  const dx = maxX - minX;
  const dy = maxY - minY;
  const zx = dx > 0 ? Math.log2(availW / (dx * TILE)) : Infinity;
  const zy = dy > 0 ? Math.log2(availH / (dy * TILE)) : Infinity;
  let zoom = Math.min(zx, zy);
  if (!Number.isFinite(zoom)) zoom = fallbackZoom;
  zoom = Math.max(0, Math.min(maxZoom, zoom));

  // Put the points' centre in the middle of the uncovered area, not the screen.
  const world = TILE * Math.pow(2, zoom);
  const cx = (minX + maxX) / 2 - (insets.left - insets.right) / 2 / world;
  const cy = (minY + maxY) / 2 - (insets.top - insets.bottom) / 2 / world;
  return { center: [lngFromX(cx), latFromY(cy)], zoom };
}

/** Great-circle distance in metres. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
