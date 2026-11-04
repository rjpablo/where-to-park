import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { AREA_SELECT, areaErrorMessage, type Area } from '../../src/lib/areas';
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, type VehicleType } from '../../src/lib/searchFilters';

// Area settings (rj t139u): name (Main can't be renamed), whether the area's available
// spots are monitored, total spots (only when monitored) and the vehicle types it takes.
// Owners/managers only (server-enforced).
export default function AreaEditScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const sp = useLocalSearchParams<{ locationId?: string | string[]; areaId?: string | string[] }>();
  const locationId = firstParam(sp.locationId);
  const areaId = firstParam(sp.areaId);
  const [area, setArea] = React.useState<Area | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [monitored, setMonitored] = React.useState(true);
  const [capacity, setCapacity] = React.useState('');
  // Empty = every vehicle type.
  const [types, setTypes] = React.useState<VehicleType[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!areaId) return;
    supabase
      .from('areas')
      .select(AREA_SELECT)
      .eq('id', areaId)
      .single()
      .then(({ data, error: e }) => {
        if (e || !data) return setLoadError(e?.message || 'Area not found');
        const a = data as unknown as Area;
        setArea(a);
        setName(a.name);
        setMonitored(a.monitored);
        setCapacity(String(a.capacity ?? 0));
        const t = (a.vehicle_types || []) as VehicleType[];
        setTypes(t.length >= VEHICLE_TYPES.length ? [] : t);
      });
  }, [areaId]);

  if (!area) {
    return (
      <View style={[styles.container, styles.centered]} testID="area-edit-loading">
        {loadError ? <Text style={styles.error}>{loadError}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const toggleType = (t: VehicleType) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const save = async () => {
    setError(null);
    const cap = monitored ? Number(capacity) : null;
    if (monitored && (!/^\d+$/.test(capacity.trim()) || !Number.isFinite(cap))) {
      return setError(areaErrorMessage('capacity_invalid'));
    }
    if (!name.trim()) return setError(areaErrorMessage('name_required'));
    setSaving(true);
    try {
      if (!area.is_main && name.trim() !== area.name) {
        const { data, error: e } = await supabase.rpc('upsert_area', {
          p_location_id: locationId || area.location_id,
          p_name: name.trim(),
          p_area_id: area.id,
        });
        if (e || data?.error) return setError(e?.message || areaErrorMessage(data?.error));
      }
      const { data, error: e } = await supabase.rpc('set_area_settings', {
        p_area_id: area.id,
        p_capacity: cap,
        p_vehicle_types: types.length ? types : null,
        p_monitored: monitored,
      });
      if (e || data?.error) return setError(e?.message || areaErrorMessage(data?.error, data));
      router.dismissTo({
        pathname: '/operator/areas',
        params: { locationId: locationId || area.location_id!, saved: name.trim() },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, bottomInset]}
      keyboardShouldPersistTaps="handled"
      testID="area-edit-ready"
    >
      <Text style={styles.label}>Area name</Text>
      <TextInput
        style={[styles.input, area.is_main && styles.inputLocked]}
        value={name}
        onChangeText={setName}
        editable={!area.is_main}
        testID="area-edit-name"
      />
      {area.is_main ? (
        <Text style={styles.meta} testID="area-edit-main-note">
          Main is this listing&apos;s default area. It can&apos;t be renamed or deleted.
        </Text>
      ) : null}

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Monitor available spots</Text>
          <Text style={styles.meta}>
            {monitored
              ? 'Sessions count against the total spots; drivers see the number free.'
              : 'Sessions are still recorded, but no spot count is shown. Staff switch the area between Available and Full.'}
          </Text>
        </View>
        <Switch
          value={monitored}
          onValueChange={setMonitored}
          accessibilityLabel="Monitor available spots"
          testID="area-edit-monitored"
        />
      </View>

      {monitored ? (
        <>
          <Text style={styles.label}>Total spots</Text>
          <TextInput
            style={styles.input}
            value={capacity}
            onChangeText={setCapacity}
            keyboardType="number-pad"
            testID="area-edit-capacity"
          />
        </>
      ) : null}

      <Text style={styles.label}>Vehicle types</Text>
      <Text style={styles.meta}>
        {types.length ? 'Only these types can park here.' : 'All vehicle types (none picked).'}
      </Text>
      <View style={styles.chips}>
        {VEHICLE_TYPES.map((t) => {
          const on = types.includes(t);
          return (
            <TouchableOpacity
              key={t}
              onPress={() => toggleType(t)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              testID={`area-edit-vehicle-${t}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {VEHICLE_TYPE_LABELS[t]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? (
        <Text style={styles.error} testID="area-edit-error">
          {error}
        </Text>
      ) : null}
      <Button
        title="Save"
        onPress={save}
        loading={saving}
        testID="area-edit-save"
        style={{ marginTop: theme.spacing.lg }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  label: { ...theme.typography.body, fontWeight: '600', marginTop: theme.spacing.md },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    marginTop: theme.spacing.xs,
  },
  inputLocked: { color: theme.colors.text.secondary, backgroundColor: theme.colors.surfaceDark },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  switchLabel: { ...theme.typography.body, fontWeight: '600' },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.bodySmall, color: theme.colors.text.primary },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
});
