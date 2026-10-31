/** Turn-by-turn hand-off: which URL opens the user's preferred map app. */

export type NavApp = 'google_maps' | 'waze' | 'default';

export type NavTarget = { lat: number; lng: number; name?: string | null };

export function googleMapsUrl({ lat, lng }: NavTarget): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function wazeUrl({ lat, lng }: NavTarget): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}

/** Android geo: URI with a labelled pin; opens the default map app (or the chooser). */
export function geoUri({ lat, lng, name }: NavTarget): string {
  const label = (name || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`;
  return `geo:${lat},${lng}?q=${q}`;
}

/** Normalise profiles.preferred_nav_app (guests / unset → phone default). */
export function preferredNavApp(value: string | null | undefined): NavApp {
  return value === 'google_maps' || value === 'waze' ? value : 'default';
}

/**
 * URL for the Navigate button: Google Maps or Waze when chosen in the profile,
 * otherwise the phone's default map app (geo: on Android, Apple Maps on iOS,
 * Google Maps on the web).
 */
export function navigationUrl(app: NavApp, target: NavTarget, platform: string): string {
  if (app === 'google_maps') return googleMapsUrl(target);
  if (app === 'waze') return wazeUrl(target);
  if (platform === 'android') return geoUri(target);
  if (platform === 'ios') return `maps://?daddr=${target.lat},${target.lng}`;
  return googleMapsUrl(target);
}

export function navigateLabel(app: NavApp): string {
  if (app === 'google_maps') return 'Navigate with Google Maps';
  if (app === 'waze') return 'Navigate with Waze';
  return 'Navigate';
}

/** Profile dropdown for preferred_nav_app. */
export const NAV_APP_OPTIONS: { value: NavApp; label: string }[] = [
  { value: 'default', label: 'Phone default' },
  { value: 'google_maps', label: 'Google Maps' },
  { value: 'waze', label: 'Waze' },
];
