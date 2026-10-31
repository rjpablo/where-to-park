/**
 * Teardrop pin geometry shared by the native PNGs (scripts/generate-map-pins.py)
 * and the web canvas renderer. The pin's tip sits exactly on the coordinate
 * (icon anchor "bottom"); cluster pins stay round.
 */
export const PIN_WIDTH = 34;
export const PIN_HEIGHT = 44;
export const PIN_RADIUS = 14;
export const PIN_STROKE = 2.5;
export const PIN_CENTER_Y = 16;

export const PIN_COLORS = {
  'pin-open': '#10b981',
  'pin-full': '#ef4444',
  'pin-stale': '#f59e0b',
  'pin-place': '#2563eb',
} as const;

export type PinImageName = keyof typeof PIN_COLORS;

/** Label size and the offset (in ems) that centres the label inside the bulb. */
export const PIN_LABEL_SIZE = 11;
export const PIN_LABEL_OFFSET: [number, number] = [
  0,
  -(PIN_HEIGHT - PIN_CENTER_Y) / PIN_LABEL_SIZE,
];

/** MapLibre expression choosing the pin image from the feature's status flags. */
export const PIN_IMAGE_EXPRESSION = [
  'case',
  ['==', ['to-boolean', ['get', 'isStale']], true],
  'pin-stale',
  ['==', ['to-boolean', ['get', 'isFull']], true],
  'pin-full',
  'pin-open',
];

/** Points of the teardrop outline (1x px), tip first. */
export function teardropPoints(
  cx: number,
  cy: number,
  r: number,
  tipY: number,
  steps = 48
): [number, number][] {
  const d = tipY - cy;
  const phi = Math.acos(r / d);
  const pts: [number, number][] = [[cx, tipY]];
  for (let i = 0; i <= steps; i++) {
    const a = phi + ((2 * Math.PI - 2 * phi) * i) / steps;
    pts.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]);
  }
  return pts;
}

/**
 * Cluster aggregation: clusters carry the SUM of their listings' free slots
 * (feature property `availableSlots`) and show it instead of the listing count.
 * Works with both MapLibre RN (GeoJSONSource clusterProperties) and maplibre-gl.
 */
export const CLUSTER_PROPERTIES = {
  availableSlots: ['+', ['get', 'availableSlots']],
};

export const CLUSTER_LABEL_EXPRESSION = ['to-string', ['get', 'availableSlots']];

/** Current-location puck colours (shared by native and web maps). */
export const USER_PUCK = { dot: '#2563eb', ring: '#ffffff', halo: '#2563eb' };
