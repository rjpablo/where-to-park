import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../src/components/Button';
import { supabase } from '../src/lib/supabase';
import { useAuthStore } from '../src/stores/authStore';
import { formatLocalDateTime, formatRelativeTime } from '../src/utils/formatters';
import { theme } from '../src/lib/theme';
import { refreshSidebarCounts } from '../src/stores/sidebarStore';
import { useBannerSlot } from '../src/hooks/useBannerSlot';
import { AdBanner } from '../src/components/AdBanner';
import {
  NOTIFICATIONS_ROUTE,
  notificationRowRoute,
  type NotificationRowLike,
} from '../src/lib/notificationRoute';

export default function NotificationsScreen() {
  // Edge-to-edge: the list ends just above the navigation bar (one inset), or just above
  // the bottom banner ad, which pads for the navigation bar itself.
  const { contentInset: bottomInset, onBannerShownChange } = useBannerSlot(theme.spacing.lg);
  const router = useRouter();
  const { user, initialize } = useAuthStore();
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [answering, setAnswering] = React.useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = React.useState<string | null>(null);

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

  const openItem = (item: NotificationRowLike & { id: string; read_at?: string | null }) => {
    const route = notificationRowRoute(item);
    // An invite is answered on this screen; other rows open their related screen.
    if (route === NOTIFICATIONS_ROUTE) return;
    if (!item.read_at) {
      void supabase.rpc('mark_notification_read', { p_id: item.id }).then(({ error }) => {
        if (!error) refreshSidebarCounts();
      });
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row
        )
      );
    }
    router.push(route as never);
  };

  if (!user) {
    return (
      <View style={styles.container} testID="notifications-guest">
        <Text style={styles.title}>Sign in to see notifications</Text>
        <Button title="Sign in" onPress={() => router.push('/auth')} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.container} testID="notifications-ready">
        {inviteNotice ? (
          <Text style={styles.inviteNotice} testID="invite-notice">
            {inviteNotice}
          </Text>
        ) : null}
        <FlatList
          contentContainerStyle={bottomInset}
          data={items}
          keyExtractor={(item) => item.id}
          refreshing={loading}
          onRefresh={load}
          ListEmptyComponent={
            <Text style={styles.empty}>{loading ? 'Loading...' : 'No notifications yet'}</Text>
          }
          renderItem={({ item }) => {
            const route = notificationRowRoute(item);
            const opens = route !== NOTIFICATIONS_ROUTE;
            const summary = (
              <>
                <Text style={[styles.rowTitle, opens && styles.link]}>
                  {item.title}
                  {opens ? ' ›' : ''}
                </Text>
                {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
                <Text style={styles.meta}>
                  {formatLocalDateTime(item.created_at)} · {formatRelativeTime(item.created_at)}
                </Text>
              </>
            );
            return (
              <View
                style={[styles.row, !item.read_at && styles.unread]}
                testID={`notification-${item.type}`}
              >
                {opens ? (
                  <TouchableOpacity
                    onPress={() => openItem(item)}
                    accessibilityRole="link"
                    testID={`notification-open-${item.id}`}
                  >
                    {summary}
                  </TouchableOpacity>
                ) : (
                  summary
                )}
                {item.ref_type === 'staff_invite' && item.ref_id ? (
                  item.data?.status ? (
                    <Text style={styles.meta} testID={`invite-status-${item.ref_id}`}>
                      {item.data.status === 'accepted' ? 'Accepted' : 'Declined'}
                    </Text>
                  ) : (
                    <View style={styles.inviteActions}>
                      {(['accept', 'decline'] as const).map((a) => (
                        <Button
                          key={a}
                          title={a === 'accept' ? 'Accept' : 'Decline'}
                          size="small"
                          variant={a === 'accept' ? 'primary' : 'outline'}
                          disabled={!!answering}
                          onPress={async () => {
                            setAnswering(item.id);
                            setInviteNotice(null);
                            const { data, error } = await supabase.rpc('respond_staff_invite', {
                              p_invite_id: item.ref_id,
                              p_accept: a === 'accept',
                            });
                            setAnswering(null);
                            if (error || data?.error) {
                              setInviteNotice(
                                data?.error === 'already_answered'
                                  ? 'This invite was already answered.'
                                  : 'Could not answer the invite. Try again.'
                              );
                            } else {
                              setInviteNotice(
                                a === 'accept'
                                  ? 'You joined the team. Find it under My listings.'
                                  : 'Invite declined.'
                              );
                              if (a === 'accept') await initialize();
                            }
                            await load();
                            refreshSidebarCounts();
                          }}
                          testID={`invite-${a}-${item.ref_id}`}
                        />
                      ))}
                    </View>
                  )
                ) : null}
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
            );
          }}
        />
      </View>
      <AdBanner onShownChange={onBannerShownChange} testID="notifications-ad" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  container: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
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
  link: { color: theme.colors.primary },
  body: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 4 },
  inviteActions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  inviteNotice: {
    ...theme.typography.body,
    color: theme.colors.success,
    marginBottom: theme.spacing.sm,
  },
  meta: { ...theme.typography.caption, color: theme.colors.text.tertiary, marginVertical: 6 },
});
