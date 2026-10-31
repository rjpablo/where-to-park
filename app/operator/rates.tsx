import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { formatLocalDate, formatPeso } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';
import { canBeDefault, rateErrorMessage, rateStatusErrorMessage } from '../../src/lib/rates';
import { daysLabel } from '../../src/lib/rateForm';
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, type VehicleType } from '../../src/lib/searchFilters';
import {
  manilaTimeNow,
  manilaToday,
  previewDayLabel,
  previewHours,
  previewStartAt,
  manilaWeekdayTime,
  quoteParts,
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
  const [confirmArchive, setConfirmArchive] = React.useState<string | null>(null);
  // Deactivate/archive errors show on the rate's own row.
  const [rowError, setRowError] = React.useState<{ id: string; message: string } | null>(null);
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
          // Archived rates are hidden (soft-deleted, kept for past sessions; 0048).
          .is('archived_at', null)
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
      const from = data?.uncovered_from ? manilaWeekdayTime(data.uncovered_from) : '';
      setQuoteError(
        qErr?.message || rateErrorMessage(data.error) + (from ? ` (Not covered from ${from}.)` : '')
      );
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

  // Deactivate / re-activate a non-default rate (0048). The server refuses while an
  // open session (started or upcoming) has the rate chosen, and says how many.
  const setActive = async (rate: any, active: boolean) => {
    setError(null);
    setNotice(null);
    setRowError(null);
    const { data, error: rpcError } = await supabase.rpc('set_rate_active', {
      p_rate_id: rate.id,
      p_active: active,
    });
    if (rpcError || data?.error) {
      setRowError({ id: rate.id, message: rpcError?.message || rateStatusErrorMessage(data) });
      return;
    }
    setNotice(`'${rate.name}' ${active ? 'is active again' : 'is now inactive'}`);
    await load();
  };

  // Archive = soft delete of an inactive rate: hidden here, kept for past sessions.
  const archive = async (rate: any) => {
    setError(null);
    setNotice(null);
    setRowError(null);
    setConfirmArchive(null);
    const { data, error: rpcError } = await supabase.rpc('archive_rate', { p_rate_id: rate.id });
    if (rpcError || data?.error) {
      setRowError({ id: rate.id, message: rpcError?.message || rateStatusErrorMessage(data) });
      return;
    }
    setNotice(`'${rate.name}' archived`);
    await load();
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
            {quoteParts(quote).length > 1 ? (
              <>
                <Text style={styles.quoteAmount} testID="quote-amount">
                  {formatPeso(quote.amount)} · {quote.billed_hours}h billed
                </Text>
                {quoteParts(quote).map((p) => (
                  <Text key={p.key} style={styles.meta} testID={`quote-part-${p.rateName}`}>
                    {p.rateName}: {p.hours}h from {p.from} · {formatPeso(p.amount)}
                  </Text>
                ))}
              </>
            ) : (
              <Text style={styles.quoteAmount} testID="quote-amount">
                {formatPeso(quote.amount)} · {quote.rate_name} · {quote.rate_type} ·{' '}
                {quote.billed_hours}h billed
              </Text>
            )}
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
          Each hour is priced at the rate in effect when that hour starts, so a stay can be split
          across rates. Extra charges (e.g. overnight) are added by staff as fees.
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
          <View style={styles.titleRow}>
            <Text style={styles.rowTitle}>
              {rate.name} {rate.is_default ? '(default)' : ''}
            </Text>
            {rate.active === false ? (
              <Text style={styles.inactiveBadge} testID={`rate-inactive-${rate.name}`}>
                Inactive
              </Text>
            ) : null}
          </View>
          <Text style={styles.meta}>
            {rate.rate_type} · {rateSummary(rate)}
          </Text>
          <Text style={styles.meta} testID={`rate-days-${rate.name}`}>
            {daysLabel(rate.days_of_week)}
          </Text>
          <Text style={styles.meta} testID={`rate-vehicle-${rate.name}`}>
            {rate.vehicle_type
              ? (VEHICLE_TYPE_LABELS as Record<string, string>)[rate.vehicle_type] ||
                rate.vehicle_type
              : 'All vehicles'}
          </Text>
          {rate.effective_from || rate.effective_to ? (
            <Text style={styles.meta}>
              {rate.effective_from ? formatLocalDate(rate.effective_from) : '—'} →{' '}
              {rate.effective_to ? formatLocalDate(rate.effective_to) : '—'}
            </Text>
          ) : null}
          {rowError?.id === rate.id ? (
            <Text style={styles.error} testID={`rate-error-${rate.name}`}>
              {rowError?.message}
            </Text>
          ) : null}
          {confirmArchive === rate.id ? (
            <View style={styles.confirm} testID={`archive-confirm-${rate.name}`}>
              <Text style={styles.meta}>
                Archive '{rate.name}'? It disappears from this list and can't be used again. Past
                sessions keep it.
              </Text>
              <View style={styles.row}>
                <Button
                  title="Archive rate"
                  size="small"
                  variant="danger"
                  onPress={() => archive(rate)}
                  testID={`archive-yes-${rate.name}`}
                />
                <Button
                  title="Cancel"
                  size="small"
                  variant="outline"
                  onPress={() => setConfirmArchive(null)}
                  testID={`archive-no-${rate.name}`}
                />
              </View>
            </View>
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
            {/* The default can't be deactivated or archived (server-enforced too). Archive
                replaces Delete so past sessions keep their rate (0048). */}
            {rate.is_default ? null : rate.active === false ? (
              <>
                <Button
                  title="Activate"
                  size="small"
                  variant="outline"
                  onPress={() => setActive(rate, true)}
                  testID={`activate-rate-${rate.name}`}
                />
                <Button
                  title="Archive"
                  size="small"
                  variant="danger"
                  onPress={() => setConfirmArchive(rate.id)}
                  testID={`archive-rate-${rate.name}`}
                />
              </>
            ) : (
              <Button
                title="Deactivate"
                size="small"
                variant="outline"
                onPress={() => setActive(rate, false)}
                testID={`deactivate-rate-${rate.name}`}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  inactiveBadge: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
    color: '#374151',
    backgroundColor: '#e5e7eb',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
    overflow: 'hidden',
  },
  confirm: {
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: '#fef2f2',
    marginBottom: theme.spacing.sm,
  },
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
