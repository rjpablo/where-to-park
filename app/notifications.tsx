import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { supabase } from '../src/lib/supabase';
import { useAuthStore } from '../src/stores/authStore';
import { formatLocalDateTime, formatRelativeTime } from '../src/utils/formatters';
import { theme } from '../src/lib/theme';
import { refreshSidebarCounts } from '../src/stores/sidebarStore';

export default function NotificationsScreen() {
  const router = useRouter();
  const { user, initialize } = useAuthStore();
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setItems(data || []);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  if (!user) {
    return (
      <View style={styles.container} testID="notifications-guest">
        <Text style={styles.title}>Sign in to see notifications</Text>
        <Button title="Sign in" onPress={() => router.push('/auth')} />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="notifications-ready">
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={
          <Text style={styles.empty}>{loading ? 'Loading...' : 'No notifications yet'}</Text>
        }
        renderItem={({ item }) => (
          <View
            style={[styles.row, !item.read_at && styles.unread]}
            testID={`notification-${item.type}`}
          >
            <Text style={styles.rowTitle}>{item.title}</Text>
            {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
            <Text style={styles.meta}>
              {formatLocalDateTime(item.created_at)} · {formatRelativeTime(item.created_at)}
            </Text>
            {!item.read_at ? (
              <Button
                title="Mark read"
                size="small"
                variant="outline"
                onPress={async () => {
                  await supabase.rpc('mark_notification_read', { p_id: item.id });
                  await load();
                  refreshSidebarCounts();
                }}
              />
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: theme.spacing.lg, backgroundColor: theme.colors.background },
  title: { ...theme.typography.h2, marginBottom: theme.spacing.md },
  empty: { ...theme.typography.body, color: theme.colors.text.secondary },
  row: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  unread: { borderLeftWidth: 4, borderLeftColor: theme.colors.primary },
  rowTitle: { ...theme.typography.body, fontWeight: '600' },
  body: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 4 },
  meta: { ...theme.typography.caption, color: theme.colors.text.tertiary, marginVertical: 6 },
});
