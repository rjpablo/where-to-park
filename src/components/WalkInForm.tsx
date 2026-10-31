import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Button } from './Button';
import { FilterDropdown } from './FilterDropdown';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, type VehicleType } from '../lib/searchFilters';
import {
  autoOptionLabel,
  keepRateChoice,
  manilaDateTime,
  rateOptionLabel,
  sessionTimes,
  walkInErrorMessage,
  type RateOption,
} from '../lib/walkIn';
import { formatLocalDateTime, formatPeso } from '../utils/formatters';

export type WalkInValues = {
  vehicleType: VehicleType;
  plate: string;
  startAt: string;
  endAt: string | null;
  rateId: string | null;
  note: string;
};

type Props = {
  locationId: string;
  initial?: Partial<WalkInValues>;
  showNote?: boolean;
  submitLabel: string;
  /** Returns an error message to show, or null on success. */
  onSubmit: (v: WalkInValues) => Promise<string | null>;
  /** Bump to reload rate options and the amount (e.g. after a save elsewhere). */
  refreshKey?: number;
};

/**
 * Walk-in check-in / session edit fields: vehicle, plate, start (Manila, required,
 * defaults to now), optional end, rate dropdown (Automatic + applicable rates) and the
 * amount due for the chosen rate up to the end (or now).
 */
