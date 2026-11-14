import React from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { theme } from '../lib/theme';
import { clampSlide, slideConfirms, slideTravel } from '../lib/slideToConfirm';

const KNOB = 52;
const PAD = 4;

interface SlideToConfirmProps {
  /** Text on the track, e.g. 'Slide to delete'. */
  label: string;
  /** Called once when the knob is released at the end of the track. */
  onConfirm: () => void;
  /** Track colour once confirmed and the knob/fill colour. Defaults to the danger red. */
  color?: string;
  disabled?: boolean;
  /** Shows a spinner on the knob and keeps it at the end (e.g. while the request runs). */
  loading?: boolean;
  /** Change this to put the knob back at the start (e.g. after a failed request). */
  resetKey?: unknown;
  testID?: string;
}

/**
 * A track with a knob the user drags all the way to the right to confirm a destructive action.
 * Releasing early springs the knob back. Screen readers get an 'activate' action instead.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  color = theme.colors.danger,
  disabled = false,
  loading = false,
  resetKey,
  testID = 'slide-to-confirm',
}: SlideToConfirmProps) {
  const [travel, setTravel] = React.useState(0);
  const [confirmed, setConfirmed] = React.useState(false);
  const x = React.useRef(new Animated.Value(0)).current;
  const offset = React.useRef(0);
  const state = React.useRef({ travel, disabled, confirmed, onConfirm });
  state.current = { travel, disabled: disabled || loading, confirmed, onConfirm };

  const springBack = React.useCallback(() => {
    offset.current = 0;
    Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
  }, [x]);

  React.useEffect(() => {
    setConfirmed(false);
    springBack();
  }, [resetKey, springBack]);

  const confirm = React.useCallback(() => {
    const s = state.current;
    if (s.confirmed || s.disabled) return;
    offset.current = s.travel;
    Animated.timing(x, { toValue: s.travel, duration: 120, useNativeDriver: false }).start();
    setConfirmed(true);
    s.onConfirm();
  }, [x]);

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !state.current.disabled && !state.current.confirmed,
        onMoveShouldSetPanResponder: () => !state.current.disabled && !state.current.confirmed,
        // Keep the drag even if a parent ScrollView would like to take over.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderMove: (_e, g) => {
          const pos = clampSlide(g.dx, state.current.travel);
          offset.current = pos;
          x.setValue(pos);
        },
        onPanResponderRelease: (_e, g) => {
          const pos = clampSlide(g.dx, state.current.travel);
          if (slideConfirms(pos, state.current.travel)) confirm();
          else springBack();
        },
        onPanResponderTerminate: () => springBack(),
      }),
    [confirm, springBack, x]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    setTravel(slideTravel(e.nativeEvent.layout.width, KNOB, PAD));
  };

  const fillWidth = Animated.add(x, KNOB + PAD * 2);
  const labelOpacity = travel
    ? x.interpolate({ inputRange: [0, travel * 0.6], outputRange: [1, 0], extrapolate: 'clamp' })
    : 1;

  return (
    <View
      style={[styles.track, (disabled || travel === 0) && styles.trackDisabled]}
      onLayout={onLayout}
      accessible
      accessibilityRole="button"
      accessibilityHint="Drag the handle to the end to confirm"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate') confirm();
      }}
      testID={testID}
    >
      <Animated.View
        style={[styles.fill, { backgroundColor: color, width: fillWidth, opacity: 0.18 }]}
      />
      <Animated.Text style={[styles.label, { opacity: labelOpacity }]} numberOfLines={1}>
        {label} ››
      </Animated.Text>
      <Animated.View
        {...responder.panHandlers}
        style={[
          styles.knob,
          { backgroundColor: color, transform: [{ translateX: x }] },
          disabled && styles.knobDisabled,
        ]}
        testID={`${testID}-knob`}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.text.inverse} />
        ) : (
          <Text style={styles.knobText}>{confirmed ? '✓' : '›'}</Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: KNOB + PAD * 2,
    borderRadius: (KNOB + PAD * 2) / 2,
    backgroundColor: theme.colors.surfaceDark,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackDisabled: { opacity: 0.6 },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: (KNOB + PAD * 2) / 2,
  },
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    textAlign: 'center',
    paddingLeft: KNOB,
    paddingRight: theme.spacing.md,
  },
  knob: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Web: show a grab cursor and stop the browser from scrolling/selecting while dragging.
    cursor: 'grab',
    userSelect: 'none',
    touchAction: 'none',
  } as any,
  knobDisabled: { opacity: 0.5 },
  knobText: { color: theme.colors.text.inverse, fontSize: 26, fontWeight: '700', lineHeight: 30 },
});
