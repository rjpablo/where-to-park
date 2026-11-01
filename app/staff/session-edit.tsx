import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { WalkInForm, type WalkInValues } from '../../src/components/WalkInForm';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import {
  canEditSession,
  plateActiveMessage,
  plateConflict,
  walkInErrorMessage,
} from '../../src/lib/walkIn';

// Edit details (rj t131u): the session's start, end, vehicle, plate and rate on their own
// screen (moved off the Session page). Saving returns to the Session page, which reloads.
export default function SessionEditScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const sp = useLocalSearchParams<{
    id?: string | string[];
    locationId?: string | string[];
    from?: string | string[];
  }>();
  const id = firstParam(sp.id);
  const from = firstParam(sp.from);
  const [s, setS] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<{ id: string; plate: string } | null>(null);

  React.useEffect(() => {
    if (!id) return;
    supabase.rpc('session_details', { p_session_id: id }).then(({ data, error: e }) => {
      if (e || data?.error) setError(e?.message || walkInErrorMessage(data?.error));
      else setS(data.session);
    });
  }, [id]);

  const save = async (v: WalkInValues): Promise<string | null> => {
    setConflict(null);
    const { data, error: e } = await supabase.rpc('update_walk_in_session', {
      p_session_id: id,
      p_started_at: v.startAt,
      p_end_at: v.endAt,
      p_vehicle_type: v.vehicleType,
      p_plate: v.plate,
      p_rate_id: v.rateId,
    });
    if (e) return e.message;
    if (data?.error === 'plate_active') {
      setConflict(plateConflict(data));
      return plateActiveMessage(data.plate);
    }
    if (data?.error) return walkInErrorMessage(data.error);
    // Back to this session's page (already under us); it reloads on focus.
    router.dismissTo({
      pathname: '/staff/session',
      params: {
        id: id!,
        locationId: s.location_id,
        ...(from ? { from } : {}),
        notice: 'Session saved',
      },
    });
    return null;
  };

  if (!s) {
    return (
      <View style={[styles.container, styles.centered]} testID="session-edit-loading">
        {error ? (
          <Text style={styles.error} testID="session-edit-error">
            {error}
          </Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, bottomInset]}
      keyboardShouldPersistTaps="handled"
      testID="session-edit-ready"
    >
      <Text style={styles.title}>
        {s.plate} · {s.location_name}
      </Text>
      {canEditSession(s) ? (
        <>
          <WalkInForm
            locationId={s.location_id}
            initial={{
              vehicleType: s.vehicle_type,
              plate: s.plate,
              startAt: s.started_at,
              endAt: s.end_at,
              rateId: s.rate_auto ? null : s.rate_id,
            }}
            submitLabel="Save changes"
            onSubmit={save}
          />
          {conflict ? (
            <Button
              title={`Open session ${conflict.plate}`}
              variant="outline"
              style={{ marginTop: theme.spacing.md }}
              onPress={() =>
                router.push({
                  pathname: '/staff/session',
                  params: { id: conflict.id, locationId: s.location_id, ...(from ? { from } : {}) },
                })
              }
              testID="plate-conflict-open"
            />
          ) : null}
        </>
      ) : (
        <Text style={styles.meta} testID="session-edit-closed">
          This session has ended, so its details can't be edited.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  title: { ...theme.typography.h3, marginBottom: theme.spacing.md },
  meta: { ...theme.typography.body, color: theme.colors.text.secondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
