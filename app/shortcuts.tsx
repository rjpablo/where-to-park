import React from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type PanResponderInstance,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { useBottomInset } from '../src/hooks/useBottomInset';
import { dragTargetIndex, moveItem, shortcutLabel, type Shortcut } from '../src/lib/shortcuts';
import { theme } from '../src/lib/theme';
import { useAuthStore } from '../src/stores/authStore';
import { loadShortcuts, useShortcutsStore } from '../src/stores/shortcutsStore';

// Shortcuts screen (rj): every shortcut in the user's order (new ones at the bottom).
// Hold a row (~0.3 s) and drag it to reorder; Delete asks first. Plain RN
// PanResponder, so it works the same on Android and web with no native module.

const ROW_H = 64;
const HOLD_MS = 300;

export default function ShortcutsScreen() {
  const router = useRouter();
  const bottomInset = useBottomInset();
  const user = useAuthStore((s) => s.user);
  const items = useShortcutsStore((s) => s.items);
  const loaded = useShortcutsStore((s) => s.loaded);
  const reorder = useShortcutsStore((s) => s.reorder);
  const remove = useShortcutsStore((s) => s.remove);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<{ from: number; to: number } | null>(null);
  const dy = React.useRef(new Animated.Value(0)).current;
  const dragRef = React.useRef<{ from: number; to: number } | null>(null);
  const itemsRef = React.useRef<Shortcut[]>(items);
  itemsRef.current = items;

  React.useEffect(() => {
    loadShortcuts(user?.id ?? null);
  }, [user?.id]);

  const finish = React.useCallback(async () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    dy.setValue(0);
    if (!d || d.from === d.to) return;
    setError(null);
    const err = await reorder(moveItem(itemsRef.current, d.from, d.to));
    if (err) setError(err);
  }, [dy, reorder]);

  // One responder per row index; rebuilt when the count changes.
  const responders = React.useMemo(() => {
    const list: PanResponderInstance[] = [];
    for (let i = 0; i < items.length; i++) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      list.push(
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onPanResponderGrant: () => {
            timer = setTimeout(() => {
              dragRef.current = { from: i, to: i };
              setDrag({ from: i, to: i });
            }, HOLD_MS);
          },
          onPanResponderMove: (_e, g) => {
            const d = dragRef.current;
            if (!d) {
              // Moved before the hold finished: not a drag.
              if (Math.abs(g.dy) > 10 && timer) {
                clearTimeout(timer);
                timer = null;
              }
              return;
            }
            dy.setValue(g.dy);
            const to = dragTargetIndex(d.from, g.dy, ROW_H, itemsRef.current.length);
            if (to !== d.to) {
              dragRef.current = { from: d.from, to };
              setDrag({ from: d.from, to });
            }
          },
          onPanResponderTerminationRequest: () => !dragRef.current,
          onPanResponderRelease: () => {
            if (timer) clearTimeout(timer);
            timer = null;
            finish();
          },
          onPanResponderTerminate: () => {
            if (timer) clearTimeout(timer);
            timer = null;
            finish();
          },
        })
      );
    }
    return list;
  }, [items.length, dy, finish]);

  const del = async (s: Shortcut) => {
    setConfirm(null);
    setError(null);
    const err = await remove(s.locationId);
    if (err) setError(err);
  };

  // While dragging, the others shift to show where the row will land.
  const offsetFor = (i: number): number => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -ROW_H;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return ROW_H;
    return 0;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, bottomInset]}
      scrollEnabled={!drag}
      testID="shortcuts-ready"
    >
      {loaded && !items.length ? (
        <Text style={styles.meta} testID="shortcuts-empty">
          No shortcuts yet. Open a listing and tap Add shortcut.
        </Text>
      ) : null}
      {items.length ? (
        <Text style={styles.meta}>
          Hold a shortcut and drag it to reorder. The first 3 show in the menu.
          {user ? '' : ' Shortcuts are saved on this device until you sign in.'}
        </Text>
      ) : null}
      <View style={{ height: items.length * ROW_H }} testID="shortcuts-list">
        {items.map((s, i) => {
          const dragging = drag?.from === i;
          return (
            <Animated.View
              key={s.locationId}
              style={[
                styles.row,
                { top: i * ROW_H },
                dragging
                  ? [styles.rowDragging, { transform: [{ translateY: dy }] }]
                  : { transform: [{ translateY: offsetFor(i) }] },
              ]}
              testID={`shortcut-row-${i}`}
              accessibilityLabel={shortcutLabel(s)}
              {...responders[i]?.panHandlers}
            >
              <Text style={styles.handle} accessibilityElementsHidden>
                ≡
              </Text>
              <TouchableOpacity
                style={styles.nameWrap}
                onPress={() =>
                  !drag && router.push(`/location/${encodeURIComponent(s.locationId)}`)
                }
                accessibilityRole="button"
                testID={`shortcut-open-${i}`}
              >
                <Text
                  style={[styles.name, !s.available && styles.muted]}
                  numberOfLines={1}
                  testID={`shortcut-name-${i}`}
                >
                  {shortcutLabel(s)}
                </Text>
              </TouchableOpacity>
              {confirm === s.locationId ? (
                <View style={styles.confirm}>
                  <Button
                    title="Delete"
                    size="small"
                    variant="danger"
                    onPress={() => del(s)}
                    testID={`shortcut-delete-yes-${i}`}
                  />
                  <Button
                    title="Keep"
                    size="small"
                    variant="outline"
                    onPress={() => setConfirm(null)}
                    testID={`shortcut-delete-no-${i}`}
                  />
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setConfirm(s.locationId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete shortcut ${shortcutLabel(s)}`}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  testID={`shortcut-delete-${i}`}
                >
                  <Text style={styles.delete}>Delete</Text>
                </TouchableOpacity>
              )}
            </Animated.View>
          );
        })}
      </View>
      {error ? (
        <Text style={styles.error} testID="shortcuts-error">
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md,
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW_H - 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    // web: keep the browser from selecting text while dragging
    userSelect: 'none',
  },
  rowDragging: { ...theme.shadows.lg, zIndex: 10, elevation: 6, opacity: 0.95 },
  handle: { fontSize: 20, color: theme.colors.text.tertiary, width: 20 },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { ...theme.typography.body, fontWeight: '600' },
  muted: { color: theme.colors.text.secondary, fontStyle: 'italic' },
  delete: { ...theme.typography.bodySmall, color: theme.colors.danger, fontWeight: '600' },
  confirm: { flexDirection: 'row', gap: theme.spacing.xs },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
});
