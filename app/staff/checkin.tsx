import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { WalkInForm, type WalkInValues } from '../../src/components/WalkInForm';
import { Button } from '../../src/components/Button';
import {
  plateActiveMessage,
  plateConflict,
  sessionReturnRoute,
  walkInErrorMessage,
} from '../../src/lib/walkIn';

// Walk-in check-in: vehicle, plate, start (now by default), optional end, rate
// (Automatic or any applicable rate) and the amount due. Saving opens Active Sessions.
export default function CheckInScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const sp = useLocalSearchParams<{ locationId?: string | string[]; from?: string | string[] }>();
  const locationId = firstParam(sp.locationId);
  // Opened from the Availability Sessions tab (+): saving returns there.
  const from = firstParam(sp.from);
  const [locationName, setLocationName] = useState('Listing');
  // Full switch on (0066): check-ins are still allowed (manual override), with a warning.
  const [markedFull, setMarkedFull] = useState(false);
  const [conflict, setConflict] = useState<{ id: string; plate: string } | null>(null);

  useEffect(() => {
    if (!locationId) return;
    supabase
      .from('locations')
      .select('name, marked_full')
      .eq('id', locationId)
      .single()
      .then(({ data }) => {
        if (data?.name) setLocationName(data.name);
        setMarkedFull(!!data?.marked_full);
      });
  }, [locationId]);

  const checkIn = async (v: WalkInValues): Promise<string | null> => {
    if (!locationId) return 'Pick a listing from My listings';
    const { data, error } = await supabase.rpc('start_walk_in', {
      p_location_id: locationId,
      p_vehicle_type: v.vehicleType,
      p_plate: v.plate,
      p_note: v.note || null,
      p_scheduled_end_at: v.endAt,
      p_started_at: v.startAt,
      p_rate_id: v.rateId,
    });
    setConflict(null);
    if (error) return error.message;
    if (data?.error === 'plate_active') {
      setConflict(plateConflict(data));
      return plateActiveMessage(data.plate);
    }
    if (data?.error) return walkInErrorMessage(data.error);
    const back = sessionReturnRoute(from, {
      locationId,
      checkedIn: v.plate.toUpperCase(),
      ...(new Date(v.startAt).getTime() > Date.now() ? { reserved: '1' } : {}),
    });
    if (from === 'availability') router.dismissTo(back);
    else router.replace(back);
    return null;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="checkin-ready">
      <View style={styles.header}>
        <Text style={styles.subtitle}>{locationName}</Text>
      </View>
      <View style={styles.form}>
        {locationId ? (
          <>
            {markedFull ? (
              <Text style={styles.fullWarning} testID="checkin-full-warning">
                This listing is marked FULL. You can still check this car in; drivers keep seeing it
                as Full until the Full switch is turned off.
              </Text>
            ) : null}
            <WalkInForm
              locationId={locationId}
              showNote
              submitLabel="Check In"
              reservationSubmitLabel="Save reservation"
              onSubmit={checkIn}
            />
            {conflict ? (
              <Button
                title={`Open session ${conflict.plate}`}
                variant="outline"
                style={styles.conflict}
                onPress={() =>
                  router.push({
                    pathname: '/staff/session',
                    params: { id: conflict.id, locationId, ...(from ? { from } : {}) },
                  })
                }
                testID="plate-conflict-open"
              />
            ) : null}
          </>
        ) : (
          <Text testID="checkin-error">Pick a listing from My listings</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fullWarning: {
    color: '#991b1b',
    backgroundColor: '#fee2e2',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.md,
    fontWeight: '600',
  },
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: theme.spacing.lg, backgroundColor: theme.colors.primary },
  subtitle: { ...theme.typography.body, color: '#fff', opacity: 0.9, marginTop: theme.spacing.xs },
  form: { padding: theme.spacing.lg },
  conflict: { marginTop: theme.spacing.md },
});
