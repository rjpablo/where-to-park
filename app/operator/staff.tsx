import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Switch } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { WorkspaceNav } from '../../src/components/WorkspaceNav';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';

export default function StaffScreen() {
  const params = useLocalSearchParams<{
    operatorId?: string | string[];
    locationId?: string | string[];
  }>();
  const operatorId = firstParam(params.operatorId);
  const locationId = firstParam(params.locationId);
  const [members, setMembers] = React.useState<any[]>([]);
  const [canWaive, setCanWaive] = React.useState(true);
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [operatorName, setOperatorName] = React.useState('Operator');

  const load = React.useCallback(async () => {
    setError(null);
    if (!operatorId) {
      setError('Pick a listing from My listings');
      setLoading(false);
      return;
    }
    try {
      const [{ data: ops, error: opErr }, { data: rows, error: memErr }] = await Promise.all([
        supabase
          .from('operators')
          .select('staff_can_waive, display_name')
          .eq('id', operatorId)
          .single(),
        supabase
          .from('operator_members')
          .select('id, role, profile_id, profiles(display_name, phone)')
          .eq('operator_id', operatorId),
      ]);
      if (opErr) throw opErr;
      if (memErr) throw memErr;
      setCanWaive(!!ops?.staff_can_waive);
      if (ops?.display_name) setOperatorName(ops.display_name);
      setMembers(rows || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const invite = async () => {
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('invite_staff', {
      p_operator_id: operatorId,
      p_email: email.trim() || null,
      p_phone: phone.trim() || null,
      p_role: 'staff',
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setEmail('');
    setPhone('');
    setNotice('Staff invited');
    await load();
  };

  const remove = async (member: any) => {
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('remove_staff', {
      p_operator_id: operatorId,
      p_member_id: member.id,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setNotice('Staff removed');
    await load();
  };

  const toggleWaive = async (value: boolean) => {
    setCanWaive(value);
    const { data, error: rpcError } = await supabase.rpc('set_staff_can_waive', {
      p_operator_id: operatorId,
      p_enabled: value,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      setCanWaive(!value);
      return;
    }
    setNotice(value ? 'Staff may waive balances' : 'Waivers restricted to operator');
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="staff-loading">
        <WorkspaceNav listingId={locationId} />
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} testID="staff-ready">
      <WorkspaceNav listingId={locationId} />
      <Text style={styles.subtitle}>{operatorName}</Text>

      <View style={styles.toggleRow} testID="staff-can-waive-row">
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Staff can waive</Text>
          <Text style={styles.meta}>
            When off, only owners and managers may waive a remaining balance.
          </Text>
        </View>
        <Switch value={canWaive} onValueChange={toggleWaive} testID="staff-can-waive" />
      </View>
      <Text style={styles.waiveState} testID="staff-can-waive-state">
        {canWaive ? 'Staff allowed to waive' : 'Operator-only waivers'}
      </Text>

      <Text style={styles.heading}>Members</Text>
      {members.map((member) => (
        <View key={member.id} style={styles.card} testID={`staff-row-${member.role}`}>
          <Text style={styles.rowTitle}>{member.profiles?.display_name || member.profile_id}</Text>
          <Text style={styles.meta}>
            {member.role}
            {member.profiles?.phone ? ` · ${member.profiles.phone}` : ''}
          </Text>
          {member.role !== 'owner' ? (
            <Button title="Remove" size="small" variant="danger" onPress={() => remove(member)} />
          ) : (
            <Text style={styles.meta}>Owner</Text>
          )}
        </View>
      ))}

      <Text style={styles.heading}>Invite by email or phone</Text>
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="staff@wheretopark.local"
        testID="staff-email"
      />
      <Text style={styles.label}>Phone</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+63918…"
        testID="staff-phone"
      />
      <Button title="Invite staff" onPress={invite} testID="staff-invite" />

      {error ? (
        <Text style={styles.error} testID="staff-error">
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text style={styles.notice} testID="staff-notice">
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  rowTitle: { ...theme.typography.body, fontWeight: '600' },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
  },
  waiveState: {
    ...theme.typography.body,
    fontWeight: '600',
    marginTop: theme.spacing.sm,
    color: theme.colors.primary,
  },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.md },
});
