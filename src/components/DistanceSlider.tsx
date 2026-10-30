import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  MIN_DISTANCE_KM,
  formatDistanceKm,
  kmToPosition,
  positionToKm,
  stepDistanceKm,
} from '../lib/distance';
import { theme } from '../lib/theme';

type Props = {
  valueKm: number;
  /** Upper end of the slider (follows the searched area). */
  maxKm: number;
  /** Called once the user lets go (not on every move) so searches are not spammed. */
  onChangeKm: (km: number) => void;
  testID?: string;
};

const THUMB = 24;

/** Logarithmic distance slider (0.5 km to the searched area's edge) built on gesture-handler so it works inside the sheet. */
export function DistanceSlider({ valueKm, maxKm, onChangeKm, testID }: Props) {
  const [width, setWidth] = useState(0);
  const [draftKm, setDraftKm] = useState(valueKm);
  const dragging = useRef(false);
  // Declared before the gestures that read it (gesture-handler 2.28 reads the
  // callbacks while building them, so a later const hit the temporal dead zone).
  const draftKmRef = useRef(draftKm);
  draftKmRef.current = draftKm;

  useEffect(() => {
    if (!dragging.current) setDraftKm(valueKm);
  }, [valueKm]);

  const usable = Math.max(1, width - THUMB);
  const kmAt = (x: number) => positionToKm((x - THUMB / 2) / usable, maxKm);

  const commit = (km: number) => {
    dragging.current = false;
    setDraftKm(km);
    if (km !== valueKm) onChangeKm(km);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-4, 4])
    .failOffsetY([-14, 14])
    .onBegin((e) => {
      dragging.current = true;
      setDraftKm(kmAt(e.x));
    })
    .onUpdate((e) => setDraftKm(kmAt(e.x)))
    .onEnd((e) => commit(kmAt(e.x)))
    .onFinalize((_e, success) => {
      if (!success && dragging.current) commit(draftKmRef.current);
    });

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => commit(kmAt(e.x)));

  const left = kmToPosition(draftKm, maxKm) * usable;

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Within</Text>
        <Text style={styles.value} testID={testID ? `${testID}-value` : undefined}>
          {formatDistanceKm(draftKm)}
        </Text>
      </View>
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View
          style={styles.hit}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Search distance"
          accessibilityValue={{ text: formatDistanceKm(draftKm) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            commit(
              stepDistanceKm(draftKm, e.nativeEvent.actionName === 'increment' ? 1 : -1, maxKm)
            )
          }
        >
          <View style={styles.track} />
          <View style={[styles.fill, { width: left + THUMB / 2 }]} />
          <View style={[styles.thumb, { left }]} />
        </View>
      </GestureDetector>
      <View style={styles.scale}>
        <Text style={styles.scaleText}>{formatDistanceKm(MIN_DISTANCE_KM)}</Text>
        <Text style={styles.scaleText} testID={testID ? `${testID}-max` : undefined}>
          {formatDistanceKm(maxKm)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  value: { ...theme.typography.bodySmall, fontWeight: '700', color: theme.colors.primary },
  hit: { height: 32, justifyContent: 'center' },
  track: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: theme.colors.primary,
    ...theme.shadows.sm,
  },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleText: { ...theme.typography.caption, fontSize: 10, color: theme.colors.text.tertiary },
});
