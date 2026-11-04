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
      ) : presets.length === 0 ? (
        <Text style={styles.meta} testID="session-fee-none">
          No extra fees are set up for this listing yet. Owners and managers can add them under Fees
          on the listing page.
        </Text>
      ) : (
        <>
          <Text style={styles.label}>Fee</Text>
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
          {error ? (
            <Text style={styles.error} testID="fee-error">
              {error}
            </Text>
          ) : null}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  title: { ...theme.typography.h3 },
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
