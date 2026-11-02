import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { refreshSidebarCounts } from '../../src/stores/sidebarStore';
import { formatLocalDateTime } from '../../src/utils/formatters';
import { categoryLabel, contactSender } from '../../src/lib/contact';
import { Avatar } from '../../src/components/Avatar';

type Filter = 'open' | 'resolved' | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

/** Admin: Contact Us messages, newest first. */
export default function AdminContactScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [filter, setFilter] = React.useState<Filter>('open');
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_contact_submissions', {
      p_status: filter === 'all' ? null : filter,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      setItems([]);
    } else {
      setItems(data?.items || []);
    }
    setLoading(false);
    refreshSidebarCounts();
  }, [filter]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  if (user && !user.is_admin) {
    return (
      <View style={styles.container} testID="contact-admin-denied">
        <Text style={styles.meta}>Admins only</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      testID={loading ? 'contact-admin-loading' : 'contact-admin-ready'}
    >
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.chip, filter === f.value && styles.chipOn]}
            onPress={() => setFilter(f.value)}
            testID={`contact-filter-${f.value}`}
          >
            <Text style={[styles.chipText, filter === f.value && styles.chipTextOn]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        contentContainerStyle={bottomInset}
        data={items}
        keyExtractor={(i) => i.id}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={
          <Text style={styles.meta} testID="contact-admin-empty">
            {loading ? 'Loading…' : 'No messages'}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              router.push(`/admin/contact-item?id=${encodeURIComponent(item.id)}` as never)
            }
            testID={`contact-row-${item.id}`}
          >
            <View style={styles.rowTop}>
              <Text style={styles.category}>{categoryLabel(item.category)}</Text>
              <Text
                style={[styles.status, item.status === 'resolved' ? styles.resolved : styles.open]}
                testID={`contact-status-${item.id}`}
              >
                {item.status === 'resolved' ? 'Resolved' : 'Open'}
              </Text>
            </View>
            <Text style={styles.preview} numberOfLines={2}>
              {item.preview}
            </Text>
            <View style={styles.senderRow}>
              {item.user_id ? (
                <Avatar url={item.user_avatar_url} size={24} name={item.user_name} />
              ) : null}
              <Text style={[styles.meta, styles.senderText]}>
                {contactSender(item)} · {formatLocalDateTime(item.created_at)}
                {Number(item.images)
                  ? ` · ${item.images} image${Number(item.images) === 1 ? '' : 's'}`
                  : ''}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  senderText: { flex: 1 },
  container: { flex: 1, padding: theme.spacing.lg, backgroundColor: theme.colors.background },
  chips: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.bodySmall },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  row: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: { ...theme.typography.body, fontWeight: '700' },
  status: {
    ...theme.typography.caption,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  open: { backgroundColor: '#fef3c7', color: '#92400e' },
  resolved: { backgroundColor: '#dcfce7', color: '#166534' },
  preview: { ...theme.typography.bodySmall, marginTop: 4 },
  meta: { ...theme.typography.caption, color: theme.colors.text.tertiary, marginTop: 6 },
  error: { ...theme.typography.bodySmall, color: theme.colors.danger },
});
