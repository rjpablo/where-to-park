import React from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from './Button';
import { overnightError, overnightTimeText } from '../lib/overnight';
import { canManageListings, loadMyMemberships, roleForLocation } from '../lib/operatorAccess';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { formatPeso } from '../utils/formatters';

type Policy = {
  overnight_enabled?: boolean | null;
  overnight_start?: string | null;
  overnight_end?: string | null;
  overnight_amount?: number | string | null;
} | null;

const SAVE_ERRORS: Record<string, string> = {
  overnight_start_required: 'Enter the overnight start as HH:MM.',
  overnight_end_required: 'Enter the overnight end as HH:MM.',
  overnight_times: 'Overnight start and end have to be different.',
  overnight_amount_required: 'Enter an overnight price greater than 0.',
  not_authenticated: 'Sign in to change this listing.',
  'Permission denied': "You don't have access to change this listing.",
};

/**
 * Listing overnight window. Owners and managers edit it. Everyone else sees the
 * window when it is on: those hours are the overnight fee, not the hourly rate.
 */
export function OvernightSetting({
  locationId,
  operatorId,
  policy,
  userId,
  onSaved,
}: {
  locationId: string;
  operatorId?: string | null;
  policy: Policy;
  userId?: string | null;
  onSaved?: () => void;
}) {
  const [canEdit, setCanEdit] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setEnabled(policy?.overnight_enabled === true);
    setStart(overnightTimeText(policy?.overnight_start));
    setEnd(overnightTimeText(policy?.overnight_end));
    setPrice(policy?.overnight_amount != null ? String(policy.overnight_amount) : '');
  }, [
    policy?.overnight_enabled,
    policy?.overnight_start,
    policy?.overnight_end,
    policy?.overnight_amount,
  ]);

  React.useEffect(() => {
    if (!userId || !operatorId) {
      setCanEdit(false);
      return;
    }
    let live = true;
    loadMyMemberships(userId)
      .then((rows) => {
        if (!live) return;
        const role = roleForLocation(rows, { id: locationId, operator_id: operatorId });
        setCanEdit(canManageListings(role ?? undefined));
      })
      .catch(() => {
        if (live) setCanEdit(false);
      });
    return () => {
      live = false;
    };
  }, [userId, operatorId, locationId]);

  const save = async (nextEnabled: boolean) => {
    const problem = overnightError(nextEnabled, start, end, price);
    if (problem) {
      setEnabled(policy?.overnight_enabled === true);
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('set_overnight', {
      p_location_id: locationId,
      p_enabled: nextEnabled,
      p_start: start.trim() || null,
      p_end: end.trim() || null,
      p_amount: price.trim() ? Number(price) : null,
    });
    setSaving(false);
    if (rpcError || data?.error) {
      setEnabled(policy?.overnight_enabled === true);
      setError(
        SAVE_ERRORS[String(data?.error)] || rpcError?.message || 'Could not save overnight.'
      );
      return;
    }
    onSaved?.();
  };

  if (!canEdit) {
    if (policy?.overnight_enabled !== true) return null;
    const amount = Number(policy.overnight_amount);
    const from = overnightTimeText(policy.overnight_start);
    const to = overnightTimeText(policy.overnight_end);
    if (!from || !to || !Number.isFinite(amount)) return null;
    return (
      <View style={styles.section} testID="overnight-note">
        <Text style={styles.title}>Overnight</Text>
        <Text style={styles.note}>
          {formatPeso(amount)} from {from} to {to}. Those hours use this fee instead of the hourly
          rate.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.section} testID="overnight-setting">
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Allow overnight</Text>
          <Text style={styles.note}>
            Hours inside this window are not charged per hour. One overnight fee is added for each
            night the stay covers.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(value) => {
            setEnabled(value);
            setError(null);
            if (!value) void save(false);
          }}
          disabled={saving}
          accessibilityLabel="Allow overnight"
          testID="overnight-toggle"
        />
      </View>
      {enabled ? (
        <>
          <Text style={styles.label}>Start</Text>
          <TextInput
            style={styles.input}
            value={start}
            onChangeText={setStart}
            placeholder="22:00"
            autoCapitalize="none"
            testID="overnight-start"
          />
          <Text style={styles.label}>End</Text>
          <TextInput
            style={styles.input}
            value={end}
            onChangeText={setEnd}
            placeholder="06:00"
            autoCapitalize="none"
            testID="overnight-end"
          />
          <Text style={styles.label}>Price</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            placeholder="200"
            keyboardType="decimal-pad"
            testID="overnight-price"
          />
          <Button
            title="Save overnight"
            onPress={() => save(true)}
            loading={saving}
            testID="overnight-save"
            style={{ marginTop: theme.spacing.md }}
          />
        </>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="overnight-error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: theme.spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  title: { ...theme.typography.body, fontWeight: '700', color: theme.colors.text.primary },
  note: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
  },
  label: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
    marginTop: theme.spacing.md,
    color: theme.colors.text.primary,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    ...theme.typography.body,
  },
  error: { ...theme.typography.bodySmall, color: theme.colors.danger, marginTop: theme.spacing.sm },
});
