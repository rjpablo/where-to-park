import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { useBottomInset } from '../hooks/useBottomInset';
import { bannerUnitId, shouldShowAds } from '../lib/ads';
import { theme } from '../lib/theme';
import { useAuthStore } from '../stores/authStore';
import type { AdBannerProps } from './AdBanner';

const UNIT_ID = bannerUnitId(__DEV__, process.env.EXPO_PUBLIC_ADMOB_BANNER_ID);

/**
 * Anchored adaptive AdMob banner for the bottom of a screen. It takes no space until an ad
 * has loaded, then pads itself above the navigation bar (so the screen above it should
 * drop its own bottom inset; see useBannerSlot). Admins never get one. A failed load
 * collapses it for the rest of the screen's life.
 */
export function AdBanner({ onShownChange, testID = 'ad-banner' }: AdBannerProps) {
  const isAdmin = useAuthStore((s) => !!s.user?.is_admin);
  const show = shouldShowAds({ is_admin: isAdmin });
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const inset = useBottomInset(0);
  const shown = show && loaded && !failed;

  React.useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);

  if (!show || failed) return null;
  return (
    <View style={[styles.wrap, loaded ? inset : null]} testID={testID}>
      <BannerAd
        unitId={UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: false }}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
});
