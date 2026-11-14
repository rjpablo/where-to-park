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
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  canApplyPayment,
  paymentAmountError,
  paymentPrefill,
  walkInErrorMessage,
  type PaymentMethod,
} from '../../src/lib/walkIn';

// Apply payment (rj t131u): amount (prefilled with the balance, or the amount asked for by
// 'Apply payment of ₱X'), method and note on their own screen. The amount can't be more than
// the balance. Saving returns to the Session page, which reloads.
export default function SessionPayScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const sp = useLocalSearchParams<{
    id?: string | string[];
    locationId?: string | string[];
    from?: string | string[];
    amount?: string | string[];
  }>();
  const id = firstParam(sp.id);
  const from = firstParam(sp.from);
  const requested = firstParam(sp.amount);
  const [d, setD] = React.useState<any>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);

  React.useEffect(() => {
    if (!id) return;
    supabase.rpc('session_details', { p_session_id: id }).then(({ data, error: e }) => {
      if (e || data?.error) {
        setLoadError(e?.message || walkInErrorMessage(data?.error));
        return;
      }
      setD(data);
      setAmount(paymentPrefill(requested, data.balance));
    });
  }, [id, requested]);

  const pay = async () => {
    setError(null);
    const bad = paymentAmountError(amount, Number(d.balance));
    if (bad) return setError(bad);
    setPaying(true);
    try {
      const { data, error: e } = await supabase.rpc('record_session_payment', {
        p_session_id: id,
        p_amount: Number(amount),
        p_method: method,
        p_note: note.trim() || null,
      });
      if (e || data?.error) {
        setError(e?.message || walkInErrorMessage(data?.error));
        return;
      }
      router.dismissTo({
        pathname: '/staff/session',
        params: {
          id: id!,
          locationId: d.session.location_id,
          ...(from ? { from } : {}),
          notice: `Payment of ${formatPeso(Number(amount))} recorded`,
        },
      });
    } finally {
      setPaying(false);
    }
  };

  if (!d) {
    return (
      <View style={[styles.container, styles.centered]} testID="session-pay-loading">
        {loadError ? (
          <Text style={styles.error} testID="session-pay-error">
            {loadError}
          </Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const s = d.session;
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, bottomInset]}
      keyboardShouldPersistTaps="handled"
      testID="session-pay-ready"
    >
      <Text style={styles.title}>
        {s.plate} · {s.location_name}
      </Text>
      <Text style={styles.balance} testID="session-pay-balance">
        Balance: {formatPeso(d.balance)}
      </Text>
      {canApplyPayment(s, d.balance) ? (
        <>
          <Text style={styles.label}>Amount (₱)</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder={Number(d.balance).toFixed(2)}
            testID="pay-amount"
          />
          <View style={styles.chips}>
            {PAYMENT_METHODS.map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => setMethod(m)}
                style={[styles.chip, method === m && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: method === m }}
                testID={`pay-method-${m}`}
              >
                <Text style={[styles.chipText, method === m && styles.chipTextOn]}>
                  {PAYMENT_METHOD_LABELS[m]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.input, { marginTop: theme.spacing.sm }]}
            value={note}
            onChangeText={setNote}
            placeholder="Note (optional), e.g. GCash ref"
            testID="pay-note"
          />
          {error ? (
            <Text style={styles.error} testID="pay-error">
              {error}
            </Text>
          ) : null}
          <Button
            title="Apply payment"
            onPress={pay}
            loading={paying}
            testID="pay-submit"
            style={{ marginTop: theme.spacing.md }}
          />
        </>
      ) : (
        <Text style={styles.meta} testID="session-pay-none">
          {s.approval_status === 'pending'
            ? 'Approve the reservation before applying a payment.'
            : s.status === 'ended'
              ? 'This session has ended.'
              : 'Nothing to pay: there is no balance.'}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  title: { ...theme.typography.h3 },
  balance: { ...theme.typography.h3, color: theme.colors.primary, marginTop: theme.spacing.sm },
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    marginTop: theme.spacing.md,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    backgroundColor: theme.colors.background,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.bodySmall },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  meta: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.md,
  },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.sm },
});
