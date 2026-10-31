import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { deliverReturnedPush } from '../../src/lib/push';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { WalkInForm, type WalkInValues } from '../../src/components/WalkInForm';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  balanceToSettle,
  paymentAmountError,
  walkInErrorMessage,
  type PaymentMethod,
} from '../../src/lib/walkIn';
import { VEHICLE_TYPE_LABELS, type VehicleType } from '../../src/lib/searchFilters';
import { formatLocalDateTime, formatPeso } from '../../src/utils/formatters';

// One active session (opened from Active Sessions): edit start, end, vehicle, plate
// and rate; see the amount due and balance; apply fees and payments; end it once the
// balance is settled (server-enforced).
export default function SessionScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const [d, setD] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [formKey, setFormKey] = React.useState(0);
  const router = useRouter();
  const scrollRef = React.useRef<ScrollView>(null);
  const [payY, setPayY] = React.useState(0);
  const [presets, setPresets] = React.useState<any[]>([]);
  const [payAmount, setPayAmount] = React.useState('');
  const [payMethod, setPayMethod] = React.useState<PaymentMethod>('cash');
  const [payNote, setPayNote] = React.useState('');
  const [payError, setPayError] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);
  const [endError, setEndError] = React.useState<{ text: string; balance: number } | null>(null);
  const [waiveNote, setWaiveNote] = React.useState('');
  const [ending, setEnding] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    const { data, error: e } = await supabase.rpc('session_details', { p_session_id: id });
    if (e || data?.error) {
      setError(e?.message || walkInErrorMessage(data?.error));
      return;
    }
    setError(null);
    setD(data);
    const { data: fp } = await supabase.from('fee_presets').select('*').eq('active', true);
    setPresets(
      (fp || []).filter((p: any) => !p.location_id || p.location_id === data.session.location_id)
    );
  }, [id]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const save = async (v: WalkInValues): Promise<string | null> => {
    setNotice(null);
    const { data, error: e } = await supabase.rpc('update_walk_in_session', {
      p_session_id: id,
      p_started_at: v.startAt,
      p_end_at: v.endAt,
      p_vehicle_type: v.vehicleType,
      p_plate: v.plate,
      p_rate_id: v.rateId,
    });
    if (e) return e.message;
    if (data?.error) return walkInErrorMessage(data.error);
    setNotice('Session saved');
    await load();
    setFormKey((k) => k + 1);
    return null;
  };

  const applyPreset = async (preset: any) => {
    setNotice(null);
    const { data, error: e } = await supabase.rpc('apply_fee_preset', {
      p_session_id: id,
      p_preset_id: preset.id,
    });
    if (e || data?.error) {
      setError(e?.message || walkInErrorMessage(data?.error));
      return;
    }
    setNotice(`Applied ${preset.name} ${formatPeso(data.amount)}`);
    await load();
    setFormKey((k) => k + 1);
  };

  const pay = async () => {
    setPayError(null);
    const bad = paymentAmountError(payAmount, Number(d.balance));
    if (bad) return setPayError(bad);
    setPaying(true);
    try {
      const { data, error: e } = await supabase.rpc('record_session_payment', {
        p_session_id: id,
        p_amount: Number(payAmount),
        p_method: payMethod,
        p_note: payNote.trim() || null,
      });
      if (e || data?.error) {
        setPayError(e?.message || walkInErrorMessage(data?.error));
        return;
      }
      setNotice(`Payment of ${formatPeso(Number(payAmount))} recorded`);
      setPayAmount('');
      setPayNote('');
      setEndError(null);
      await load();
    } finally {
      setPaying(false);
    }
  };

  // Shortcut from the 'settle first' message: prefill the balance and jump to Payments.
  const payBalance = (balance: number) => {
    setPayAmount(balance.toFixed(2));
    setPayError(null);
    scrollRef.current?.scrollTo({ y: payY, animated: true });
  };

  const end = async (withWaiver: boolean) => {
    setEndError(null);
    setEnding(true);
    try {
      const { data, error: e } = await supabase.rpc('end_session', {
        p_session_id: id,
        p_waive_note: withWaiver ? waiveNote.trim() || null : null,
      });
      if (e) return setEndError({ text: e.message, balance: 0 });
      if (data?.error) {
        const bal = balanceToSettle(data.balance);
        setEndError({ text: walkInErrorMessage(data.error, data.balance), balance: bal });
        await load();
        return;
      }
      // Push is best-effort: never let it block leaving the page.
      deliverReturnedPush(data, 'Session ended', 'A walk-in session was closed').catch(() => {});
      // Back to the Active Sessions screen already in the stack (or open it), not a
      // second copy on top.
      router.dismissTo({
        pathname: '/staff/sessions',
        params: { locationId: d.session.location_id, ended: d.session.plate },
      });
    } finally {
      setEnding(false);
    }
  };

  if (!d) {
    return (
      <View style={[styles.container, styles.centered]} testID="session-loading">
        {error ? (
          <Text style={styles.error} testID="session-error">
            {error}
          </Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const s = d.session;
  const ended = s.status === 'ended';
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="session-ready"
    >
      <View style={styles.header}>
        <Text style={styles.plate} testID="session-plate">
          {s.plate}
        </Text>
        <Text style={styles.headerMeta}>
          {VEHICLE_TYPE_LABELS[s.vehicle_type as VehicleType] || s.vehicle_type} · {s.location_name}{' '}
          ·{' '}
          {s.status === 'overdue'
            ? 'Overdue'
            : ended
              ? `Ended ${formatLocalDateTime(s.ended_at)}`
              : 'Active'}
        </Text>
      </View>

      <View style={styles.section} testID="session-balance-box">
        <Text style={styles.row}>
          Parking: {formatPeso(d.parking)}
          {d.price?.rate_name ? ` · ${d.price.rate_name}` : ''}
        </Text>
        <Text style={styles.meta}>
          {d.price?.until_now
            ? `Up to now (${formatLocalDateTime(d.price.until)})`
            : `To ${formatLocalDateTime(d.price?.until)}`}
        </Text>
        {Number(d.extra_fees) ? (
          <Text style={styles.row} testID="session-extra">
            Extra fees: {formatPeso(d.extra_fees)}
          </Text>
        ) : null}
        <Text style={styles.row} testID="session-paid">
          Paid: {formatPeso(d.paid)}
        </Text>
        {Number(d.waived) > 0 ? (
          <Text style={styles.waived} testID="session-waived">
            Waived: {formatPeso(d.waived)}
          </Text>
        ) : null}
        <Text style={styles.balance} testID="session-balance">
          Balance: {formatPeso(d.balance)}
        </Text>
      </View>

      {!ended ? (
        <View style={styles.section}>
          <Text style={styles.heading}>Edit session</Text>
          <WalkInForm
            key={formKey}
            locationId={s.location_id}
            initial={{
              vehicleType: s.vehicle_type,
              plate: s.plate,
              startAt: s.started_at,
              endAt: s.end_at,
              rateId: s.rate_id,
            }}
            submitLabel="Save changes"
            onSubmit={save}
          />
          {notice ? (
            <Text style={styles.notice} testID="session-notice">
              {notice}
            </Text>
          ) : null}
        </View>
      ) : null}
      {!ended && presets.length ? (
        <View style={styles.section}>
          <Text style={styles.heading}>Extra fees</Text>
          {d.charges.map((c: any) => (
            <Text key={c.id} style={styles.row}>
              {c.description}: {formatPeso(c.amount)}
            </Text>
          ))}
          <View style={styles.chips}>
            {presets.map((p) => (
              <Button
                key={p.id}
                title={`Apply ${p.name} ${formatPeso(p.amount)}`}
                size="small"
                variant="outline"
                onPress={() => applyPreset(p)}
                testID={`session-fee-${p.name}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View
        style={styles.section}
        onLayout={(e) => setPayY(e.nativeEvent.layout.y)}
        testID="session-payments"
      >
        <Text style={styles.heading}>Payments</Text>
        {d.payments.length ? (
          d.payments.map((p: any, i: number) => (
            <Text key={p.id} style={styles.row} testID={`payment-row-${i}`}>
              {p.direction === 'refund' ? '−' : ''}
              {formatPeso(p.amount)} ·{' '}
              {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] || p.method} ·{' '}
              {formatLocalDateTime(p.received_at)} · {p.recorded_by}
              {p.note ? ` · ${p.note}` : ''}
            </Text>
          ))
        ) : (
          <Text style={styles.meta}>No payments yet</Text>
        )}
        {!ended ? (
          <>
            <Text style={styles.label}>Amount (₱)</Text>
            <TextInput
              style={styles.input}
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="decimal-pad"
              placeholder={balanceToSettle(d.balance) ? Number(d.balance).toFixed(2) : '0.00'}
              testID="pay-amount"
            />
            <View style={styles.chips}>
              {PAYMENT_METHODS.map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setPayMethod(m)}
                  style={[styles.chip, payMethod === m && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: payMethod === m }}
                  testID={`pay-method-${m}`}
                >
                  <Text style={[styles.chipText, payMethod === m && styles.chipTextOn]}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginTop: theme.spacing.sm }]}
              value={payNote}
              onChangeText={setPayNote}
              placeholder="Note (optional), e.g. GCash ref"
              testID="pay-note"
            />
            {payError ? (
              <Text style={styles.error} testID="pay-error">
                {payError}
              </Text>
            ) : null}
            <Button
              title="Apply payment"
              onPress={pay}
              loading={paying}
              testID="pay-submit"
              style={{ marginTop: theme.spacing.sm }}
            />
          </>
        ) : null}
      </View>

      {!ended ? (
        <View style={styles.section} testID="session-end-box">
          <Text style={styles.heading}>End session</Text>
          <Text style={styles.meta}>
            The amount is worked out at the end time, or now if there is no end. Any balance must be
            settled first.
          </Text>
          {endError ? (
            <View testID="end-blocked">
              <Text style={styles.error}>{endError.text}</Text>
              {endError.balance > 0 ? (
                <Button
                  title={`Apply payment of ${formatPeso(endError.balance)}`}
                  size="small"
                  onPress={() => payBalance(endError.balance)}
                  testID="end-pay-shortcut"
                />
              ) : null}
              {endError.balance > 0 && d.can_waive ? (
                <>
                  <TextInput
                    style={[styles.input, { marginTop: theme.spacing.sm }]}
                    value={waiveNote}
                    onChangeText={setWaiveNote}
                    placeholder="Or waive it: reason"
                    testID="waive-note"
                  />
                  <Button
                    title="Waive balance and end"
                    size="small"
                    variant="outline"
                    onPress={() => end(true)}
                    disabled={!waiveNote.trim()}
                    testID="waive-end"
                    style={{ marginTop: theme.spacing.sm }}
                  />
                </>
              ) : null}
            </View>
          ) : null}
          <Button
            title="End session"
            variant="danger"
            onPress={() => end(false)}
            loading={ending}
            testID="session-end"
            style={{ marginTop: theme.spacing.sm }}
          />
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="session-error">
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  header: { padding: theme.spacing.lg, backgroundColor: theme.colors.primary },
  plate: { ...theme.typography.h2, color: '#fff' },
  headerMeta: { ...theme.typography.body, color: '#fff', opacity: 0.9 },
  section: {
    margin: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
  },
  heading: { ...theme.typography.h3 },
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
  row: { ...theme.typography.body, marginTop: 4 },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 2 },
  waived: {
    ...theme.typography.body,
    color: theme.colors.warning,
    fontWeight: '700',
    marginTop: 4,
  },
  balance: { ...theme.typography.h3, color: theme.colors.primary, marginTop: theme.spacing.sm },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.sm },
  error: { ...theme.typography.body, color: theme.colors.danger, margin: theme.spacing.md },
});
