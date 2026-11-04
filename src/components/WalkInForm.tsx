import React from 'react';
import { Modal, View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
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
  fullAreaTitle,
  isFullAreaPrompt,
  sessionTimes,
  walkInErrorMessage,
  type FullAreaPrompt,
  type RateOption,
} from '../lib/walkIn';
import { formatLocalDateTime, formatPeso } from '../utils/formatters';
import {
  AREA_SELECT,
  allowedVehicleTypes,
  areaAllowsVehicle,
  defaultAreaId,
  sortAreas,
  vehicleForArea,
  type Area,
} from '../lib/areas';

export type WalkInValues = {
  vehicleType: VehicleType;
  plate: string;
  startAt: string;
  endAt: string | null;
  rateId: string | null;
  note: string;
  /** 0067: the session's area (Main by default). */
  areaId: string | null;
};

type Props = {
  locationId: string;
  initial?: Partial<WalkInValues>;
  showNote?: boolean;
  submitLabel: string;
  /** Button label when the start is in the future (a reservation, 0049). */
  reservationSubmitLabel?: string;
  /** Returns an error message to show, null on success, or a full-area prompt (0083): the
   *  form then asks to confirm and submits again with allowFull. */
  onSubmit: (
    v: WalkInValues,
    opts: { allowFull: boolean }
  ) => Promise<string | null | FullAreaPrompt>;
  /** Full-area dialog question and button (default: create the session). */
  fullQuestion?: string;
  fullConfirmLabel?: string;
  /** Bump to reload rate options and the amount (e.g. after a save elsewhere). */
  refreshKey?: number;
  /** Check-in: warn when the chosen area is switched Full (still allowed). */
  warnFull?: boolean;
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
  reservationSubmitLabel,
  onSubmit,
  refreshKey,
  warnFull,
  fullQuestion = 'Create the session anyway?',
  fullConfirmLabel = 'Create anyway',
}: Props) {
  const start0 = manilaDateTime(initial?.startAt || new Date().toISOString());
  const end0 = manilaDateTime(initial?.endAt);
  const [vehicle, setVehicle] = React.useState<VehicleType | null>(initial?.vehicleType || 'car');
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
  // 0083: the area is full; the values waiting for "Create anyway".
  const [pendingFull, setPendingFull] = React.useState<{
    prompt: FullAreaPrompt;
    values: WalkInValues;
  } | null>(null);
  const [tick, setTick] = React.useState(0);
  // rj t139u: area picker, defaulting to the given area (the one selected on the
  // Availability screen, or the session's), else Main.
  const [areas, setAreas] = React.useState<Area[]>([]);
  const [areaId, setAreaId] = React.useState<string | null>(initial?.areaId ?? null);

  React.useEffect(() => {
    let live = true;
    supabase
      .from('areas')
      .select(AREA_SELECT)
      .eq('location_id', locationId)
      .then(({ data }) => {
        if (!live) return;
        const sorted = sortAreas((data || []) as unknown as Area[]);
        setAreas(sorted);
        setAreaId((cur) => defaultAreaId(sorted, cur));
      });
    return () => {
      live = false;
    };
  }, [locationId, refreshKey]);
  const area = areas.find((a) => a.id === areaId) || null;
  // rj: the vehicle chips show only the types the selected area takes. Legacy session (edit)
  // whose stored type its own area no longer takes: that type stays as an extra chip, marked,
  // while the area is unchanged (the server accepts an unchanged area + vehicle).
  const legacyVehicle =
    initial?.vehicleType &&
    initial?.areaId &&
    area?.id === initial.areaId &&
    !areaAllowsVehicle(area, initial.vehicleType)
      ? initial.vehicleType
      : null;
  const allowed = allowedVehicleTypes(area, VEHICLE_TYPES);
  const vehicleChoices: VehicleType[] = legacyVehicle
    ? VEHICLE_TYPES.filter((t) => t === legacyVehicle || allowed.includes(t))
    : allowed;
  // Area loaded or changed: keep the vehicle if allowed, else pick the only one, else clear.
  React.useEffect(() => {
    if (!area) return;
    setVehicle((cur) =>
      legacyVehicle && cur === legacyVehicle
        ? cur
        : vehicleForArea(cur, allowedVehicleTypes(area, VEHICLE_TYPES))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area?.id, area?.vehicle_types?.join(',')]);

  const times = sessionTimes(startDate, startTime, endDate, endTime);
  const startAt = 'error' in times ? null : times.startAt;
  const endAt = 'error' in times ? null : times.endAt;

  // Applicable rates for this vehicle and start; a choice that no longer applies → Automatic.
  React.useEffect(() => {
    if (!startAt) return;
    if (!vehicle) {
      setOptions([]);
      setAuto(null);
      return;
    }
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
    if (!vehicle) {
      setQuote(null);
      setQuoteError('Choose a vehicle type');
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
    if (!vehicle) return setError('Choose a vehicle type');
    if (!plate.trim()) return setError('Plate number is required');
    if ('error' in times) return setError(times.error);
    await send(
      {
        vehicleType: vehicle,
        plate: plate.trim(),
        startAt: times.startAt,
        endAt: times.endAt,
        rateId,
        note: note.trim(),
        areaId,
      },
      false
    );
  };

  const send = async (values: WalkInValues, allowFull: boolean) => {
    setSaving(true);
    try {
      const res = await onSubmit(values, { allowFull });
      if (isFullAreaPrompt(res)) {
        setPendingFull({ prompt: res, values });
        setError(null);
      } else {
        setError(res);
      }
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
      <Text style={styles.label}>Area</Text>
      {areas.length ? (
        <FilterDropdown<string>
          label="Area"
          showLabel={false}
          value={areaId}
          options={areas.map((a) => ({ value: a.id, label: a.name }))}
          onChange={(v) => v && setAreaId(v)}
          highlightActive={false}
          style={styles.dropdown}
          testID="walkin-area"
        />
      ) : (
        <Text style={styles.meta}>Loading areas…</Text>
      )}
      {warnFull && area?.marked_full ? (
        <Text style={styles.warning} testID="checkin-full-warning">
          {area.name} is marked FULL. You can still check this car in after confirming; drivers keep
          seeing it as Full until it is switched back.
        </Text>
      ) : null}

      <Text style={styles.label}>Vehicle type *</Text>
      <View style={styles.row}>
        {vehicleChoices.map((t) => (
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
              {t === legacyVehicle ? ' (not allowed here)' : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {legacyVehicle ? (
        <Text style={styles.meta} testID="walkin-vehicle-legacy">
          {area?.name} no longer takes {VEHICLE_TYPE_LABELS[legacyVehicle]}. This session keeps it
          unless you change the vehicle or the area.
        </Text>
      ) : null}

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
            {quote.reservation ? (
              <Text style={styles.reservationNote} testID="walkin-reservation">
                Reservation: the start is in the future. The amount is for the planned stay
                {endAt ? '' : ' (minimum charge until you set an End)'}.
              </Text>
            ) : null}
            <Text style={styles.amount} testID="walkin-amount">
              {quote.reservation ? 'Planned amount' : 'Amount due'}: {formatPeso(quote.amount)}
            </Text>
            <Text style={styles.meta} testID="walkin-amount-detail">
              {quote.reservation && !endAt
                ? `From ${formatLocalDateTime(startAt || '')}`
                : quote.until_now
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
      <Button
        title={quote?.reservation && reservationSubmitLabel ? reservationSubmitLabel : submitLabel}
        onPress={submit}
        loading={saving}
        testID="walkin-submit"
      />

      <Modal
        visible={!!pendingFull}
        transparent
        animationType="fade"
        onRequestClose={() => !saving && setPendingFull(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog} testID="walkin-full-dialog">
            <Text style={styles.dialogTitle}>
              {pendingFull ? fullAreaTitle(pendingFull.prompt) : ''}
            </Text>
            <Text style={styles.dialogBody}>{fullQuestion}</Text>
            <Button
              title={fullConfirmLabel}
              onPress={() => {
                if (!pendingFull) return;
                const v = pendingFull.values;
                setPendingFull(null);
                send(v, true);
              }}
              disabled={saving}
              testID="walkin-full-confirm"
            />
            <TouchableOpacity
              onPress={() => setPendingFull(null)}
              disabled={saving}
              style={styles.cancel}
              testID="walkin-full-cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  dialog: {
    backgroundColor: theme.colors.background,
    borderRadius: 16,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  dialogTitle: { ...theme.typography.h3 },
  dialogBody: { ...theme.typography.body, color: theme.colors.text.secondary },
  cancel: {
    alignSelf: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  cancelText: { ...theme.typography.body, fontWeight: '600', color: theme.colors.text.secondary },
  warning: {
    color: '#991b1b',
    backgroundColor: '#fee2e2',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing.sm,
    fontWeight: '600',
  },
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
  reservationNote: {
    ...theme.typography.bodySmall,
    color: '#1e3a8a',
    backgroundColor: '#dbeafe',
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.sm,
  },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 4 },
  error: { ...theme.typography.body, color: theme.colors.danger, marginVertical: theme.spacing.md },
});
