// Edit listing map pin: when to offer 'Restore saved pin'.

type LatLng = { latitude: number; longitude: number };

/** Same spot (to ~1 cm), so float noise from the map doesn't count as a move. */
export function samePin(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.latitude - b.latitude) < 1e-7 && Math.abs(a.longitude - b.longitude) < 1e-7;
}

/** Show the restore button only when there is a saved pin and the pin moved away from it. */
export function showRestorePin(current: LatLng, saved: LatLng | null | undefined): boolean {
  return !!saved && !samePin(current, saved);
}
