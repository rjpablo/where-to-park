import React from 'react';
import { HeaderBackButton } from '@react-navigation/elements';
import { useRouter } from 'expo-router';

/** Header Back for a screen opened without history (web refresh, deep link): replaces it
 *  with its parent page (see src/lib/backFallback.ts). */
export function FallbackBackButton({ to, tintColor }: { to: string; tintColor?: string }) {
  const router = useRouter();
  return (
    <HeaderBackButton
      tintColor={tintColor}
      displayMode="minimal"
      accessibilityLabel="Go back"
      testID="header-back-fallback"
      onPress={() => router.replace(to as never)}
    />
  );
}
