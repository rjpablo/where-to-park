import { Linking, Platform } from 'react-native';
import { googleMapsUrl, navigationUrl, type NavApp, type NavTarget } from './navigation';

/**
 * Open turn-by-turn directions in the chosen map app (Profile → preferred_nav_app;
 * phone default for guests). Shared by the details page and the results rows.
 */
export async function openNavigation(app: NavApp, target: NavTarget): Promise<void> {
  try {
    await Linking.openURL(navigationUrl(app, target, Platform.OS));
  } catch {
    // No app handles geo: (or the chosen app is missing): use Google Maps on the web.
    Linking.openURL(googleMapsUrl(target)).catch(() => {});
  }
}
