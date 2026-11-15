// AdMob settings and rules. Import-free (unit tested); the native SDK lives in
// src/components/AdBanner.tsx and src/lib/adsInit.ts.

/** Google's official test banner unit (adaptive banner). Always used in development. */
export const TEST_BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/9214589741';

/** Where To Park's real Android banner unit (AdMob → Where To Park → Ad units). */
export const PROD_BANNER_UNIT_ID = 'ca-app-pub-3932328959688671/2188649130';

/**
 * The banner unit to request. Development builds (__DEV__) always get Google's test unit,
 * so taps there never count as invalid traffic. Release builds use
 * EXPO_PUBLIC_ADMOB_BANNER_ID when set (e.g. per EAS profile), else PROD_BANNER_UNIT_ID.
 */
export function bannerUnitId(isDev: boolean, envUnitId?: string | null): string {
  if (isDev) return TEST_BANNER_UNIT_ID;
  const fromEnv = envUnitId?.trim();
  return fromEnv ? fromEnv : PROD_BANNER_UNIT_ID;
}

/** Admins never see ads. Guests, drivers, operators and staff do. */
export function shouldShowAds(user: { is_admin?: boolean | null } | null | undefined): boolean {
  return !user?.is_admin;
}
