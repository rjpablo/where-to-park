import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { avatarPublicUrl } from '../lib/avatar';
import { getSupabaseUrl } from '../lib/env';

/**
 * A user's profile photo (rj t179u), round. `url` is profiles.avatar_url as stored
 * (Storage path or Google https URL). No photo, or it fails to load -> generic person icon.
 */
export function Avatar({
  url,
  size = 32,
  name,
  testID,
}: {
  url?: string | null;
  size?: number;
  /** For screen readers: "<name>'s photo". */
  name?: string | null;
  testID?: string;
}) {
  const uri = avatarPublicUrl(url, getSupabaseUrl());
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [uri]);
  const box = { width: size, height: size, borderRadius: size / 2 };
  const label = name ? `${name}'s photo` : 'Profile photo';
  if (!uri || failed) {
    return (
      <View
        style={[styles.fallback, box]}
        accessibilityRole="image"
        accessibilityLabel={label}
        testID={testID ? `${testID}-icon` : undefined}
      >
        <Ionicons name="person" size={Math.round(size * 0.58)} color="#9ca3af" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[styles.image, box]}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={0}
      onError={() => setFailed(true)}
      accessibilityLabel={label}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  image: { backgroundColor: '#e5e7eb' },
});
