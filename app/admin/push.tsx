import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { useBottomInset } from '../../src/hooks/useBottomInset';

type Setting = { type: string; label: string; description?: string | null; enabled: boolean };

/**
 * Admin › Push notifications (rj t176u): one switch per notification type. A switch saves
 * at once (admin_set_push_setting). Off = the in-app notification is still created, only
 * the phone push is skipped. Server-enforced: both RPCs refuse non-admins.
 */
export default function AdminPushScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = React.useState<Setting[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_push_settings');
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      setItems([]);
    } else {
      setItems(data?.items || []);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (user?.is_admin) load();
    }, [load, user?.is_admin])
  );

  const toggle = async (type: string, enabled: boolean) => {
    setError(null);
    setSaving(type);
    // Show the new position right away; put it back if saving fails.
    setItems((prev) => prev.map((i) => (i.type === type ? { ...i, enabled } : i)));
    const { data, error: rpcError } = await supabase.rpc('admin_set_push_setting', {
      p_type: type,
      p_enabled: enabled,
    });
    if (rpcError || data?.error) {
      setItems((prev) => prev.map((i) => (i.type === type ? { ...i, enabled: !enabled } : i)));
      setError(`Couldn't save: ${rpcError?.message || String(data?.error)}`);
    }
    setSaving(null);
  };

  if (!user?.is_admin) {
    return (
      <View style={styles.container} testID="push-admin-denied">
        <Text style={styles.meta}>Admins only</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID={loading ? 'push-admin-loading' : 'push-admin-ready'}
    >
      <Text style={styles.intro}>
        Choose which notifications are also sent as a phone push. Turning one off still keeps it in
        the app's Notifications list. Changes save right away.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && !items.length ? <Text style={styles.meta}>Loading...</Text> : null}
      {items.map((it) => (
        <View key={it.type} style={styles.row} testID={`push-setting-${it.type}`}>
          <View style={styles.rowText}>
            <Text style={styles.label}>{it.label}</Text>
            {it.description ? <Text style={styles.meta}>{it.description}</Text> : null}
          </View>
          <Switch
            value={it.enabled}
            disabled={saving === it.type}
            onValueChange={(v) => toggle(it.type, v)}
            accessibilityLabel={`Push: ${it.label}`}
            testID={`push-switch-${it.type}`}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: theme.spacing.lg, backgroundColor: theme.colors.background },
  intro: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  rowText: { flex: 1 },
  label: { ...theme.typography.body, fontWeight: '600' },
  meta: { ...theme.typography.caption, color: theme.colors.text.tertiary, marginTop: 2 },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginBottom: theme.spacing.sm,
  },
});
