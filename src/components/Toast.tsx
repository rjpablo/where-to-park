import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '../stores/toastStore';
import { theme } from '../lib/theme';

const DURATION_MS = 3500;

/** Shows the current toast at the bottom of the screen for a few seconds. */
export function Toast() {
  const { message, kind, seq, hide } = useToastStore();
  const opacity = React.useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: false }).start(() =>
        hide()
      );
    }, DURATION_MS);
    return () => clearTimeout(t);
  }, [message, seq, opacity, hide]);

  if (!message) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        kind === 'success' && styles.success,
        kind === 'error' && styles.error,
        { opacity, bottom: insets.bottom + theme.spacing.xl },
      ]}
      accessibilityLiveRegion="polite"
      testID={`toast-${kind}`}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    alignSelf: 'center',
    maxWidth: 480,
    paddingVertical: theme.spacing.sm + 4,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 12,
    backgroundColor: '#1f2937',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  success: { backgroundColor: '#047857' },
  error: { backgroundColor: '#b91c1c' },
  text: { ...theme.typography.body, color: theme.colors.text.inverse, textAlign: 'center' },
});
