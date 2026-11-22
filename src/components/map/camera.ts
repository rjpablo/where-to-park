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

/**
 * The coordinate `dxPx` pixels right and `dyPx` pixels down from `center`
 * at `zoom` (Web Mercator, 512px tiles). A negative `dyPx` is up the screen,
 * which is north.
 */
export function coordinateOffset(
  center: { latitude: number; longitude: number },
  zoom: number,
  dxPx: number,
  dyPx: number
): { latitude: number; longitude: number } {
  const world = TILE * 2 ** zoom;
  return {
    longitude: lngFromX(mercX(center.longitude) + dxPx / world),
    latitude: latFromY(mercY(center.latitude) + dyPx / world),
  };
}

/**
 * How far, in pixels, a point may sit from the screen centre and still be seen.
 * Overlays shrink that, but only while the centre itself stays visible. A sheet
 * that covers the centre is ignored: zooming out cannot uncover the centre, and
 * pins on the map under the sheet are still on screen.
 */
function visibleHalf(size: number, insetStart: number, insetEnd: number, margin: number): number {
  const mid = size / 2;
  const start = insetStart + margin;
  const end = size - insetEnd - margin;
  if (start >= mid || end <= mid) return Math.max(1, mid - margin);
  return Math.min(mid - start, end - mid);
}

/**
 * Zoom that keeps `center` and brings every point onto the map. Null when
 * `currentZoom` already shows them: this never zooms in and never recentres.
 */
export function zoomOutToFit(
  points: LngLat[],
  center: LngLat,
  currentZoom: number,
  size: Size,
  insets: Insets = NO_INSETS,
  margin = 24
): number | null {
  if (!points.length || size.width <= 0 || size.height <= 0 || !Number.isFinite(currentZoom)) {
    return null;
  }
  const maxDx = visibleHalf(size.width, insets.left, insets.right, margin);
  const maxDy = visibleHalf(size.height, insets.top, insets.bottom, margin);
  if (maxDx <= 1 || maxDy <= 1) return null;

  let zoom = Infinity;
  const cx = mercX(center[0]);
  const cy = mercY(center[1]);
  for (const [lng, lat] of points) {
    const dx = Math.abs(mercX(lng) - cx) * TILE;
    const dy = Math.abs(mercY(lat) - cy) * TILE;
    if (dx > 0) zoom = Math.min(zoom, Math.log2(maxDx / dx));
    if (dy > 0) zoom = Math.min(zoom, Math.log2(maxDy / dy));
  }
  if (!Number.isFinite(zoom) || zoom >= currentZoom - 0.01) return null;
  return Math.max(0, zoom);
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

/**
 * Camera that puts `coordinate` on the map centre (the centre cursor).
 * Bounds, when present, only choose the zoom; they do not slide the point
 * toward the uncovered part of the map.
 */
export function cameraOnCenter(
  target: {
    coordinate: { latitude: number; longitude: number };
    bounds?: {
      ne: { latitude: number; longitude: number };
      sw: { latitude: number; longitude: number };
    };
    zoom?: number;
  },
  size: Size
): { center: LngLat; zoom: number } {
  const zoom = target.zoom ?? 16;
  const center: LngLat = [target.coordinate.longitude, target.coordinate.latitude];
  if (!target.bounds || size.width <= 0 || size.height <= 0) return { center, zoom };
  const { ne, sw } = target.bounds;
  const framed = cameraForPoints(
    [
      [ne.longitude, ne.latitude],
      [sw.longitude, sw.latitude],
    ],
    size,
    { margin: 24, maxZoom: 17, fallbackZoom: zoom }
  );
  return { center, zoom: framed?.zoom ?? zoom };
}

/** Camera for a picked place: frame its bounds, else centre it at `zoom`. */
export function cameraForPlace(
  target: {
    coordinate: { latitude: number; longitude: number };
    bounds?: {
      ne: { latitude: number; longitude: number };
      sw: { latitude: number; longitude: number };
    };
    zoom?: number;
  },
  size: Size,
  insets: Insets = NO_INSETS
): { center: LngLat; zoom: number } | null {
  const zoom = target.zoom ?? 16;
  if (target.bounds) {
    const { ne, sw } = target.bounds;
    const framed = cameraForPoints(
      [
        [ne.longitude, ne.latitude],
        [sw.longitude, sw.latitude],
      ],
      size,
      { insets, margin: 24, maxZoom: 17, fallbackZoom: zoom }
    );
    if (framed) return framed;
  }
  return cameraForPoints([[target.coordinate.longitude, target.coordinate.latitude]], size, {
    insets,
    fallbackZoom: zoom,
    maxZoom: 18,
  });
}
