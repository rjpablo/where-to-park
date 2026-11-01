import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { theme } from '../../lib/theme';

export const LOCATE_BUTTON_SIZE = 46;

/** The ◎ 'center on my location' button (Parking Search and the map pin picker). */
export function LocateButton({
  active,
  onPress,
  accessibilityLabel = 'Center the map on my location',
  testID = 'recenter-button',
  style,
}: {
  /** Location permission granted and a fix known: the ring turns the primary colour. */
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: ViewStyle;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <View style={[styles.icon, active ? styles.iconActive : null]}>
        <View style={styles.dot} />
      </View>
    </TouchableOpacity>
  );
}

/** Short dark message shown by the ◎ button (finding / denied / unavailable). */
export function LocationNotice({ text, style }: { text: string | null; style?: ViewStyle }) {
  if (!text) return null;
  return (
    <View style={[styles.notice, style]} testID="location-notice">
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: LOCATE_BUTTON_SIZE,
    height: LOCATE_BUTTON_SIZE,
    borderRadius: LOCATE_BUTTON_SIZE / 2,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.md,
  },
  icon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.text.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActive: { borderColor: theme.colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  notice: {
    marginBottom: theme.spacing.sm,
    maxWidth: 260,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(17,24,39,0.88)',
  },
  noticeText: { ...theme.typography.bodySmall, color: '#fff' },
});
