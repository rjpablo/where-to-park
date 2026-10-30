import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { WorkspaceNav } from '../../src/components/WorkspaceNav';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { formatPeso } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

export default function FeePresetsScreen() {
  const params = useLocalSearchParams<{
    locationId?: string | string[];
    operatorId?: string | string[];
  }>();
  const locationId = firstParam(params.locationId);
  const [operatorId, setOperatorId] = React.useState(firstParam(params.operatorId) || '');
  const [presets, setPresets] = React.useState<any[]>([]);
  const [sessions, setSessions] = React.useState<any[]>([]);
  const [name, setName] = React.useState('Overnight parking');
  const [amount, setAmount] = React.useState('200');
  const [editingId, setEditingId] = React.useState<string | null>(null);
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
      let opId = operatorId;
      if (!opId) {
        const { data: loc } = await supabase
          .from('locations')
          .select('operator_id, name')
          .eq('id', locationId)
          .single();
        opId = loc?.operator_id || '';
        if (loc?.name) setLocationName(loc.name);
        setOperatorId(opId);
      } else {
        const { data: loc } = await supabase
          .from('locations')
          .select('name')
          .eq('id', locationId)
          .single();
        if (loc?.name) setLocationName(loc.name);
      }
      const [{ data: presetRows, error: pErr }, { data: sessionRows, error: sErr }] =
        await Promise.all([
          supabase.from('fee_presets').select('*').eq('operator_id', opId).order('name'),
          supabase
            .from('parking_sessions')
            .select('id, plate, status, folios(id, folio_charges(amount, type, description))')
            .eq('location_id', locationId)
            .in('status', ['active', 'overdue']),
        ]);
      if (pErr) throw pErr;
      if (sErr) throw sErr;
      setPresets(presetRows || []);
      setSessions(sessionRows || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load fee presets');
    } finally {
      setLoading(false);
    }
  }, [locationId, operatorId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('upsert_fee_preset', {
      p_operator_id: operatorId,
      p_name: name.trim(),
      p_amount: Number(amount),
      p_preset_id: editingId,
      p_location_id: locationId,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setNotice(editingId ? 'Preset updated' : 'Preset created');
    setEditingId(null);
    await load();
  };

  const remove = async (id: string) => {
    const { data, error: rpcError } = await supabase.rpc('delete_fee_preset', { p_preset_id: id });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setNotice('Preset deleted');
    await load();
  };

  const apply = async (sessionId: string, preset: any) => {
    const { data, error: rpcError } = await supabase.rpc('apply_fee_preset', {
      p_session_id: sessionId,
      p_preset_id: preset.id,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setNotice(`Applied ${preset.name} ${formatPeso(data.amount)}`);
    await load();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="fees-loading">
        <WorkspaceNav listingId={locationId} />
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="fees-ready">
      <WorkspaceNav listingId={locationId} />
      <Text style={styles.subtitle}>{locationName}</Text>

      {presets.map((preset) => (
        <View key={preset.id} style={styles.card} testID={`preset-row-${preset.name}`}>
          <Text style={styles.rowTitle}>
            {preset.name} · {formatPeso(preset.amount)}
          </Text>
          <View style={styles.row}>
            <Button
              title="Edit"
              size="small"
              variant="outline"
              onPress={() => {
                setEditingId(preset.id);
                setName(preset.name);
                setAmount(String(preset.amount));
              }}
            />
            <Button
              title="Delete"
              size="small"
              variant="danger"
              onPress={() => remove(preset.id)}
            />
          </View>
        </View>
      ))}

      <Text style={styles.heading}>{editingId ? 'Edit preset' : 'New preset'}</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} testID="preset-name" />
      <Text style={styles.label}>Amount (₱)</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        testID="preset-amount"
      />
      <Button
        title={editingId ? 'Save preset' : 'Create preset'}
        onPress={save}
        testID="preset-save"
      />

      <Text style={styles.heading}>Apply to a session ledger</Text>
      {sessions.length === 0 ? <Text style={styles.meta}>No active sessions</Text> : null}
      {sessions.map((session) => {
        const folio = Array.isArray(session.folios) ? session.folios[0] : session.folios;
        const charges = folio?.folio_charges || [];
        const total = charges.reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);
        return (
          <View key={session.id} style={styles.card} testID={`fee-session-${session.plate}`}>
            <Text style={styles.rowTitle}>{session.plate}</Text>
            <Text style={styles.meta}>Charges {formatPeso(total)}</Text>
            {presets.map((preset) => (
              <Button
                key={preset.id}
                title={`Apply ${preset.name} ${formatPeso(preset.amount)}`}
                size="small"
                onPress={() => apply(session.id, preset)}
                testID={`apply-${preset.name}-${session.plate}`}
                style={{ marginTop: theme.spacing.sm }}
              />
            ))}
          </View>
        );
      })}

      {error ? (
        <Text style={styles.error} testID="fees-error">
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text style={styles.notice} testID="fees-notice">
          {notice}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  centered: { justifyContent: 'center', alignItems: 'center' },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.lg,
  },
  heading: { ...theme.typography.h3, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  label: { ...theme.typography.bodySmall, fontWeight: '600', marginTop: theme.spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.sm,
  },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  row: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  rowTitle: { ...theme.typography.body, fontWeight: '600' },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
  },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.md },
});
