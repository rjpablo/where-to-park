import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from '../stores/toastStore';
import { theme } from '../lib/theme';

const DURATION_MS = 3500;
const MAP_DURATION_MS = 1800;
/** Just under the header, in the same band as the place search, so the toast covers that field. */
const MAP_TOAST_BELOW_HEADER = 56 + theme.spacing.md;

/** Shows the current toast. Bottom notices stay at the foot of the screen. A map notice sits on the Find Parking map and can be closed. */
export function Toast() {
  const { message, kind, place, seq, hide } = useToastStore();
  const opacity = React.useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    const t = setTimeout(
      () => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: false }).start(() =>
          hide()
        );
      },
      place === 'map' ? MAP_DURATION_MS : DURATION_MS
    );
    return () => clearTimeout(t);
  }, [message, place, seq, opacity, hide]);

  if (!message) return null;
  const onMap = place === 'map';
  return (
    <Animated.View
      pointerEvents={onMap ? 'auto' : 'box-none'}
      style={[
        styles.toast,
        onMap && styles.map,
        kind === 'success' && styles.success,
        kind === 'error' && styles.error,
        onMap
          ? { opacity, top: insets.top + MAP_TOAST_BELOW_HEADER }
          : { opacity, bottom: insets.bottom + theme.spacing.xl },
      ]}
      accessibilityLiveRegion="polite"
      testID={`toast-${kind}`}
    >
      <Text style={[styles.text, onMap && styles.textBesideClose]}>{message}</Text>
      {onMap ? (
        <Pressable
          onPress={hide}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID="toast-close"
        >
          <View>
            <Ionicons name="close" size={20} color={theme.colors.text.inverse} />
          </View>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 480,
    paddingVertical: theme.spacing.sm + 4,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 12,
    backgroundColor: '#1f2937',
    zIndex: 40,
    elevation: 40,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  map: {
    backgroundColor: 'rgba(31, 41, 55, 0.72)',
    elevation: 0,
  },
  success: { backgroundColor: '#047857' },
  error: { backgroundColor: '#b91c1c' },
  text: {
    ...theme.typography.body,
    color: theme.colors.text.inverse,
    textAlign: 'center',
    flex: 1,
  },
  textBesideClose: { textAlign: 'left', marginRight: theme.spacing.sm },
});
