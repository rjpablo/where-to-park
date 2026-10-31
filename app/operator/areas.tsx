import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';

// A listing's areas (its own page; rates are on /operator/rates).
export default function AreasScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const locationId = firstParam(
    useLocalSearchParams<{ locationId?: string | string[] }>().locationId
  );
  const [areas, setAreas] = React.useState<any[]>([]);
  const [areaName, setAreaName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [locationName, setLocationName] = React.useState('Listing');

  const load = React.useCallback(async () => {
    setError(null);
    if (!locationId) {
      setError('Pick a listing from My listings');
      setLoading(false);
      return;
    }
    try {
      const [{ data: areaRows, error: areaErr }, loc] = await Promise.all([
        supabase.from('areas').select('*').eq('location_id', locationId).order('sort_order'),
        supabase.from('locations').select('name').eq('id', locationId).single(),
      ]);
      if (loc.data?.name) setLocationName(loc.data.name);
      if (areaErr) throw areaErr;
      setAreas(areaRows || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load areas');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const addArea = async () => {
    if (!areaName.trim()) return;
    const { data, error: rpcError } = await supabase.rpc('upsert_area', {
      p_location_id: locationId,
      p_name: areaName.trim(),
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setAreaName('');
    setNotice(`Area saved`);
    await load();
  };

  const removeArea = async (id: string) => {
    const { data, error: rpcError } = await supabase.rpc('delete_area', { p_area_id: id });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    await load();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="areas-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="areas-ready">
      <Text style={styles.subtitle}>{locationName}</Text>

      {areas.map((area) => (
        <View key={area.id} style={styles.row}>
          <Text style={styles.rowTitle}>{area.name}</Text>
          <Button
            title="Delete"
            size="small"
            variant="outline"
            onPress={() => removeArea(area.id)}
          />
        </View>
      ))}
      <TextInput
        style={styles.input}
        value={areaName}
        onChangeText={setAreaName}
        placeholder="New area name"
        testID="area-name"
      />
      <Button title="Add area" onPress={addArea} testID="area-add" />

      {error ? (
        <Text style={styles.error} testID="areas-error">
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text style={styles.notice} testID="areas-notice">
          {notice}
        </Text>
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
  centered: { justifyContent: 'center', alignItems: 'center' },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  rowTitle: { ...theme.typography.body, fontWeight: '600', flex: 1 },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.md },
});