export function WalkInForm({
  locationId,
  initial,
  showNote,
  submitLabel,
  onSubmit,
  refreshKey,
}: Props) {
  const start0 = manilaDateTime(initial?.startAt || new Date().toISOString());
  const end0 = manilaDateTime(initial?.endAt);
  const [vehicle, setVehicle] = React.useState<VehicleType>(initial?.vehicleType || 'car');
  const [plate, setPlate] = React.useState(initial?.plate || '');
  const [startDate, setStartDate] = React.useState(start0.date);
  const [startTime, setStartTime] = React.useState(start0.time);
  const [endDate, setEndDate] = React.useState(end0.date);
  const [endTime, setEndTime] = React.useState(end0.time);
  const [rateId, setRateId] = React.useState<string | null>(initial?.rateId ?? null);
  const [note, setNote] = React.useState(initial?.note || '');
  const [options, setOptions] = React.useState<RateOption[]>([]);
  const [auto, setAuto] = React.useState<any>(undefined);
  const [quote, setQuote] = React.useState<any>(null);
  const [quoteError, setQuoteError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  const times = sessionTimes(startDate, startTime, endDate, endTime);
  const startAt = 'error' in times ? null : times.startAt;
  const endAt = 'error' in times ? null : times.endAt;

  // Applicable rates for this vehicle and start; a choice that no longer applies → Automatic.
  React.useEffect(() => {
    if (!startAt) return;
    let live = true;
    supabase
      .rpc('walk_in_rate_options', {
        p_location_id: locationId,
        p_vehicle_type: vehicle,
        p_start_at: startAt,
      })
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e || data?.error) {
          setOptions([]);
          setAuto(null);
          setQuoteError(e?.message || walkInErrorMessage(data?.error));
          return;
        }
        setOptions(data.rates || []);
        setAuto(data.auto);
        setRateId((cur) => keepRateChoice(cur, data.rates || []));
      });
    return () => {
      live = false;
    };
  }, [locationId, vehicle, startAt, refreshKey]);

  // Without an end the amount runs to now: refresh it every minute.
  React.useEffect(() => {
    if (endAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [endAt]);

  React.useEffect(() => {
    if ('error' in times) {
      setQuote(null);
      setQuoteError(times.error);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error: e } = await supabase.rpc('walk_in_quote', {
        p_location_id: locationId,
        p_vehicle_type: vehicle,
        p_start_at: times.startAt,
        p_end_at: times.endAt,
        p_rate_id: rateId,
      });
      if (!live) return;
      if (e || data?.error) {
        setQuote(null);
        setQuoteError(e?.message || walkInErrorMessage(data?.error));
        return;
      }
      setQuoteError(null);
      setQuote(data);
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, vehicle, startAt, endAt, rateId, tick, refreshKey]);

  const setNow = () => {
    const now = manilaDateTime(new Date().toISOString());
    setStartDate(now.date);
    setStartTime(now.time);
  };

  const submit = async () => {
    setError(null);
    if (!plate.trim()) return setError('Plate number is required');
    if ('error' in times) return setError(times.error);
    setSaving(true);
    try {
      const msg = await onSubmit({
        vehicleType: vehicle,
        plate: plate.trim(),
        startAt: times.startAt,
        endAt: times.endAt,
        rateId,
        note: note.trim(),
      });
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const parts: any[] = Array.isArray(quote?.breakdown) ? quote.breakdown : [];
  const rateOptions = [
    { value: null, label: autoOptionLabel(auto ?? null) },
    ...options.map((o) => ({ value: o.id, label: rateOptionLabel(o) })),
  ];

  return (
    <View testID="walkin-form">
      <Text style={styles.label}>Vehicle type *</Text>
      <View style={styles.row}>
        {VEHICLE_TYPES.map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setVehicle(t)}
            style={[styles.chip, vehicle === t && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: vehicle === t }}
            testID={`walkin-vehicle-${t}`}
          >
            <Text style={[styles.chipText, vehicle === t && styles.chipTextOn]}>
              {VEHICLE_TYPE_LABELS[t]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Plate number *</Text>
      <TextInput
        style={styles.input}
        value={plate}
        onChangeText={setPlate}
        placeholder="ABC 1234"
        autoCapitalize="characters"
        testID="walkin-plate"
      />

      <Text style={styles.label}>Start * (date YYYY-MM-DD, time HH:MM)</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.date]}
          value={startDate}
          onChangeText={setStartDate}
          placeholder="YYYY-MM-DD"
          testID="walkin-start-date"
        />
        <TextInput
          style={[styles.input, styles.time]}
          value={startTime}
          onChangeText={setStartTime}
          placeholder="HH:MM"
          testID="walkin-start-time"
        />
        <Button
          title="Now"
          size="small"
          variant="outline"
          onPress={setNow}
          testID="walkin-start-now"
        />
      </View>

      <Text style={styles.label}>End (optional)</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.date]}
          value={endDate}
          onChangeText={setEndDate}
          placeholder="YYYY-MM-DD"
          testID="walkin-end-date"
        />
        <TextInput
          style={[styles.input, styles.time]}
          value={endTime}
          onChangeText={setEndTime}
          placeholder="HH:MM"
          testID="walkin-end-time"
        />
        {endDate || endTime ? (
          <Button
            title="Clear"
            size="small"
            variant="outline"
            onPress={() => {
              setEndDate('');
              setEndTime('');
            }}
            testID="walkin-end-clear"
          />
        ) : null}
      </View>
      <Text style={styles.meta}>
        Times are Philippine time. Without an end, the amount runs to now.
      </Text>

      <Text style={styles.label}>Rate</Text>
      <FilterDropdown<string>
        label="Rate"
        showLabel={false}
        value={rateId}
        options={rateOptions}
        onChange={setRateId}
        highlightActive={false}
        style={styles.dropdown}
        testID="walkin-rate"
      />

      <View style={styles.amountBox}>
        {quote ? (
          <>
            <Text style={styles.amount} testID="walkin-amount">
              Amount due: {formatPeso(quote.amount)}
            </Text>
            <Text style={styles.meta} testID="walkin-amount-detail">
              {quote.until_now
                ? `Up to now (${formatLocalDateTime(quote.until)})`
                : `To ${formatLocalDateTime(quote.until)}`}
              {' · '}
              {quote.rate_type === 'monthly'
                ? `${quote.billed_months} month${quote.billed_months === 1 ? '' : 's'}`
                : `${quote.billed_hours}h billed`}
            </Text>
            {parts.map((p: any, i: number) => (
              <Text
                key={`${p.rate_id}-${i}`}
                style={styles.meta}
                testID={`walkin-part-${p.rate_name}`}
              >
                {p.rate_name}: {p.months ? `${p.months} mo` : `${p.hours}h`} ·{' '}
                {formatPeso(p.amount)}
              </Text>
            ))}
          </>
        ) : (
          <Text style={styles.meta} testID="walkin-amount-message">
            {quoteError || 'Calculating…'}
          </Text>
        )}
      </View>

      {showNote ? (
        <>
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g., Visitor, VIP guest"
            testID="walkin-note"
          />
        </>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="walkin-error">
          {error}
        </Text>
      ) : null}
      <Button title={submitLabel} onPress={submit} loading={saving} testID="walkin-submit" />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...theme.typography.body,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, alignItems: 'center' },
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
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    backgroundColor: theme.colors.surface,
  },
  date: { flexGrow: 1, minWidth: 140 },
  time: { width: 90 },
  dropdown: { maxWidth: '100%', paddingVertical: theme.spacing.sm },
  amountBox: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceDark,
  },
  amount: { ...theme.typography.h3, color: theme.colors.primary },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 4 },
  error: { ...theme.typography.body, color: theme.colors.danger, marginVertical: theme.spacing.md },
});
