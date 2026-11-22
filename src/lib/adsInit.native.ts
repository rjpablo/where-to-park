import mobileAds from 'react-native-google-mobile-ads';

let started = false;

/** Start the Google Mobile Ads SDK once per app launch. Errors are ignored (no ads). */
export function initAds(): void {
  if (started) return;
  started = true;
  mobileAds()
    .initialize()
    .catch(() => {});
}
