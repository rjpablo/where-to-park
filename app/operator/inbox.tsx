import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { useAuthStore } from '../../src/stores/authStore';
import { formatLocalDateTime, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';
import { embeddedOne } from '../../src/lib/embed';
import {
  latestByThread,
  previewText,
  threadHasUnread,
  type InboxMessage,
} from '../../src/lib/inbox';
import { useBottomInset } from '../../src/hooks/useBottomInset';

export default function OperatorInboxScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const locationId = firstParam(
    useLocalSearchParams<{ locationId?: string | string[] }>().locationId
  );
  const { user, initialize } = useAuthStore();
  const [threads, setThreads] = React.useState<any[]>([]);
  const [messages, setMessages] = React.useState<InboxMessage[]>([]);
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
    const rows = data || [];
    // Messages for the listed threads: the newest one is the preview, and any unread one
    // (read_at empty) makes the row bold. Opening a thread marks it read (mark_thread_read).
    const ids = rows.map((t: any) => t.id);
    if (ids.length) {
      const { data: msgRows } = await supabase
        .from('chat_messages')
        .select('thread_id, sender_id, kind, body, read_at, hidden, created_at')
        .in('thread_id', ids)
        .order('created_at', { ascending: false })
        .limit(1000);
      setMessages((msgRows || []) as InboxMessage[]);
    } else {
      setMessages([]);
    }
    setThreads(rows);
    setLoading(false);
  }, [locationId]);

  React.useEffect(() => {
    initialize();
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [initialize, load]);

  const latest = latestByThread(messages);

  if (loading) {
    return (
      <View style={styles.container} testID="inbox-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="inbox-ready">
      {!user ? <Text style={styles.meta}>Sign in to see your messages</Text> : null}
      {threads.map((t) => {
        const unread = threadHasUnread(t, messages, user?.id);
        return (
          <TouchableOpacity
            key={t.id}
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: '/chat/[locationId]',
                params: { locationId: t.location_id, driverId: t.driver_id },
              })
            }
            accessibilityRole="button"
            accessibilityState={{ selected: unread }}
            testID={`inbox-thread-${t.driver_id}`}
          >
            <Text
              style={[styles.rowTitle, unread && styles.unread]}
              numberOfLines={1}
              testID={`inbox-name-${t.id}`}
            >
              {t.driver_id === user?.id
                ? t.locations?.name || 'Parking'
                : embeddedOne<any>(t.public_profiles)?.display_name || 'Driver'}
            </Text>
            <Text
              style={[styles.preview, unread && styles.unread]}
              numberOfLines={1}
              testID={`inbox-preview-${t.id}`}
            >
              {previewText(latest[t.id], user?.id)}
            </Text>
            <Text style={styles.meta}>
              {t.locations?.name} · {formatLocalDateTime(t.last_message_at)} (
              {formatRelativeTime(t.last_message_at)})
            </Text>
          </TouchableOpacity>
        );
      })}
      {threads.length === 0 ? <Text style={styles.meta}>No messages yet</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
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
  // Name and preview are bold only while the thread has unread messages.
  rowTitle: { ...theme.typography.body, fontWeight: '400' },
  preview: { ...theme.typography.body, fontWeight: '400', color: theme.colors.text.primary },
  unread: { fontWeight: '700' },
  error: { color: theme.colors.danger, marginTop: theme.spacing.md },
});
