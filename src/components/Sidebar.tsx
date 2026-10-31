import React from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { buildSidebarItems, needsAttention, type SidebarItem } from '../lib/sidebar';
import { theme } from '../lib/theme';
import { useAuthStore } from '../stores/authStore';
import { useSidebarStore } from '../stores/sidebarStore';
import { loadShortcuts, useShortcutsStore } from '../stores/shortcutsStore';
import { shortcutLabel, sidebarShortcuts } from '../lib/shortcuts';

const MAX_WIDTH = 320;
const ANIM_MS = 200;

/** ☰ button left of the 'Find Parking' header title; red dot when anything needs attention. */
export function SidebarToggle() {
  const counts = useSidebarStore((s) => s.counts);
  const setOpen = useSidebarStore((s) => s.setOpen);
  const attention = needsAttention(counts);
  return (
    <TouchableOpacity
      style={styles.toggle}
      onPress={() => setOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={attention ? 'Open menu, items need attention' : 'Open menu'}
      testID="sidebar-toggle"
    >
      <View style={styles.burger}>
        <View style={styles.burgerLine} />
        <View style={styles.burgerLine} />
        <View style={styles.burgerLine} />
      </View>
      {attention ? <View style={styles.toggleBadge} testID="sidebar-toggle-badge" /> : null}
    </TouchableOpacity>
  );
}

type Props = { hasWorkspace: boolean };

/** Collapsible drawer with the account destinations (replaces the Profile screen buttons). */
export function Sidebar({ hasWorkspace }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(MAX_WIDTH, Math.round(width * 0.85));
  const open = useSidebarStore((s) => s.open);
  const setOpen = useSidebarStore((s) => s.setOpen);
  const counts = useSidebarStore((s) => s.counts);
  const refresh = useSidebarStore((s) => s.refresh);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const initialize = useAuthStore((s) => s.initialize);
  const [visible, setVisible] = React.useState(open);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const progress = React.useRef(new Animated.Value(0)).current;
  const shortcuts = sidebarShortcuts(useShortcutsStore((s) => s.items));
  const userId = user?.id ?? null;

  React.useEffect(() => {
    if (open) loadShortcuts(userId);
  }, [open, userId]);

  React.useEffect(() => {
    if (open) {
      setVisible(true);
      setNotice(null);
      refresh();
      Animated.timing(progress, { toValue: 1, duration: ANIM_MS, useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: ANIM_MS, useNativeDriver: true }).start(
        () => setVisible(false)
      );
    }
  }, [open, progress, refresh]);

  const items = buildSidebarItems(user ? { isAdmin: !!user.is_admin, hasWorkspace } : null, counts);

  const close = () => setOpen(false);

  const go = (route: string) => {
    close();
    router.push(route as never);
  };

  const onItem = async (it: SidebarItem) => {
    if (busy) return;
    if (it.route) return go(it.route);
    if (it.key === 'sign_out') {
      setBusy(it.key);
      try {
        await signOut();
        useSidebarStore.getState().reset();
        router.replace('/search');
      } finally {
        setBusy(null);
      }
      return;
    }
    if (it.key === 'list_space' && user) {
      setBusy(it.key);
      try {
        if (user.account_type !== 'operator') {
          const { error } = await supabase
            .from('profiles')
            .update({ account_type: 'operator' })
            .eq('id', user.id);
          if (error) throw error;
          await initialize();
        }
        go('/operator/onboarding');
      } catch (err: any) {
        setNotice(err?.message || 'Could not start listing');
      } finally {
        setBusy(null);
      }
    }
  };

  if (!visible) return null;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-drawerWidth, 0],
  });
  const account = items.filter((i) => i.section === 'account' && i.key !== 'sign_out');
  const admin = items.filter((i) => i.section === 'admin');
  const signOutItem = items.find((i) => i.key === 'sign_out');

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root} testID="sidebar">
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel="Close menu"
            testID="sidebar-backdrop"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: insets.top + theme.spacing.md,
              paddingBottom: insets.bottom + theme.spacing.md,
              transform: [{ translateX }],
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1} testID="sidebar-user">
                {user ? user.display_name : 'Where To Park'}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {user
                  ? [user.is_admin ? 'Admin' : user.account_type || 'driver', user.phone]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Sign in to save vehicles, message and list spaces'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={close}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Close menu"
              testID="sidebar-close"
            >
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {/* Shortcuts (first 3; the section shows once there is at least one). */}
            {shortcuts.length ? (
              <View testID="sidebar-shortcuts">
                <View style={styles.sectionRow}>
                  <Text style={[styles.section, styles.sectionInRow]}>Shortcuts</Text>
                  <TouchableOpacity
                    onPress={() => go('/shortcuts')}
                    accessibilityRole="link"
                    accessibilityLabel="View all shortcuts"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID="sidebar-shortcuts-all"
                  >
                    <Text style={styles.viewAll}>View all</Text>
                  </TouchableOpacity>
                </View>
                {shortcuts.map((sc) => (
                  <TouchableOpacity
                    key={sc.locationId}
                    style={styles.row}
                    onPress={() => go(`/location/${encodeURIComponent(sc.locationId)}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Shortcut: ${shortcutLabel(sc)}`}
                    testID={`sidebar-shortcut-${sc.locationId}`}
                  >
                    <Text
                      style={[styles.rowLabel, !sc.available && styles.rowMuted]}
                      numberOfLines={1}
                    >
                      {shortcutLabel(sc)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {account.map((it) => (
              <Row key={it.key} item={it} busy={busy === it.key} onPress={() => onItem(it)} />
            ))}
            {admin.length ? <Text style={styles.section}>Admin</Text> : null}
            {admin.map((it) => (
              <Row key={it.key} item={it} busy={busy === it.key} onPress={() => onItem(it)} />
            ))}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          </ScrollView>
          {signOutItem ? (
            <Row
              item={signOutItem}
              busy={busy === 'sign_out'}
              onPress={() => onItem(signOutItem)}
              muted
            />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function Row({
  item,
  busy,
  onPress,
  muted,
}: {
  item: SidebarItem;
  busy: boolean;
  onPress: () => void;
  muted?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={item.countLabel ? `${item.label}, ${item.countLabel}` : item.label}
      testID={`sidebar-item-${item.key}`}
    >
      <Text style={[styles.rowLabel, muted && styles.rowMuted]} numberOfLines={1}>
        {busy ? `${item.label}…` : item.label}
      </Text>
      {item.countLabel ? (
        <View
          style={[styles.pill, item.alert ? styles.pillAlert : styles.pillInfo]}
          testID={`sidebar-count-${item.key}`}
        >
          <Text style={[styles.pillText, !item.alert && styles.pillTextInfo]}>
            {item.countLabel}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: Platform.select({ web: 8, default: 0 }),
    marginRight: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  burger: { gap: 4 },
  burgerLine: { width: 18, height: 2, borderRadius: 1, backgroundColor: theme.colors.text.primary },
  toggleBadge: {
    position: 'absolute',
    top: 7,
    right: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.danger,
    borderWidth: 2,
    borderColor: theme.colors.background,
  },
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.background,
    ...theme.shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerText: { flex: 1, minWidth: 0 },
  name: { ...theme.typography.h3 },
  sub: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 2 },
  close: { fontSize: 18, color: theme.colors.text.secondary },
  list: { paddingVertical: theme.spacing.sm },
  section: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: theme.spacing.lg,
  },
  sectionInRow: { flex: 1 },
  viewAll: {
    ...theme.typography.bodySmall,
    color: theme.colors.primary,
    fontWeight: '600',
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
  },
  rowLabel: { ...theme.typography.body, flex: 1, minWidth: 0, fontWeight: '600' },
  rowMuted: { color: theme.colors.text.secondary },
  pill: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillAlert: { backgroundColor: theme.colors.danger },
  pillInfo: { backgroundColor: theme.colors.surfaceDark },
  pillText: { ...theme.typography.caption, color: '#fff', fontWeight: '700' },
  pillTextInfo: { color: theme.colors.text.secondary },
  notice: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    paddingHorizontal: theme.spacing.lg,
  },
});
