import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { embeddedOne } from '../../src/lib/embed';
import {
  DRIVER_SESSION_SECTIONS,
  driverSessionKind,
  type DriverSessionKind,
} from '../../src/lib/reservations';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { formatLocalDateTime } from '../../src/utils/formatters';

type Row = {
  id: string;
  plate: string;
  vehicle_type: string;
  started_at: string;
  scheduled_end_at: string | null;
  status: string;
  approval_status: string | null;
  cancelled_at: string | null;
  locations: { name?: string | null } | { name?: string | null }[] | null;
};

const STATUS: Record<DriverSessionKind, string> = {
  waiting: 'For approval',
  approved: 'Approved',
  active: 'Active',
  previous: 'Previous',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** The signed-in driver's reservations and sessions. No count in the sidebar. */
export default function SessionsScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!initialized || user) return;
    router.replace('/auth?next=%2Fsessions');
  }, [initialized, user, router]);

  React.useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('parking_sessions')
        .select(
          'id, plate, vehicle_type, started_at, scheduled_end_at, status, approval_status, cancelled_at, locations(name)'
        )
        .eq('driver_id', user.id)
        .order('started_at', { ascending: false });
      if (!live) return;
      if (fetchError) setError('Could not load your sessions.');
      else setRows((data || []) as Row[]);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [user]);

  if (!initialized || !user || loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="sessions-loading">
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="sessions-ready"
    >
      {error ? (
        <Text style={styles.error} testID="sessions-error">
          {error}
        </Text>
      ) : null}
      {!error && rows.length === 0 ? (
        <Text style={styles.empty} testID="sessions-empty">
          You have no sessions yet.
        </Text>
      ) : null}
      {DRIVER_SESSION_SECTIONS.map((section) => {
        const items = rows.filter((row) => driverSessionKind(row) === section.kind);
        if (!items.length) return null;
        return (
          <View key={section.kind} testID={`sessions-${section.kind}`}>
            <Text style={styles.heading}>{section.title}</Text>
            {items.map((row) => {
              const place = embeddedOne(row.locations)?.name || 'Parking';
              return (
                <TouchableOpacity
                  key={row.id}
                  style={styles.card}
                  onPress={() => router.push(`/sessions/${row.id}` as never)}
                  testID={`session-row-${row.plate}`}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.place}>{place}</Text>
                    <Text style={styles.status}>{STATUS[section.kind]}</Text>
                  </View>
                  <Text style={styles.plate}>{row.plate}</Text>
                  <Text style={styles.when}>{formatLocalDateTime(row.started_at)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
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
  centered: { alignItems: 'center', justifyContent: 'center' },
  heading: {
    ...theme.typography.bodySmall,
    fontWeight: '700',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm },
  place: { ...theme.typography.body, fontWeight: '600', color: theme.colors.text.primary, flex: 1 },
  status: { ...theme.typography.caption, color: theme.colors.text.secondary },
  plate: { ...theme.typography.body, color: theme.colors.text.primary, marginTop: 2 },
  when: { ...theme.typography.caption, color: theme.colors.text.secondary, marginTop: 2 },
  empty: { ...theme.typography.body, color: theme.colors.text.secondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
