import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Switch,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { Avatar } from '../../src/components/Avatar';
import {
  formatCountdown,
  inviteErrorMessage,
  lastSentFromCooldown,
  resendSecondsLeft,
} from '../../src/lib/staffInvite';

export default function StaffScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const params = useLocalSearchParams<{
    operatorId?: string | string[];
    locationId?: string | string[];
  }>();
  const operatorId = firstParam(params.operatorId);
  const [members, setMembers] = React.useState<any[]>([]);
  const [canWaive, setCanWaive] = React.useState(true);
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [operatorName, setOperatorName] = React.useState('Operator');
  // Last invite sent (rj t181u): same answer whether or not the account exists.
  const [sent, setSent] = React.useState<{
    email: string | null;
    phone: string | null;
    label: string;
    at: number;
  } | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const [sending, setSending] = React.useState(false);
  const secondsLeft = resendSecondsLeft(sent?.at ?? null, now);
  React.useEffect(() => {
    if (!sent) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent]);

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
          .select('id, role, profile_id, profiles(display_name, phone, avatar_url)')
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

  const sendInvite = async (target: { email: string | null; phone: string | null }) => {
    setError(null);
    setNotice(null);
    setSending(true);
    const { data, error: rpcError } = await supabase.rpc('invite_staff', {
      p_operator_id: operatorId,
      p_email: target.email,
      p_phone: target.phone,
      p_role: 'staff',
    });
    setSending(false);
    const label = target.email || target.phone || '';
    if (data?.error === 'cooldown') {
      // Server-side 3-minute limit (e.g. sent from another device): show its countdown.
      setSent({
        ...target,
        label,
        at: lastSentFromCooldown(Number(data.retry_after_seconds) || 180, Date.now()),
      });
      setNow(Date.now());
      setError(inviteErrorMessage('cooldown'));
      return;
    }
    if (rpcError || data?.error) {
      setError(rpcError ? rpcError.message : inviteErrorMessage(String(data?.error)));
      return;
    }
    setSent({ ...target, label: data?.sent_to || label, at: Date.now() });
    setNow(Date.now());
    setHelpOpen(false);
    setEmail('');
    setPhone('');
    await load();
  };

  const invite = () =>
    sendInvite({ email: email.trim() || null, phone: email.trim() ? null : phone.trim() || null });

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
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="staff-ready">
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
          <View style={styles.memberRow}>
            <Avatar
              url={member.profiles?.avatar_url}
              size={36}
              name={member.profiles?.display_name}
              testID={`staff-avatar-${member.profile_id}`}
            />
            <Text style={styles.rowTitle}>
              {member.profiles?.display_name || member.profile_id}
            </Text>
          </View>
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
      <Text style={styles.meta}>
        They join the team after they accept the invite in their notifications.
      </Text>
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
      <Button
        title={sending ? 'Sending…' : 'Invite staff'}
        onPress={invite}
        disabled={sending}
        testID="staff-invite"
      />

      {sent ? (
        <View style={styles.sentBox} testID="staff-invite-sent">
          <Text style={styles.sentText}>Invite sent to {sent.label}</Text>
          <TouchableOpacity
            onPress={() => setHelpOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: helpOpen }}
            testID="staff-invite-help-toggle"
          >
            <Text style={styles.link}>Didn't receive the invite?</Text>
          </TouchableOpacity>
          {helpOpen ? (
            <View style={styles.helpBox} testID="staff-invite-help">
              <Text style={styles.meta}>
                Make sure {sent.label} is the email they use to sign in to Where To Park, or wait a
                few minutes. They'll find the invite in their notifications. You can send it again 3
                minutes after the last one.
              </Text>
              <Button
                title={
                  secondsLeft > 0
                    ? `Resend invite in ${formatCountdown(secondsLeft)}`
                    : sending
                      ? 'Sending…'
                      : 'Resend invite'
                }
                size="small"
                variant="outline"
                disabled={secondsLeft > 0 || sending}
                onPress={() => sendInvite({ email: sent.email, phone: sent.phone })}
                testID="staff-invite-resend"
              />
            </View>
          ) : null}
        </View>
      ) : null}

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
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
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
  sentBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    gap: theme.spacing.sm,
  },
  sentText: { ...theme.typography.body, color: theme.colors.success, fontWeight: '600' },
  link: { ...theme.typography.body, color: theme.colors.primary, fontWeight: '600' },
  helpBox: { gap: theme.spacing.sm },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.md },
});
