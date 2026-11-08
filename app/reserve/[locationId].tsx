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
import { DateTimeField } from '../../src/components/DateTimeField';
import { FilterDropdown } from '../../src/components/FilterDropdown';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { manilaDateTime, sessionTimes } from '../../src/lib/walkIn';
import { firstParam } from '../../src/lib/params';
import { INPUT_VEHICLE, areaForVehicle, reservationErrorMessage } from '../../src/lib/reservations';
import {
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
  isVehicleType,
  type VehicleType,
} from '../../src/lib/searchFilters';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { showToast } from '../../src/stores/toastStore';
import { useAuthStore } from '../../src/stores/authStore';
import { formatPeso } from '../../src/utils/formatters';

type SavedVehicle = {
  id: string;
  nickname: string;
  plate: string | null;
  vehicle_type: string;
  is_default: boolean;
};

type AreaRow = {
  id: string;
  name: string;
  is_main: boolean;
  sort_order: number | null;
  vehicle_types: string[] | null;
};

/**
 * Driver reservation editor. A saved vehicle hides the type and plate fields.
 * The area is assigned on the server and is not shown here.
 */
export default function ReserveScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const params = useLocalSearchParams<{ locationId?: string; session?: string }>();
  const locationId = firstParam(params.locationId);
  const sessionId = firstParam(params.session);
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);

  const [loading, setLoading] = React.useState(true);
  const [locationName, setLocationName] = React.useState('');
  const [areas, setAreas] = React.useState<AreaRow[]>([]);
  const [vehicles, setVehicles] = React.useState<SavedVehicle[]>([]);
  const [choice, setChoice] = React.useState(INPUT_VEHICLE);
  const [vehicleType, setVehicleType] = React.useState<VehicleType | null>(null);
  const [plate, setPlate] = React.useState('');
  const [saveVehicle, setSaveVehicle] = React.useState(false);
  const [nickname, setNickname] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [locked, setLocked] = React.useState<string | null>(null);
  const [quote, setQuote] = React.useState<number | null>(null);
  const [quoteError, setQuoteError] = React.useState<string | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const returnPath = `/reserve/${locationId}${sessionId ? `?session=${sessionId}` : ''}`;

  React.useEffect(() => {
    if (!initialized || user) return;
    router.replace(`/auth?next=${encodeURIComponent(returnPath)}`);
  }, [initialized, user, returnPath, router]);

  React.useEffect(() => {
    if (!locationId || !user) return;
    let live = true;
    (async () => {
      setLoading(true);
      const [locationRes, areaRes, vehicleRes, sessionRes] = await Promise.all([
        supabase.from('locations').select('name').eq('id', locationId).maybeSingle(),
        supabase
          .from('areas')
          .select('id, name, is_main, sort_order, vehicle_types')
          .eq('location_id', locationId),
        supabase
          .from('vehicles')
          .select('id, nickname, plate, vehicle_type, is_default')
          .order('is_default', { ascending: false }),
        sessionId
          ? supabase
              .from('parking_sessions')
              .select(
                'id, driver_id, location_id, plate, vehicle_type, started_at, scheduled_end_at, approval_status, cancelled_at, status'
              )
              .eq('id', sessionId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (!live) return;
      if (locationRes.error || areaRes.error || vehicleRes.error || sessionRes.error) {
        setError('Could not open this reservation.');
        setLoading(false);
        return;
      }
      setLocationName(locationRes.data?.name || 'Parking');
      setAreas((areaRes.data || []) as AreaRow[]);
      const saved = (vehicleRes.data || []) as SavedVehicle[];
      setVehicles(saved);

      const row = sessionRes.data as {
        driver_id?: string;
        location_id?: string;
        plate?: string;
        vehicle_type?: string;
        started_at?: string;
        scheduled_end_at?: string;
        approval_status?: string | null;
        cancelled_at?: string | null;
        status?: string;
      } | null;
      if (sessionId) {
        if (!row || row.driver_id !== user.id || row.location_id !== locationId) {
          setLocked('This reservation could not be found.');
        } else if (
          row.approval_status !== 'pending' ||
          row.cancelled_at ||
          row.status === 'ended'
        ) {
          setLocked('This reservation can no longer be changed.');
        } else {
          const match = saved.find(
            (v) =>
              v.vehicle_type === row.vehicle_type &&
              (v.plate || '').replace(/\s/g, '').toUpperCase() ===
                (row.plate || '').replace(/\s/g, '').toUpperCase()
          );
          if (match) setChoice(match.id);
          else {
            setChoice(INPUT_VEHICLE);
            if (isVehicleType(row.vehicle_type)) setVehicleType(row.vehicle_type);
            setPlate(row.plate || '');
          }
          const start = manilaDateTime(row.started_at);
          const end = manilaDateTime(row.scheduled_end_at);
          setStartDate(start.date);
          setStartTime(start.time);
          setEndDate(end.date);
          setEndTime(end.time);
        }
      } else {
        const preferred = saved.find((v) => v.is_default) ?? saved[0];
        setChoice(preferred ? preferred.id : INPUT_VEHICLE);
      }
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [locationId, sessionId, user]);

  const selected = vehicles.find((v) => v.id === choice) ?? null;
  const type = selected ? selected.vehicle_type : vehicleType;
  const plateValue = selected ? selected.plate || '' : plate.trim();
  const times = sessionTimes(startDate, startTime, endDate, endTime);
  const startAt = 'error' in times ? null : times.startAt;
  const endAt = 'error' in times ? null : times.endAt;
  const area = type ? areaForVehicle(areas, type) : null;
  const startPast = !!startAt && new Date(startAt).getTime() <= Date.now();
  const missingEnd = !!startAt && !('error' in times) && !endAt;

  React.useEffect(() => {
    if (!locationId || !type || !isVehicleType(type) || !startAt || !endAt || startPast || !area) {
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      return;
    }
    let live = true;
    setQuoting(true);
    supabase
      .rpc('reservation_quote', {
        p_location_id: locationId,
        p_vehicle_type: type,
        p_started_at: startAt,
        p_end_at: endAt,
      })
      .then(({ data, error: rpcError }) => {
        if (!live) return;
        setQuoting(false);
        if (rpcError || data?.error) {
          setQuote(null);
          setQuoteError(reservationErrorMessage(data?.error || rpcError?.message));
          return;
        }
        setQuote(Number(data.amount));
        setQuoteError(null);
      });
    return () => {
      live = false;
    };
  }, [locationId, type, startAt, endAt, startPast, area]);

  const blocker = locked
    ? locked
    : !type
      ? null
      : !area
        ? 'No area at this listing takes this vehicle type.'
        : selected && !selected.plate
          ? 'This saved vehicle has no plate number. Choose Input details and enter one.'
          : startPast
            ? 'The start has to be in the future.'
            : missingEnd
              ? 'Enter an end date and time.'
              : 'error' in times && (startDate || startTime || endDate || endTime)
                ? times.error
                : quoteError;

  const submit = async () => {
    if (!locationId || !type || !startAt || !endAt || blocker) return;
    if (choice === INPUT_VEHICLE && saveVehicle && !nickname.trim()) {
      setError('Enter a name to save this vehicle.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      p_vehicle_type: type,
      p_plate: plateValue,
      p_started_at: startAt,
      p_end_at: endAt,
      p_vehicle_id: choice === INPUT_VEHICLE ? null : choice,
      p_save_nickname: choice === INPUT_VEHICLE && saveVehicle ? nickname.trim() : null,
    };
    const { data, error: rpcError } = sessionId
      ? await supabase.rpc('update_reservation_request', { p_session_id: sessionId, ...payload })
      : await supabase.rpc('request_reservation', { p_location_id: locationId, ...payload });
    setSaving(false);
    if (rpcError || data?.error) {
      setError(reservationErrorMessage(data?.error || rpcError?.message));
      return;
    }
    showToast(sessionId ? 'Reservation updated' : 'Reservation request sent', 'success');
    router.replace(`/sessions/${data.session_id}`);
  };

  if (!initialized || !user || loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="reserve-loading">
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const vehicleOptions = [
    ...vehicles.map((v) => ({ value: v.id, label: v.nickname || 'Saved vehicle' })),
    { value: INPUT_VEHICLE, label: 'Input details' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      keyboardShouldPersistTaps="handled"
      testID="reserve-ready"
    >
      <Text style={styles.location} testID="reserve-location">
        {locationName}
      </Text>

      <Text style={styles.label}>Vehicle</Text>
      <FilterDropdown
        label="Vehicle"
        value={choice}
        options={vehicleOptions}
        onChange={(value) => {
          if (value) setChoice(value);
        }}
        highlightActive={false}
        style={styles.dropdown}
        testID="reserve-vehicle"
      />

      {selected ? (
        <View style={styles.vehicleCard} testID="reserve-saved-vehicle">
          <Text style={styles.vehicleLine}>
            {VEHICLE_TYPE_LABELS[selected.vehicle_type as VehicleType] || selected.vehicle_type}
          </Text>
          <Text style={styles.vehicleLine}>{selected.plate || 'No plate number'}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.label}>Vehicle type</Text>
          <FilterDropdown
            label="Type"
            value={vehicleType}
            options={[
              { value: null, label: 'Choose a type' },
              ...VEHICLE_TYPES.map((v) => ({ value: v, label: VEHICLE_TYPE_LABELS[v] })),
            ]}
            onChange={(value) => {
              if (value && isVehicleType(value)) setVehicleType(value);
            }}
            highlightActive={false}
            style={styles.dropdown}
            testID="reserve-type"
          />
          <Text style={styles.label}>Plate number</Text>
          <TextInput
            style={styles.input}
            value={plate}
            onChangeText={setPlate}
            autoCapitalize="characters"
            placeholder="ABC 1234"
            testID="reserve-plate"
          />
          <TouchableOpacity
            onPress={() => setSaveVehicle((v) => !v)}
            style={styles.checkRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: saveVehicle }}
            testID="reserve-save-vehicle"
          >
            <Text style={styles.checkMark}>{saveVehicle ? '☑' : '☐'}</Text>
            <Text style={styles.checkLabel}>Save vehicle</Text>
          </TouchableOpacity>
          {saveVehicle ? (
            <>
              <Text style={styles.label}>Vehicle name</Text>
              <TextInput
                style={styles.input}
                value={nickname}
                onChangeText={setNickname}
                placeholder="My car"
                testID="reserve-nickname"
              />
            </>
          ) : null}
        </>
      )}

      <Text style={styles.label}>Start</Text>
      <View style={styles.timeRow}>
        <DateTimeField
          mode="date"
          value={startDate}
          onChange={setStartDate}
          style={styles.timeField}
          testID="reserve-start-date"
        />
        <DateTimeField
          mode="time"
          value={startTime}
          onChange={setStartTime}
          style={styles.timeField}
          testID="reserve-start-time"
        />
      </View>
      <Text style={styles.label}>End</Text>
      <View style={styles.timeRow}>
        <DateTimeField
          mode="date"
          value={endDate}
          onChange={setEndDate}
          style={styles.timeField}
          testID="reserve-end-date"
        />
        <DateTimeField
          mode="time"
          value={endTime}
          onChange={setEndTime}
          style={styles.timeField}
          testID="reserve-end-time"
        />
      </View>

      <Text style={styles.price} testID="reserve-price">
        Planned price: {quoting ? '…' : quote != null && !blocker ? formatPeso(quote) : '—'}
      </Text>
      {blocker ? (
        <Text style={styles.error} testID="reserve-block">
          {blocker}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="reserve-error">
          {error}
        </Text>
      ) : null}

      {locked ? null : (
        <Button
          title={sessionId ? 'Save changes' : 'Request reservation'}
          onPress={submit}
          loading={saving}
          disabled={!!blocker || !startAt || !endAt || !type || !plateValue || quoting}
          testID="reserve-submit"
        />
      )}
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
  centered: { alignItems: 'center', justifyContent: 'center' },
  location: {
    ...theme.typography.h3,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.md,
  },
  label: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  dropdown: { maxWidth: '100%', alignSelf: 'flex-start' },
  vehicleCard: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
  },
  vehicleLine: { ...theme.typography.body, color: theme.colors.text.primary },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    ...theme.typography.body,
    color: theme.colors.text.primary,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  checkMark: { fontSize: 18, color: theme.colors.text.primary },
  checkLabel: { ...theme.typography.body, color: theme.colors.text.primary },
  timeRow: { flexDirection: 'row', gap: theme.spacing.sm },
  timeField: { flex: 1 },
  price: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginBottom: theme.spacing.sm,
  },
});
