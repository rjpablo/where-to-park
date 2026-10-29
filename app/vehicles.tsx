import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Button } from '../src/components/Button';
import { supabase } from '../src/lib/supabase';
import { useAuthStore } from '../src/stores/authStore';
import { theme } from '../src/lib/theme';

const TYPES = ['car', 'suv', 'van', 'motorcycle', 'truck'] as const;

export default function VehiclesScreen() {
  const { user, initialize } = useAuthStore();
  const [vehicles, setVehicles] = React.useState<any[]>([]);
  const [nickname, setNickname] = React.useState('My car');
  const [plate, setPlate] = React.useState('');
  const [type, setType] = React.useState<(typeof TYPES)[number]>('car');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('vehicles')
      .select('*')
      .order('is_default', { ascending: false });
    if (fetchError) setError(fetchError.message);
    setVehicles(data || []);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    initialize();
    load();
  }, [initialize, load]);

  const save = async () => {
    const { data, error: rpcError } = await supabase.rpc('upsert_vehicle', {
      p_nickname: nickname.trim(),
      p_vehicle_type: type,
      p_plate: plate.trim() || null,
      p_is_default: vehicles.length === 0,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    await load();
  };

  const makeDefault = async (id: string) => {
    await supabase.rpc('set_default_vehicle', { p_vehicle_id: id });
    await load();
  };

  if (loading) {
    return (
      <View style={styles.container} testID="vehicles-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="vehicles-ready">
      <Text style={styles.title}>Saved vehicles</Text>
      <Text style={styles.meta}>
        {user ? `Signed in as ${user.display_name}` : 'Sign in to save vehicles'}
      </Text>

      {vehicles.map((v) => (
        <View key={v.id} style={styles.card} testID={`vehicle-row-${v.nickname}`}>
          <Text style={styles.rowTitle}>
            {v.nickname} {v.is_default ? '(default)' : ''}
          </Text>
          <Text style={styles.meta}>
            {v.vehicle_type}
            {v.plate ? ` · ${v.plate}` : ''}
          </Text>
          {!v.is_default ? (
            <Button title="Make default" size="small" onPress={() => makeDefault(v.id)} />
          ) : null}
        </View>
      ))}

      <Text style={styles.heading}>Add vehicle</Text>
      <TextInput style={styles.input} value={nickname} onChangeText={setNickname} testID="vehicle-nickname" />
      <TextInput
        style={styles.input}
        value={plate}
        onChangeText={setPlate}
        placeholder="Plate"
        testID="vehicle-plate"
      />
      <View style={styles.row}>
        {TYPES.map((t) => (
          <Button
            key={t}
            title={t}
            size="small"
            variant={type === t ? 'primary' : 'outline'}
            onPress={() => setType(t)}
          />
        ))}
      </View>
      <Button title="Save vehicle" onPress={save} testID="vehicle-save" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  title: { ...theme.typography.h2 },
  heading: { ...theme.typography.h3, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginBottom: theme.spacing.sm },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  rowTitle: { ...theme.typography.body, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  error: { color: theme.colors.danger, marginTop: theme.spacing.md },
});
