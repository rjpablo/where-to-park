import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button } from '../../src/components/Button';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { parseSearchCapKm, searchCapKm } from '../../src/lib/distance';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { useAuthStore } from '../../src/stores/authStore';

/**
 * Admin › System Settings. The search radius cap is the only setting. Guests read it
 * through get_search_radius_cap. Saving goes through admin_set_search_radius_cap,
 * which refuses anyone who is not an admin.
 */
export default function AdminSettingsScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const user = useAuthStore((s) => s.user);
  const [km, setKm] = useState('50');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    const { data, error: rpcError } = await supabase.rpc('get_search_radius_cap');
    if (rpcError || data == null) {
      setError(rpcError?.message || 'Could not load settings');
    } else {
      setKm(String(searchCapKm(Number(data))));
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (user?.is_admin) void load();
    }, [load, user?.is_admin])
  );

  const save = async () => {
    const parsed = parseSearchCapKm(km);
    if ('error' in parsed) {
      setSaved(false);
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const { data, error: rpcError } = await supabase.rpc('admin_set_search_radius_cap', {
      p_km: parsed.km,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
    } else {
      setKm(String(parsed.km));
      setSaved(true);
    }
    setSaving(false);
  };

  if (!user?.is_admin) {
    return (
      <View style={styles.container} testID="settings-admin-denied">
        <Text style={styles.meta}>Admins only</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID={loading ? 'settings-admin-loading' : 'settings-admin-ready'}
    >
      <Text style={styles.intro}>
        A parking search never looks farther than this. When the map covers a wider area, the driver
        is told the search was limited to this distance.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.saved}>Saved</Text> : null}
      <Text style={styles.label}>Search radius limit (km)</Text>
      <TextInput
        value={km}
        onChangeText={(value) => {
          setKm(value);
          setSaved(false);
        }}
        keyboardType="number-pad"
        editable={!loading && !saving}
        style={styles.input}
        accessibilityLabel="Search radius limit in kilometres"
        testID="settings-search-cap"
      />
      <Text style={styles.meta}>A whole number from 1 to 500. The default is 50.</Text>
      <Button
        title="Save"
        onPress={() => void save()}
        loading={saving}
        disabled={loading}
        testID="settings-search-cap-save"
      />
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
  label: { ...theme.typography.body, fontWeight: '600', marginBottom: theme.spacing.sm },
  input: {
    ...theme.typography.body,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  meta: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    marginBottom: theme.spacing.md,
  },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginBottom: theme.spacing.sm,
  },
  saved: {
    ...theme.typography.bodySmall,
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
});
