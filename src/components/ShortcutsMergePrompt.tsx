import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import {
  GUEST_SHORTCUTS_ASKED_KEY,
  GUEST_SHORTCUTS_KEY,
  parseGuestShortcuts,
  shortcutSetKey,
  shortcutsToMerge,
} from '../lib/shortcuts';
import { useAuthStore } from '../stores/authStore';
import { loadShortcuts } from '../stores/shortcutsStore';

// After a guest with shortcuts on this device signs in, ask once: add them to the
// account or not. The device list itself is kept for signed-out use; the answered
// set is remembered so the same set isn't offered again.
export function ShortcutsMergePrompt() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [ask, setAsk] = React.useState<{ ids: string[]; key: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAsk(null);
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const device = parseGuestShortcuts(await AsyncStorage.getItem(GUEST_SHORTCUTS_KEY));
      const ids = device.map((d) => d.locationId);
      const key = shortcutSetKey(ids);
      if (!key || (await AsyncStorage.getItem(GUEST_SHORTCUTS_ASKED_KEY)) === key) return;
      const { data } = await supabase.from('location_shortcuts').select('location_id');
      const missing = shortcutsToMerge(
        (data || []).map((r: any) => r.location_id),
        ids
      );
      if (cancelled) return;
      if (!missing.length) {
        await AsyncStorage.setItem(GUEST_SHORTCUTS_ASKED_KEY, key);
        return;
      }
      setAsk({ ids: missing, key });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const answer = async (add: boolean) => {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      if (add) {
        for (const id of ask.ids) {
          const { data, error: e } = await supabase.rpc('add_location_shortcut', {
            p_location_id: id,
          });
          // A listing deleted since it was saved is skipped, not an error.
          if (e) throw e;
          if (data?.error && data.error !== 'not_found') throw new Error(String(data.error));
        }
        await loadShortcuts(userId);
      }
      await AsyncStorage.setItem(GUEST_SHORTCUTS_ASKED_KEY, ask.key);
      setAsk(null);
    } catch (err: any) {
      setError(err?.message || 'Could not add the shortcuts');
    } finally {
      setBusy(false);
    }
  };

  if (!ask) return null;
  const n = ask.ids.length;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => answer(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="shortcuts-merge">
          <Text style={styles.title}>Shortcuts on this device</Text>
          <Text style={styles.body} testID="shortcuts-merge-text">
            Add your {n} shortcut{n === 1 ? '' : 's'} from this device to your account?
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.row}>
            <Button
              title="Don't add"
              variant="outline"
              onPress={() => answer(false)}
              disabled={busy}
              testID="shortcuts-merge-no"
            />
            <Button
              title="Add"
              onPress={() => answer(true)}
              loading={busy}
              testID="shortcuts-merge-yes"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
  },
  title: { ...theme.typography.h3, marginBottom: theme.spacing.sm },
  body: { ...theme.typography.body, marginBottom: theme.spacing.md },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginBottom: theme.spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm },
});
