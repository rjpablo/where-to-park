import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { SlideToConfirm } from '../../src/components/SlideToConfirm';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { embeddedOne } from '../../src/lib/embed';
import { firstParam } from '../../src/lib/params';
import {
  driverSessionKind,
  reservationErrorMessage,
  type DriverSessionKind,
} from '../../src/lib/reservations';
import { VEHICLE_TYPE_LABELS, type VehicleType } from '../../src/lib/searchFilters';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { showToast } from '../../src/stores/toastStore';
import { useAuthStore } from '../../src/stores/authStore';
import { formatLocalDateTime, formatPeso } from '../../src/utils/formatters';

type SessionRow = {
  id: string;
  location_id: string;
  plate: string;
  vehicle_type: string;
  started_at: string;
  scheduled_end_at: string | null;
  status: string;
  approval_status: string | null;
  cancelled_at: string | null;
  rate_snapshot: { amount?: number | string | null } | null;
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

/** Read-only for the driver, except editing while For Approval and cancelling before the start. */
export default function DriverSessionScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const id = firstParam(useLocalSearchParams<{ id?: string }>().id);
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const [row, setRow] = React.useState<SessionRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelAttempt, setCancelAttempt] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('parking_sessions')
      .select(
        'id, location_id, plate, vehicle_type, started_at, scheduled_end_at, status, approval_status, cancelled_at, rate_snapshot, locations(name)'
      )
      .eq('id', id)
      .eq('driver_id', user.id)
      .maybeSingle();
    if (fetchError) setError('Could not open this session.');
    else {
      setError(null);
      setRow((data as SessionRow | null) ?? null);
    }
    setLoading(false);
  }, [id, user]);

  React.useEffect(() => {
    if (!initialized || user) return;
    router.replace(`/auth?next=${encodeURIComponent(`/sessions/${id}`)}`);
  }, [initialized, user, id, router]);

  React.useEffect(() => {
    load();
  }, [load]);

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('cancel_reservation_session', {
      p_session_id: id,
    });
    setCancelling(false);
    if (rpcError || data?.error) {
      setError(reservationErrorMessage(data?.error || rpcError?.message));
      setCancelAttempt((n) => n + 1);
      return;
    }
    showToast('Reservation cancelled', 'success');
    await load();
  };

  if (!initialized || !user || loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="driver-session-loading">
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!row) {
    return (
      <View style={[styles.container, styles.centered]} testID="driver-session-missing">
        <Text style={styles.error}>{error || 'Session not found.'}</Text>
      </View>
    );
  }

  const kind = driverSessionKind(row);
  const place = embeddedOne(row.locations)?.name || 'Parking';
  const amount = Number(row.rate_snapshot?.amount);
  const planned = Number.isFinite(amount) ? formatPeso(amount) : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="driver-session-ready"
    >
      <Text style={styles.place} testID="driver-session-place">
        {place}
      </Text>
      <Text style={styles.status} testID="driver-session-status">
        {STATUS[kind]}
      </Text>
      <Text style={styles.plate} testID="driver-session-plate">
        {row.plate}
      </Text>
      <Text style={styles.line}>
        {VEHICLE_TYPE_LABELS[row.vehicle_type as VehicleType] || row.vehicle_type}
      </Text>
      <Text style={styles.line}>Starts {formatLocalDateTime(row.started_at)}</Text>
      {row.scheduled_end_at ? (
        <Text style={styles.line}>Ends {formatLocalDateTime(row.scheduled_end_at)}</Text>
      ) : null}
      {planned && (kind === 'waiting' || kind === 'approved') ? (
        <Text style={styles.line} testID="driver-session-price">
          Planned price {planned}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="driver-session-error">
          {error}
        </Text>
      ) : null}
      {kind === 'waiting' ? (
        <Button
          title="Edit reservation"
          variant="outline"
          onPress={() => router.push(`/reserve/${row.location_id}?session=${row.id}` as never)}
          testID="driver-session-edit"
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}
      {kind === 'waiting' || kind === 'approved' ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <SlideToConfirm
            label="Slide to cancel"
            onConfirm={cancel}
            loading={cancelling}
            resetKey={cancelAttempt}
            testID="driver-session-cancel"
          />
        </View>
      ) : null}
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
  place: { ...theme.typography.h3, color: theme.colors.text.primary },
  status: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  plate: { ...theme.typography.h2, color: theme.colors.text.primary },
  line: { ...theme.typography.body, color: theme.colors.text.primary, marginTop: theme.spacing.xs },
  error: { ...theme.typography.bodySmall, color: theme.colors.danger, marginTop: theme.spacing.md },
});
