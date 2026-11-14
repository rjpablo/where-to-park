import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
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
import { formatPeso } from '../../src/utils/formatters';
import { canEditSession, presetsForLocation, walkInErrorMessage } from '../../src/lib/walkIn';

// Add fee (rj t132u): pick one of the listing's extra fees (e.g. Overnight, Lost ticket) on
// its own screen. Saving returns to the Session page, which reloads and shows a banner.
export default function SessionFeeScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const sp = useLocalSearchParams<{
    id?: string | string[];
    locationId?: string | string[];
    from?: string | string[];
  }>();
  const id = firstParam(sp.id);
  const from = firstParam(sp.from);
  const [s, setS] = React.useState<any>(null);
  const [presets, setPresets] = React.useState<any[]>([]);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [customName, setCustomName] = React.useState('');
  const [customAmount, setCustomAmount] = React.useState('');
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!id) return;
    (async () => {
      const { data, error: e } = await supabase.rpc('session_details', { p_session_id: id });
      if (e || data?.error) {
        setLoadError(e?.message || walkInErrorMessage(data?.error));
        return;
      }
      const { data: fp } = await supabase
        .from('fee_presets')
        .select('*')
        .eq('active', true)
        .order('name');
      const list = presetsForLocation(fp, data.session.location_id);
      setPresets(list);
      if (list.length === 1) setPicked(list[0].id);
      setS(data.session);
    })();
  }, [id]);

  const addCustom = async () => {
    const name = customName.trim();
    const amount = Number(customAmount);
    if (!name) return setError('Enter a name for this fee.');
    if (!customAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      return setError('Enter an amount more than ₱0');
    }
    setError(null);
    setSaving(true);
    try {
      const { data, error: e } = await supabase.rpc('add_session_fee', {
        p_session_id: id,
        p_description: name,
        p_amount: amount,
      });
      if (e || data?.error) {
        setError(e?.message || walkInErrorMessage(data?.error));
        return;
      }
      router.dismissTo({
        pathname: '/staff/session',
        params: {
          id: id!,
          locationId: s.location_id,
          ...(from ? { from } : {}),
          notice: `Added ${name} ${formatPeso(data.amount)}`,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const customFields = (
    <View testID="fee-custom">
      <Text style={styles.label}>Custom fee</Text>
      <TextInput
        style={styles.input}
        value={customName}
        onChangeText={setCustomName}
        placeholder="Name, e.g. Overnight"
        testID="fee-custom-name"
      />
      <TextInput
        style={styles.input}
        value={customAmount}
        onChangeText={setCustomAmount}
        placeholder="Amount"
        keyboardType="decimal-pad"
        testID="fee-custom-amount"
      />
      <Button
        title="Add custom fee"
        variant="outline"
        onPress={addCustom}
        loading={saving}
        testID="fee-custom-submit"
        style={{ marginTop: theme.spacing.md }}
      />
    </View>
  );

  const add = async () => {
    const preset = presets.find((p) => p.id === picked);
    if (!preset) return setError('Pick a fee');
    setError(null);
    setSaving(true);
    try {
      const { data, error: e } = await supabase.rpc('apply_fee_preset', {
        p_session_id: id,
        p_preset_id: preset.id,
      });
      if (e || data?.error) {
        setError(e?.message || walkInErrorMessage(data?.error));
        return;
      }
      router.dismissTo({
        pathname: '/staff/session',
        params: {
          id: id!,
          locationId: s.location_id,
          ...(from ? { from } : {}),
          notice: `Added ${preset.name} ${formatPeso(data.amount)}`,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  if (!s) {
    return (
      <View style={[styles.container, styles.centered]} testID="session-fee-loading">
        {loadError ? (
          <Text style={styles.error} testID="session-fee-error">
            {loadError}
          </Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, bottomInset]}
      testID="session-fee-ready"
    >
      <Text style={styles.title}>
        {s.plate} · {s.location_name}
      </Text>
      {!canEditSession(s) ? (
        <Text style={styles.meta} testID="session-fee-closed">
          This session has ended, so fees can no longer be added.
        </Text>
      ) : s.reservation && s.approval_status === 'pending' ? (
        <Text style={styles.meta} testID="session-fee-closed">
          Approve the reservation before adding a fee.
        </Text>
      ) : (
        <>
          {presets.length === 0 ? (
            <Text style={styles.meta} testID="session-fee-none">
              No saved fees for this listing. Add a custom fee below, or set some up under Fees.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Saved fee</Text>
              {presets.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setPicked(p.id)}
                  style={[styles.option, picked === p.id && styles.optionOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked === p.id }}
                  testID={`fee-option-${p.name}`}
                >
                  <Text style={[styles.optionText, picked === p.id && styles.optionTextOn]}>
                    {p.name}
                  </Text>
                  <Text style={[styles.optionText, picked === p.id && styles.optionTextOn]}>
                    {formatPeso(p.amount)}
                  </Text>
                </TouchableOpacity>
              ))}
              <Button
                title="Add fee"
                onPress={add}
                loading={saving}
                disabled={!picked}
                testID="fee-submit"
                style={{ marginTop: theme.spacing.md }}
              />
            </>
          )}
          {error ? (
            <Text style={styles.error} testID="fee-error">
              {error}
            </Text>
          ) : null}
          {customFields}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  title: { ...theme.typography.h3 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    ...theme.typography.body,
  },
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    marginTop: theme.spacing.md,
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.sm,
  },
  optionOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  optionText: { ...theme.typography.body },
  optionTextOn: { color: '#fff', fontWeight: '600' },
  meta: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.md,
  },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.sm },
});
