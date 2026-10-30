import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { WorkspaceNav } from '../../src/components/WorkspaceNav';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { useAuthStore } from '../../src/stores/authStore';
import { formatLocalDateTime, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

export default function OperatorInboxScreen() {
  const router = useRouter();
  const locationId = firstParam(
    useLocalSearchParams<{ locationId?: string | string[] }>().locationId
  );
  const { user, initialize } = useAuthStore();
  const [threads, setThreads] = React.useState<any[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    let query = supabase
      .from('chat_threads')
      .select(
        'id, location_id, driver_id, last_message_at, locations(name), public_profiles(display_name)'
      )
      .order('last_message_at', { ascending: false });
    if (locationId) query = query.eq('location_id', locationId);
    const { data, error: fetchError } = await query;
    if (fetchError) setError(fetchError.message);
    setThreads(data || []);
    setLoading(false);
  }, [locationId]);

  React.useEffect(() => {
    initialize();
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [initialize, load]);

  if (loading) {
    return (
      <View style={styles.container} testID="inbox-loading">
        <WorkspaceNav listingId={locationId} />
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="inbox-ready">
      <WorkspaceNav listingId={locationId} />
      <Text style={styles.title}>Messages</Text>
      <Text style={styles.meta}>{user ? `Signed in as ${user.display_name}` : 'Sign in'}</Text>
      {threads.map((t) => (
        <View key={t.id} style={styles.card} testID={`inbox-thread-${t.driver_id}`}>
          <Text style={styles.rowTitle}>
            {t.driver_id === user?.id
              ? t.locations?.name || 'Parking'
              : t.public_profiles?.display_name || 'Driver'}
          </Text>
          <Text style={styles.meta}>
            {t.locations?.name} · {formatLocalDateTime(t.last_message_at)} (
            {formatRelativeTime(t.last_message_at)})
          </Text>
          <Button
            title="Open"
            size="small"
            onPress={() =>
              router.push({
                pathname: '/chat/[locationId]',
                params: { locationId: t.location_id, driverId: t.driver_id },
              })
            }
          />
        </View>
      ))}
      {threads.length === 0 ? <Text style={styles.meta}>No messages yet</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  title: { ...theme.typography.h2 },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  rowTitle: { ...theme.typography.body, fontWeight: '600' },
  error: { color: theme.colors.danger, marginTop: theme.spacing.md },
});
