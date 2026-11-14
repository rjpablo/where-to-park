import React from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { areaErrorMessage } from '../lib/areas';
import { parseListingCapacity } from '../lib/listingCapacity';

type MainArea = { id: string; vehicle_types: string[] | null };

/** Spot count for Main. The switch is the area's monitored flag.
 *  The capacity number is saved whether monitoring is on or off. */
export function TrackCapacityField({
  locationId,
  releaseTracking = 0,
}: {
  locationId: string;
  /** Increment after free parking is turned off, which turns tracking off. */
  releaseTracking?: number;
}) {
  const areaRef = React.useRef<MainArea | null>(null);
  const releaseSeen = React.useRef(0);
  const [ready, setReady] = React.useState(false);
  const [tracking, setTracking] = React.useState(false);
  const trackingRef = React.useRef(false);
  const showTracking = React.useCallback((on: boolean) => {
    trackingRef.current = on;
    setTracking(on);
  }, []);
  const [capacity, setCapacity] = React.useState('');
  const capacityRef = React.useRef('');
  capacityRef.current = capacity;
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('areas')
      .select('id, capacity, monitored, vehicle_types')
      .eq('location_id', locationId)
      .eq('is_main', true)
      .maybeSingle();
    if (loadError || !data) {
      setError(loadError?.message || 'Could not load capacity');
      setReady(true);
      return;
    }
    areaRef.current = { id: data.id, vehicle_types: data.vehicle_types };
    showTracking(data.monitored === true);
    setCapacity(data.capacity == null ? '' : String(data.capacity));
    setReady(true);
  }, [locationId, showTracking]);

  const savingRef = React.useRef(false);
  const persist = React.useCallback(
    async (track: boolean, raw: string) => {
      const area = areaRef.current;
      if (!area || savingRef.current) return;
      const parsed = parseListingCapacity(raw);
      if ('error' in parsed) {
        showTracking(true);
        setError(parsed.error);
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc('set_area_settings', {
          p_area_id: area.id,
          p_capacity: parsed.capacity,
          p_vehicle_types: area.vehicle_types,
          p_monitored: track,
        });
        if (rpcError || data?.error) {
          setError(rpcError?.message || areaErrorMessage(data?.error, data));
          return;
        }
        showTracking(track);
        setCapacity(String(parsed.capacity));
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [showTracking]
  );

  React.useEffect(() => {
    setReady(false);
    load();
  }, [load]);

  React.useEffect(() => {
    if (!ready || releaseTracking === releaseSeen.current) return;
    releaseSeen.current = releaseTracking;
    if (releaseTracking > 0) persist(false, capacityRef.current);
  }, [ready, releaseTracking, persist]);

  if (!ready) return null;

  return (
    <View>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Track capacity</Text>
          <Text style={styles.hint}>
            {tracking
              ? 'Drivers see how many spots are free.'
              : 'Spots are not counted. The number is kept.'}
          </Text>
        </View>
        <Switch
          value={tracking}
          onValueChange={(on) => {
            setError(null);
            showTracking(on);
            if (!on) persist(false, capacity);
            else if (!('error' in parseListingCapacity(capacity))) persist(true, capacity);
          }}
          disabled={saving || !areaRef.current}
          accessibilityLabel="Track capacity"
          testID="track-capacity"
        />
      </View>
      {tracking ? (
        <TextInput
          style={styles.input}
          value={capacity}
          onChangeText={setCapacity}
          onEndEditing={() => {
            if (trackingRef.current) persist(true, capacity);
          }}
          placeholder="10"
          keyboardType="number-pad"
          editable={!saving}
          testID="track-capacity-input"
        />
      ) : null}
      {error ? (
        <Text style={styles.error} testID="track-capacity-error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  switchLabel: { ...theme.typography.body, fontWeight: '600' },
  hint: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
  },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginBottom: theme.spacing.sm,
  },
});
