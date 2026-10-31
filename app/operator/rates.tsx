import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { formatLocalDate, formatPeso, fromDatetimeLocalValue } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
const RATE_TYPES = ['hourly', 'daily', 'flat_then_hourly', 'monthly'] as const;
type RateType = (typeof RATE_TYPES)[number];

function rateSummary(rate: any): string {
  switch (rate.rate_type) {
    case 'hourly':
      return `${formatPeso(rate.hourly_amount)}/h`;
    case 'daily':
      return `${formatPeso(rate.daily_amount)}/day`;
    case 'monthly':
      return `${formatPeso(rate.monthly_amount)}/mo`;
    case 'flat_then_hourly':
      return `${formatPeso(rate.first_amount)} first ${rate.first_hours}h then ${formatPeso(rate.succeeding_hourly_amount)}/h`;
    default:
      return rate.rate_type;
  }
}

// A listing's rates and price preview (areas are on their own page, /operator/areas).
export default function RatesScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const locationId = firstParam(
    useLocalSearchParams<{ locationId?: string | string[] }>().locationId
  );
  const [rates, setRates] = React.useState<any[]>([]);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState('Custom Rate');
  const [rateType, setRateType] = React.useState<RateType>('hourly');
  const [hourly, setHourly] = React.useState('50');
  const [daily, setDaily] = React.useState('400');
  const [monthly, setMonthly] = React.useState('4000');
  const [firstHours, setFirstHours] = React.useState('3');
  const [firstAmount, setFirstAmount] = React.useState('100');
  const [succeeding, setSucceeding] = React.useState('40');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [hours, setHours] = React.useState('1');
  const [quote, setQuote] = React.useState<any>(null);
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
      const [{ data: rateRows, error: rateErr }, loc] = await Promise.all([
        supabase
          .from('rates')
          .select('*')
          .eq('location_id', locationId)
          .order('is_default', { ascending: false }),
        supabase.from('locations').select('name').eq('id', locationId).single(),
      ]);
      if (loc.data?.name) setLocationName(loc.data.name);
      if (rateErr) throw rateErr;
      setRates(rateRows || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load rates');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const refreshQuote = async () => {
    // No listing picked (e.g. /operator/rates opened without ?locationId): there is
    // nothing to quote. Calling quote_price without p_location_id made PostgREST
    // answer 404 (no function with that parameter set) and replaced the
    // 'Pick a listing' message with its error.
    if (!locationId) return;
    const { data, error: qErr } = await supabase.rpc('quote_price', {
      p_location_id: locationId,
      p_vehicle_type: 'car',
      p_start_at: new Date().toISOString(),
      p_hours: Number(hours) || 1,
    });
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setQuote(data);
  };

  React.useEffect(() => {
    refreshQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates.length]);

  const saveRate = async () => {
    setError(null);
    const payload: Record<string, any> = {
      p_location_id: locationId,
      p_name: name.trim(),
      p_rate_type: rateType,
      p_rate_id: editingId,
      p_is_default: false,
      p_hourly_amount: rateType === 'hourly' ? Number(hourly) : null,
      p_daily_amount: rateType === 'daily' ? Number(daily) : null,
      p_monthly_amount: rateType === 'monthly' ? Number(monthly) : null,
      p_first_hours: rateType === 'flat_then_hourly' ? Number(firstHours) : null,
      p_first_amount: rateType === 'flat_then_hourly' ? Number(firstAmount) : null,
      p_succeeding_hourly_amount: rateType === 'flat_then_hourly' ? Number(succeeding) : null,
      p_effective_from: from ? fromDatetimeLocalValue(`${from}T00:00`) : null,
      p_effective_to: to ? fromDatetimeLocalValue(`${to}T00:00`) : null,
    };
    const { data, error: rpcError } = await supabase.rpc('upsert_rate', payload);
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setNotice(editingId ? 'Rate updated' : 'Rate created');
    setEditingId(null);
    await load();
    await refreshQuote();
  };

  const removeRate = async (rate: any) => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('delete_rate', { p_rate_id: rate.id });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setNotice('Rate deleted');
    await load();
    await refreshQuote();
  };

  const beginEdit = (rate: any) => {
    setEditingId(rate.id);
    setName(rate.name);
    setRateType(rate.rate_type);
    if (rate.hourly_amount != null) setHourly(String(rate.hourly_amount));
    if (rate.daily_amount != null) setDaily(String(rate.daily_amount));
    if (rate.monthly_amount != null) setMonthly(String(rate.monthly_amount));
    if (rate.first_hours != null) setFirstHours(String(rate.first_hours));
    if (rate.first_amount != null) setFirstAmount(String(rate.first_amount));
    if (rate.succeeding_hourly_amount != null) setSucceeding(String(rate.succeeding_hourly_amount));
    setFrom(rate.effective_from ? String(rate.effective_from).slice(0, 10) : '');
    setTo(rate.effective_to ? String(rate.effective_to).slice(0, 10) : '');
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="rates-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={bottomInset} testID="rates-ready">
      <Text style={styles.subtitle}>{locationName}</Text>

      <View style={styles.preview} testID="quote-preview">
        <Text style={styles.heading}>Price preview</Text>
        <Text style={styles.label}>Hours</Text>
        <TextInput
          style={styles.input}
          value={hours}
          onChangeText={setHours}
          keyboardType="numeric"
          testID="quote-hours"
        />
        <Button title="Refresh quote" onPress={refreshQuote} testID="quote-refresh" />
        {quote?.amount != null ? (
          <Text style={styles.quoteAmount} testID="quote-amount">
            {formatPeso(quote.amount)} · {quote.rate_name} · {quote.rate_type} ·{' '}
            {quote.billed_hours}h billed
          </Text>
        ) : (
          <Text style={styles.meta}>{quote?.error || 'No quote yet'}</Text>
        )}
        {rateType === 'monthly' ? (
          <Text style={styles.meta}>
            Monthly rates are listed for drivers and never price a session.
          </Text>
        ) : null}
      </View>

      <Text style={styles.heading}>Rates</Text>
      {rates.map((rate) => (
        <View key={rate.id} style={styles.card} testID={`rate-row-${rate.name}`}>
          <Text style={styles.rowTitle}>
            {rate.name} {rate.is_default ? '(default)' : ''}
          </Text>
          <Text style={styles.meta}>
            {rate.rate_type} · {rateSummary(rate)}
          </Text>
          {rate.effective_from || rate.effective_to ? (
            <Text style={styles.meta}>
              {rate.effective_from ? formatLocalDate(rate.effective_from) : '—'} →{' '}
              {rate.effective_to ? formatLocalDate(rate.effective_to) : '—'}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Button title="Edit" size="small" variant="outline" onPress={() => beginEdit(rate)} />
            <Button
              title={rate.is_default ? 'Default (locked)' : 'Delete'}
              size="small"
              variant={rate.is_default ? 'outline' : 'danger'}
              onPress={() => removeRate(rate)}
              testID={rate.is_default ? 'delete-default-rate' : `delete-rate-${rate.name}`}
            />
          </View>
        </View>
      ))}

      <Text style={styles.heading}>{editingId ? 'Edit rate' : 'New custom rate'}</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} testID="rate-name" />

      <Text style={styles.label}>Type</Text>
      <View style={styles.types}>
        {RATE_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            onPress={() => setRateType(type)}
            style={[styles.typeChip, rateType === type && styles.typeChipOn]}
            testID={`rate-type-${type}`}
          >
            <Text style={[styles.typeChipText, rateType === type && styles.typeChipTextOn]}>
              {type === 'flat_then_hourly' ? 'flat then hourly' : type}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {rateType === 'hourly' && (
        <>
          <Text style={styles.label}>Hourly amount (₱)</Text>
          <TextInput
            style={styles.input}
            value={hourly}
            onChangeText={setHourly}
            keyboardType="decimal-pad"
          />
        </>
      )}
      {rateType === 'daily' && (
        <>
          <Text style={styles.label}>Daily amount (₱)</Text>
          <TextInput
            style={styles.input}
            value={daily}
            onChangeText={setDaily}
            keyboardType="decimal-pad"
          />
        </>
      )}
      {rateType === 'monthly' && (
        <>
          <Text style={styles.label}>Monthly amount (₱)</Text>
          <TextInput
            style={styles.input}
            value={monthly}
            onChangeText={setMonthly}
            keyboardType="decimal-pad"
          />
        </>
      )}
      {rateType === 'flat_then_hourly' && (
        <>
          <Text style={styles.label}>First N hours</Text>
          <TextInput
            style={styles.input}
            value={firstHours}
            onChangeText={setFirstHours}
            keyboardType="numeric"
          />
          <Text style={styles.label}>Amount for first N (₱)</Text>
          <TextInput
            style={styles.input}
            value={firstAmount}
            onChangeText={setFirstAmount}
            keyboardType="decimal-pad"
          />
          <Text style={styles.label}>Succeeding hourly (₱)</Text>
          <TextInput
            style={styles.input}
            value={succeeding}
            onChangeText={setSucceeding}
            keyboardType="decimal-pad"
          />
        </>
      )}

      <Text style={styles.label}>Effective from (optional YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={from}
        onChangeText={setFrom}
        placeholder="2026-12-24"
        testID="rate-from"
      />
      <Text style={styles.label}>Effective to (optional)</Text>
      <TextInput
        style={styles.input}
        value={to}
        onChangeText={setTo}
        placeholder="2026-12-26"
        testID="rate-to"
      />

      <Button
        title={editingId ? 'Save rate' : 'Create rate'}
        onPress={saveRate}
        testID="rate-save"
      />

      {error ? (
        <Text style={styles.error} testID="rates-error">
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text style={styles.notice} testID="rates-notice">
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  rowTitle: { ...theme.typography.body, fontWeight: '600', flex: 1 },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  types: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.sm,
  },
  typeChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  typeChipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  typeChipText: { ...theme.typography.caption, color: theme.colors.text.primary },
  typeChipTextOn: { color: '#fff' },
  preview: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surfaceDark,
    borderRadius: theme.borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
  },
  quoteAmount: { ...theme.typography.h3, color: theme.colors.primary, marginTop: theme.spacing.md },
  error: { ...theme.typography.body, color: theme.colors.danger, marginTop: theme.spacing.md },
  notice: { ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.md },
});
