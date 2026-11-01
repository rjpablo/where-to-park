import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { freeSpaces, heldPreview, manualCountsError } from '../../src/lib/availability';

// Available slots editor (rj t137u): opened from the pencil beside the count on the
// Availability › Sessions tab. Edits the spaces held out of the free count (Reserved,
// Unavailable). Built as a list of sections so 'Total spaces' can be added later.
export default function SlotsEditorScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const sp = useLocalSearchParams<{ locationId?: string | string[] }>();
  const locationId = firstParam(sp.locationId);
  const [loc, setLoc] = React.useState<any>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reserved, setReserved] = React.useState(0);
  const [unavailable, setUnavailable] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!locationId) return;
    supabase
      .from('locations')
      .select('id, name, capacity, manual_reserved_count, unavailable_count, free_spaces')
      .eq('id', locationId)
      .single()
      .then(({ data, error: e }) => {
        if (e || !data) return setLoadError(e?.message || 'Listing not found');
        setLoc(data);
        setReserved(Number(data.manual_reserved_count || 0));
        setUnavailable(Number(data.unavailable_count || 0));
      });
  }, [locationId]);

  if (!loc) {
    return (
      <View style={[styles.container, styles.centered]} testID="slots-editor-loading">
        {loadError ? <Text style={styles.error}>{loadError}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const oldHeld = Number(loc.manual_reserved_count || 0) + Number(loc.unavailable_count || 0);
  const free = freeSpaces(loc);
  const preview = heldPreview(free, oldHeld, reserved + unavailable);
  const changed =
    reserved !== Number(loc.manual_reserved_count || 0) ||
    unavailable !== Number(loc.unavailable_count || 0);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const { data, error: e } = await supabase.rpc('set_manual_counts', {
        p_location_id: loc.id,
        p_reserved: reserved,
        p_unavailable: unavailable,
      });
      if (e || data?.error) {
        setError(e?.message || manualCountsError(data?.error));
        return;
      }
      router.dismissTo({
        pathname: '/operator/availability',
        params: { locationId: loc.id, slots: 'saved' },
      });
    } finally {
      setSaving(false);
    }
  };

  // Each section is one editable group; a 'Total spaces' section can be added to this list.
  const sections = [
    {
      key: 'held',
      title: 'Spaces held (not free)',
      hint: 'Reserved and unavailable spaces are taken off the free count.',
      rows: [
        { key: 'reserved', label: 'Reserved', value: reserved, set: setReserved },
        { key: 'unavailable', label: 'Unavailable', value: unavailable, set: setUnavailable },
      ],
    },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, bottomInset]}
      testID="slots-editor-ready"
    >
      <Text style={styles.title}>{loc.name}</Text>
      <Text style={styles.meta} testID="slots-editor-total">
        Total spaces: {loc.capacity}
      </Text>
      {sections.map((sec) => (
        <View key={sec.key} style={styles.section} testID={`slots-section-${sec.key}`}>
          <Text style={styles.sectionTitle}>{sec.title}</Text>
          <Text style={styles.meta}>{sec.hint}</Text>
          <View style={styles.rows}>
            {sec.rows.map((r) => (
              <View key={r.key} style={styles.item}>
                <Text style={styles.itemLabel}>{r.label}</Text>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => r.set(Math.max(0, r.value - 1))}
                    disabled={r.value <= 0}
                    accessibilityLabel={`${r.label} minus one`}
                    testID={`${r.key}-minus`}
                  >
                    <Text>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepperValue} testID={`${r.key}-value`}>
                    {r.value}
                  </Text>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => r.set(r.value + 1)}
                    accessibilityLabel={`${r.label} plus one`}
                    testID={`${r.key}-plus`}
                  >
                    <Text>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
      <Text style={styles.preview} testID="slots-editor-preview">
        Free after saving: {preview} / {loc.capacity}
      </Text>
      {error ? (
        <Text style={styles.error} testID="slots-editor-error">
          {error}
        </Text>
      ) : null}
      <Button
        title="Save"
        onPress={save}
        loading={saving}
        disabled={!changed}
        testID="slots-editor-save"
        style={{ marginTop: theme.spacing.md }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  title: { ...theme.typography.h3 },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 2 },
  section: { marginTop: theme.spacing.lg },
  sectionTitle: { ...theme.typography.body, fontWeight: '700' },
  rows: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm },
  item: {
    flex: 1,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
  },
  itemLabel: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: { ...theme.typography.h3 },
  preview: { ...theme.typography.body, fontWeight: '600', marginTop: theme.spacing.lg },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.sm },
});
