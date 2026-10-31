import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { formatLocalDate, formatPeso } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';
import { canBeDefault, rateErrorMessage } from '../../src/lib/rates';
import { daysLabel } from '../../src/lib/rateForm';
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, type VehicleType } from '../../src/lib/searchFilters';
import {
  manilaTimeNow,
  manilaToday,
  previewDayLabel,
  previewHours,
  previewStartAt,
} from '../../src/lib/quotePreview';
import { useBottomInset } from '../../src/hooks/useBottomInset';

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
  const router = useRouter();
  const [rates, setRates] = React.useState<any[]>([]);
  const [hours, setHours] = React.useState('1');
  // Preview start: a Manila date (default today) and time (default now).
  const [quoteDate, setQuoteDate] = React.useState(() => manilaToday());
  const [quoteTime, setQuoteTime] = React.useState(() => manilaTimeNow());
  const [quoteVehicle, setQuoteVehicle] = React.useState<VehicleType>('car');
  const [quote, setQuote] = React.useState<any>(null);
  const [quoteError, setQuoteError] = React.useState<string | null>(null);
  // What the shown amount was quoted for (not the live inputs, which may be mid-edit).
  const [quotedFor, setQuotedFor] = React.useState('');
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

  // Reload whenever the list is shown again (e.g. back from New/Edit rate).
  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const refreshQuote = async () => {
    // No listing picked (e.g. /operator/rates opened without ?locationId): there is
    // nothing to quote. Calling quote_price without p_location_id made PostgREST
    // answer 404 (no function with that parameter set) and replaced the
    // 'Pick a listing' message with its error.
    if (!locationId) return;
    const start = previewStartAt(quoteDate, quoteTime);
    const h = previewHours(hours);
    const bad = 'error' in start ? start.error : typeof h === 'object' ? h.error : null;
    if (bad || 'error' in start || typeof h === 'object') {
      setQuote(null);
      setQuoteError(bad || 'Check the preview fields');
      return;
    }
    const { data, error: qErr } = await supabase.rpc('quote_price', {
      p_location_id: locationId,
      p_vehicle_type: quoteVehicle,
      p_start_at: start.startAt,
      p_hours: h,
    });
    // Errors stay in the preview (not the page error) and never leave a stale amount.
    if (qErr || data?.error) {
      setQuote(null);
      setQuoteError(qErr?.message || String(data.error));
      return;
    }
    setQuoteError(null);
    setQuotedFor(
      `${VEHICLE_TYPE_LABELS[quoteVehicle]}, starting ${previewDayLabel(quoteDate)} ${quoteTime.trim()}`
    );
    setQuote(data);
  };

  React.useEffect(() => {
    refreshQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates]);

  const removeRate = async (rate: any) => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('delete_rate', { p_rate_id: rate.id });
    if (rpcError || data?.error) {
      setError(rpcError?.message || rateErrorMessage(data?.error));
      return;
    }
    setNotice('Rate deleted');
    await load();
    await refreshQuote();
  };

  // Make this rate the listing's default; the server unsets the old one (set_default_rate).
  const makeDefault = async (rate: any) => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('set_default_rate', {
      p_rate_id: rate.id,
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || rateErrorMessage(data?.error));
      return;
    }
    setNotice(`'${rate.name}' is now the default rate`);
    await load();
    await refreshQuote();
  };

  const openForm = (rate?: any) =>
    router.push({
      pathname: '/operator/rate-edit',
      params: rate ? { locationId: locationId!, rateId: rate.id } : { locationId: locationId! },
    });

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
        <Text style={styles.label}>Vehicle</Text>
        <View style={styles.chips}>
          {VEHICLE_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setQuoteVehicle(t)}
              style={[styles.chip, quoteVehicle === t && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: quoteVehicle === t }}
              testID={`quote-vehicle-${t}`}
            >
              <Text style={[styles.chipText, quoteVehicle === t && styles.chipTextOn]}>
                {VEHICLE_TYPE_LABELS[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={quoteDate}
          onChangeText={setQuoteDate}
          placeholder="YYYY-MM-DD"
          testID="quote-date"
        />
        <Text style={styles.label}>Start time (HH:MM, 24-hour)</Text>
        <TextInput
          style={styles.input}
          value={quoteTime}
          onChangeText={setQuoteTime}
          placeholder="HH:MM"
          testID="quote-time"
        />
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
          <>
            <Text style={styles.quoteAmount} testID="quote-amount">
              {formatPeso(quote.amount)} · {quote.rate_name} · {quote.rate_type} ·{' '}
              {quote.billed_hours}h billed
            </Text>
            <Text style={styles.meta} testID="quote-for">
              {quotedFor}
            </Text>
          </>
        ) : (
          <Text style={styles.meta} testID="quote-message">
            {quoteError || 'No quote yet'}
          </Text>
        )}
        <Text style={styles.meta}>
          The rate in effect when the stay starts prices the whole stay.
        </Text>
        <Text style={styles.meta}>
          Monthly rates are listed for drivers and never price a session.
        </Text>
      </View>

      <Text style={styles.heading}>Rates</Text>
      <Button
        title="Add rate"
        onPress={() => openForm()}
        disabled={!locationId}
        style={styles.addButton}
        testID="rate-add"
      />
      {rates.map((rate) => (
        <View key={rate.id} style={styles.card} testID={`rate-row-${rate.name}`}>
          <Text style={styles.rowTitle}>
            {rate.name} {rate.is_default ? '(default)' : ''}
          </Text>
          <Text style={styles.meta}>
            {rate.rate_type} · {rateSummary(rate)}
          </Text>
          <Text style={styles.meta} testID={`rate-days-${rate.name}`}>
            {daysLabel(rate.days_of_week)}
          </Text>
          {rate.effective_from || rate.effective_to ? (
            <Text style={styles.meta}>
              {rate.effective_from ? formatLocalDate(rate.effective_from) : '—'} →{' '}
              {rate.effective_to ? formatLocalDate(rate.effective_to) : '—'}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Button
              title="Edit"
              size="small"
              variant="outline"
              onPress={() => openForm(rate)}
              testID={`edit-rate-${rate.name}`}
            />
            {canBeDefault(rate) ? (
              <Button
                title="Set as default"
                size="small"
                variant="outline"
                onPress={() => makeDefault(rate)}
                testID={`default-rate-${rate.name}`}
              />
            ) : null}
            {/* No Delete on the default rate (the server refuses it too). */}
            {rate.is_default ? null : (
              <Button
                title="Delete"
                size="small"
                variant="danger"
                onPress={() => removeRate(rate)}
                testID={`delete-rate-${rate.name}`}
              />
            )}
          </View>
        </View>
      ))}

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
    flexWrap: 'wrap',
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.caption, color: theme.colors.text.primary },
  chipTextOn: { color: '#fff' },
  addButton: { marginBottom: theme.spacing.md },
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
