import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { WalkInForm, type WalkInValues } from '../../src/components/WalkInForm';
import { walkInErrorMessage } from '../../src/lib/walkIn';
import { VEHICLE_TYPE_LABELS, type VehicleType } from '../../src/lib/searchFilters';
import { formatLocalDateTime, formatPeso } from '../../src/utils/formatters';

// One active session (opened from Active Sessions): edit start, end, vehicle, plate
// and rate; see the amount due and balance.
export default function SessionScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const [d, setD] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [formKey, setFormKey] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!id) return;
    const { data, error: e } = await supabase.rpc('session_details', { p_session_id: id });
    if (e || data?.error) {
      setError(e?.message || walkInErrorMessage(data?.error));
      return;
    }
    setError(null);
    setD(data);
  }, [id]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const save = async (v: WalkInValues): Promise<string | null> => {
    setNotice(null);
    const { data, error: e } = await supabase.rpc('update_walk_in_session', {
      p_session_id: id,
      p_started_at: v.startAt,
      p_end_at: v.endAt,
      p_vehicle_type: v.vehicleType,
      p_plate: v.plate,
      p_rate_id: v.rateId,
    });
    if (e) return e.message;
    if (data?.error) return walkInErrorMessage(data.error);
    setNotice('Session saved');
    await load();
    setFormKey((k) => k + 1);
    return null;
  };

  if (!d) {
    return (
      <View style={[styles.container, styles.centered]} testID="session-loading">
        {error ? (
          <Text style={styles.error} testID="session-error">
            {error}
          </Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const s = d.session;
  const ended = s.status === 'ended';
  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="session-ready">
      <View style={styles.header}>
        <Text style={styles.plate} testID="session-plate">
          {s.plate}
        </Text>
        <Text style={styles.headerMeta}>
          {VEHICLE_TYPE_LABELS[s.vehicle_type as VehicleType] || s.vehicle_type} · {s.location_name}{' '}
          · {s.status === 'overdue' ? 'Overdue' : ended ? 'Ended' : 'Active'}
        </Text>
      </View>

      <View style={styles.section} testID="session-balance-box">
        <Text style={styles.row}>
          Parking: {formatPeso(d.parking)}
          {d.price?.rate_name ? ` · ${d.price.rate_name}` : ''}
        </Text>
        <Text style={styles.meta}>
          {d.price?.until_now
            ? `Up to now (${formatLocalDateTime(d.price.until)})`
            : `To ${formatLocalDateTime(d.price?.until)}`}
        </Text>
        {Number(d.extra_fees) ? (
          <Text style={styles.row} testID="session-extra">
            Extra fees: {formatPeso(d.extra_fees)}
          </Text>
        ) : null}
        <Text style={styles.row} testID="session-paid">
          Paid: {formatPeso(d.paid)}
        </Text>
        <Text style={styles.balance} testID="session-balance">
          Balance: {formatPeso(d.balance)}
        </Text>
      </View>

      {!ended ? (
        <View style={styles.section}>
          <Text style={styles.heading}>Edit session</Text>
          <WalkInForm
            key={formKey}
            locationId={s.location_id}
            initial={{
              vehicleType: s.vehicle_type,
              plate: s.plate,
              startAt: s.started_at,
              endAt: s.end_at,
              rateId: s.rate_id,
            }}
            submitLabel="Save changes"
            onSubmit={save}
          />
          {notice ? (
            <Text style={styles.notice} testID="session-notice">
              {notice}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="session-error">
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  header: { padding: theme.spacing.lg, backgroundColor: theme.colors.primary },
  plate: { ...theme.typography.h2, color: '#fff' },
  headerMeta: { ...theme.typography.body, color: '#fff', opacity: 0.9 },
  section: {
    margin: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
  },
  heading: { ...theme.typography.h3 },
  row: { ...theme.typography.body, marginTop: 4 },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 2 },
  balance: { ...theme.typography.h3, color: theme.colors.primary, marginTop: theme.spacing.sm },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.sm },
  error: { ...theme.typography.body, color: theme.colors.danger, margin: theme.spacing.md },
});
