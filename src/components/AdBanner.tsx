// Web (and any non-native) build: AdMob is native-only, so the banner is a no-op here and
// the native SDK is never imported. The Android/iOS banner is AdBanner.native.tsx.

export type AdBannerProps = {
  /** Called with true once an ad is on screen, false when it collapses or goes away. */
  onShownChange?: (shown: boolean) => void;
  testID?: string;
};

export function AdBanner(_props: AdBannerProps): null {
  return null;
}
