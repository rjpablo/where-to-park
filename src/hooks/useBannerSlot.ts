import { useCallback, useMemo, useState } from 'react';
import { useBottomInset } from './useBottomInset';

/**
 * For a screen with an AdBanner pinned at its bottom. While the banner shows, it sits over
 * the navigation bar and pads itself, so the content above only needs `base`; otherwise
 * the content keeps the usual navigation-bar inset. Pass `onBannerShownChange` to
 * AdBanner's onShownChange. `bannerGap` (default `base`) is the content's bottom spacing
 * while the banner shows, e.g. to keep the last button well clear of the ad.
 */
export function useBannerSlot(base = 0, bannerGap = base) {
  const [bannerShown, setBannerShown] = useState(false);
  const inset = useBottomInset(base);
  const contentInset = useMemo(
    () => (bannerShown ? { paddingBottom: Math.max(0, bannerGap) } : inset),
    [bannerShown, bannerGap, inset]
  );
  const onBannerShownChange = useCallback((shown: boolean) => setBannerShown(shown), []);
  return { contentInset, bannerShown, onBannerShownChange };
}
