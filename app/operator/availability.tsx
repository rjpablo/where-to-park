import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { formatLocalDateTime } from '../../src/utils/formatters';
import { firstParam } from '../../src/lib/params';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { SessionSummary, sessionCardStyles } from '../../src/components/SessionSummary';
import { fetchActiveSessions } from '../../src/lib/activeSessions';
import { filterByPlate } from '../../src/lib/walkIn';
import { FilterDropdown } from '../../src/components/FilterDropdown';
import {
  AREA_SELECT,
  areaErrorMessage,
  areaStatusText,
  defaultAreaId,
  listingAvailability,
  sortAreas,
  type Area,
} from '../../src/lib/areas';

export default function AvailabilityScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(0);
  const router = useRouter();
  const sp = useLocalSearchParams<{
    locationId?: string | string[];
    checkedIn?: string | string[];
    reserved?: string | string[];
    ended?: string | string[];
    cancelled?: string | string[];
    slots?: string | string[];
    areaId?: string | string[];
  }>();
  const locationId = firstParam(sp.locationId);
  const checkedIn = firstParam(sp.checkedIn);
  const reservedSaved = firstParam(sp.reserved) === '1';
  const endedPlate = firstParam(sp.ended);
  const cancelledPlate = firstParam(sp.cancelled);
  const slotsSaved = firstParam(sp.slots) === 'saved';
  const areaParam = firstParam(sp.areaId);
  // Sessions only (rj t136u/t137u): the count from sessions (counted_spaces), the pencil to
  // the Available slots editor, the Full switch and the active sessions. No tabs.
  const [sessions, setSessions] = useState<any[]>([]);
  const [previews, setPreviews] = useState<Record<string, any>>({});
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [plateQuery, setPlateQuery] = useState('');
  const [location, setLocation] = useState<any>(null);
  // rj t139u: availability is managed per area; the dropdown picks which (Main by default,
  // the only choice when Main is the only area).
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaId, setAreaId] = useState<string | null>(areaParam ?? null);
  const [savingFull, setSavingFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Coming back with an area (check-in, slots editor): show that one.
  useEffect(() => {
    if (areaParam) setAreaId(areaParam);
  }, [areaParam]);

  useEffect(() => {
    loadLocationData();
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  // Coming back from a session page or check-in (added / ended / cancelled): reload.
  const firstFocus = React.useRef(true);
  useFocusEffect(
    React.useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      loadLocationData();
      loadSessions();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locationId])
  );

  const loadSessions = async () => {
    if (!locationId) return;
    try {
      setSessionsError(null);
      const res = await fetchActiveSessions(locationId);
      setSessions(res.sessions);
      setPreviews(res.previews);
    } catch (err: any) {
      setSessionsError(err?.message || 'Failed to load sessions');
    } finally {
      setSessionsLoaded(true);
    }
  };

  const loadLocationData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!locationId) {
        throw new Error('Pick a listing from My listings');
      }
      const [{ data: locations, error: locError }, { data: areaRows, error: areaError }] =
        await Promise.all([
          supabase
            .from('locations')
            .select('*, free_spaces, counted_spaces, listing_full')
            .eq('id', locationId)
            .single(),
          supabase.from('areas').select(AREA_SELECT).eq('location_id', locationId),
        ]);

      if (locError) throw locError;
      if (areaError) throw areaError;
      const sorted = sortAreas((areaRows || []) as unknown as Area[]);
      setAreas(sorted);
      setAreaId((cur) => defaultAreaId(sorted, cur));

      if (locations) {
        setLocation(locations);
      }
    } catch (err: any) {
      console.error('Load error:', err);
      setError(err.message || 'Failed to load location data');
    } finally {
      setLoading(false);
    }
  };

  // Full switch (rj t137u) / Available-Full toggle (unmonitored), per area (0067).
  const setFull = async (full: boolean) => {
    const target = areas.find((x) => x.id === areaId);
    if (!target) return;
    setNotice(null);
    setSavingFull(true);
    const prev = areas;
    setAreas(areas.map((x) => (x.id === target.id ? { ...x, marked_full: full } : x)));
    try {
      const { data, error: rpcError } = await supabase.rpc('set_area_full', {
        p_area_id: target.id,
        p_full: full,
      });
      if (rpcError || data?.error) {
        setAreas(prev);
        setNotice(rpcError?.message || areaErrorMessage(data?.error));
        return;
      }
      await loadLocationData();
    } finally {
      setSavingFull(false);
    }
  };

  if (loading && !location) {
    return (
      <View style={[styles.container, styles.centered]} testID="availability-loading">
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (error && !location) {
    return (
      <View style={[styles.container, styles.centered]} testID="availability-error">
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity onPress={loadLocationData} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>No locations found</Text>
      </View>
    );
  }

  const area = areas.find((x) => x.id === areaId) || null;
  const full = !!area?.marked_full;
  const monitored = area ? area.monitored : true;
  const areaSessions = area ? sessions.filter((x) => x.area_id === area.id) : sessions;
  const shownSessions = filterByPlate(areaSessions, plateQuery);
  const listing = listingAvailability(location.free_spaces, !location.listing_full);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="availability-ready"
    >
      <View style={styles.header}>
        <Text style={styles.subtitle}>{location.name}</Text>
      </View>

      <View style={styles.areaBar}>
        <Text style={styles.areaBarLabel}>Area</Text>
        <FilterDropdown<string>
          label="Area"
          showLabel={false}
          value={areaId}
          options={areas.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(v) => v && setAreaId(v)}
          highlightActive={false}
          style={styles.areaDropdown}
          testID="availability-area"
        />
      </View>
      {areas.length > 1 ? (
        <Text style={styles.listingTotal} testID="availability-listing-total">
          Whole listing: {listing.full ? 'Full' : listing.text}
          {listing.full ? ' (every area is full)' : ''}
        </Text>
      ) : null}

      <View style={styles.countDisplay}>
        {full ? (
          <Text style={styles.fullText} testID="availability-full">
            Mark as FULL
          </Text>
        ) : null}
        {monitored ? (
          <>
            <Text style={styles.countLabel}>Available Spaces</Text>
            <View style={styles.countRow}>
              <Text style={styles.countNumber} testID="availability-status">
                {area ? areaStatusText(area) : '-'}
              </Text>
              <TouchableOpacity
                style={styles.pencil}
                onPress={() =>
                  area &&
                  router.push({
                    pathname: '/operator/slots-editor',
                    params: { locationId: location.id, areaId: area.id },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Edit reserved and unavailable spaces"
                hitSlop={8}
                testID="slots-edit"
              >
                <Text style={styles.pencilText}>✎</Text>
              </TouchableOpacity>
            </View>
            {full ? (
              <Text style={styles.fullNote} testID="availability-full-note">
                Drivers see this area as Full (0 spots)
              </Text>
            ) : null}
          </>
        ) : (
          <>
            {/* Not monitored (rj t139u): no number, staff switch Available / Full. */}
            <Text style={styles.countLabel}>Spots not monitored</Text>
            <View style={styles.statusToggle} testID="availability-status-toggle">
              {[
                { key: 'available', label: 'Available', on: !full, value: false },
                { key: 'full', label: 'Full', on: full, value: true },
              ].map((o) => (
                <TouchableOpacity
                  key={o.key}
                  style={[
                    styles.statusOption,
                    o.on && (o.value ? styles.statusOptionFull : styles.statusOptionOpen),
                  ]}
                  onPress={() => !o.on && setFull(o.value)}
                  disabled={savingFull}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: o.on }}
                  testID={`availability-status-${o.key}`}
                >
                  <Text style={[styles.statusOptionText, o.on && styles.statusOptionTextOn]}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <Text style={styles.countUpdated}>
          Updated {formatLocalDateTime(location.availability_updated_at)}
        </Text>
        {monitored ? (
          <View style={styles.fullRow}>
            <Text style={styles.fullLabel}>Full</Text>
            <Switch
              value={full}
              onValueChange={setFull}
              disabled={savingFull || !area}
              trackColor={{ true: theme.colors.danger, false: theme.colors.border }}
              accessibilityLabel="Mark this area as full"
              testID="full-switch"
            />
          </View>
        ) : null}
        {notice ? (
          <Text style={styles.errorText} testID="full-error">
            {notice}
          </Text>
        ) : null}
      </View>

      <View style={styles.section} testID="sessions-tab">
        {slotsSaved ? (
          <Text style={styles.successText} testID="availability-slots-saved">
            Held spaces saved
          </Text>
        ) : null}
        {checkedIn ? (
          <Text style={styles.successText} testID="availability-checked-in">
            {reservedSaved ? 'Reservation saved for' : 'Checked in'} {checkedIn}
          </Text>
        ) : null}
        {endedPlate ? (
          <Text style={styles.successText} testID="availability-session-ended">
            Session ended: {endedPlate}
          </Text>
        ) : null}
        {cancelledPlate ? (
          <Text style={styles.successText} testID="availability-reservation-cancelled">
            Reservation cancelled: {cancelledPlate}
          </Text>
        ) : null}
        <View style={styles.sessionsHead}>
          <Text style={[styles.sectionTitle, styles.sessionsTitle]} testID="sessions-count">
            Active sessions ({areaSessions.length})
          </Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() =>
              router.push({
                pathname: '/staff/checkin',
                params: {
                  locationId: location.id,
                  from: 'availability',
                  ...(area ? { areaId: area.id } : {}),
                },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Add a session"
            testID="sessions-add"
          >
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.filterInput}
          value={plateQuery}
          onChangeText={setPlateQuery}
          placeholder="Filter by plate number"
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
          testID="sessions-filter"
        />
        {sessionsError ? <Text style={styles.errorText}>{sessionsError}</Text> : null}
        {!sessionsLoaded ? (
          <Text style={styles.activityText}>Loading sessions…</Text>
        ) : shownSessions.length ? (
          shownSessions.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                sessionCardStyles.sessionCard,
                item.status === 'overdue' && sessionCardStyles.sessionCardOverdue,
              ]}
              onPress={() =>
                router.push({
                  pathname: '/staff/session',
                  params: { id: item.id, locationId: item.location_id, from: 'availability' },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Open session ${item.plate || ''}`}
              testID={`avail-session-${item.plate}`}
            >
              <SessionSummary item={item} preview={previews[item.id] || null} />
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.activityText} testID="sessions-empty">
            {areaSessions.length ? 'No sessions match this plate' : 'No active sessions'}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
  },
  subtitle: {
    ...theme.typography.body,
    color: '#fff',
    opacity: 0.9,
    marginTop: theme.spacing.xs,
  },
  modeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  areaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  areaBarLabel: { ...theme.typography.body, fontWeight: '700' },
  areaDropdown: { flex: 1 },
  listingTotal: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xs,
  },
  statusToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    overflow: 'hidden',
    marginVertical: theme.spacing.md,
  },
  statusOption: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  statusOptionOpen: { backgroundColor: theme.colors.available },
  statusOptionFull: { backgroundColor: theme.colors.danger },
  statusOptionText: { ...theme.typography.body, fontWeight: '700' },
  statusOptionTextOn: { color: '#fff' },
  fullText: {
    color: theme.colors.danger,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  fullNote: { ...theme.typography.bodySmall, color: theme.colors.danger, marginTop: -4 },
  fullRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  fullLabel: { ...theme.typography.body, fontWeight: '700' },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  pencil: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.md,
  },
  pencilText: { color: '#fff', fontSize: 20, lineHeight: 22 },
  modeSwitch: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    padding: theme.spacing.sm,
  },
  modeSwitchText: {
    ...theme.typography.bodySmall,
    color: theme.colors.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  heldBox: {
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  heldTitle: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  modeChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modeChipOn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  modeChipText: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
  },
  modeChipTextOn: {
    color: '#fff',
  },
  countDisplay: {
    alignItems: 'center',
    padding: theme.spacing.xxl,
    backgroundColor: theme.colors.surface,
    margin: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadows.md,
  },
  countLabel: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
  },
  countNumber: {
    ...theme.typography.h1,
    fontSize: 48,
    color: theme.colors.primary,
    marginVertical: theme.spacing.md,
  },
  countUpdated: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  adjustButton: {
    flex: 1,
    height: 80,
    borderRadius: theme.borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.md,
  },
  decrementButton: {
    backgroundColor: theme.colors.danger,
  },
  incrementButton: {
    backgroundColor: theme.colors.success,
  },
  adjustButtonText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  section: {
    padding: theme.spacing.lg,
  },
  sectionTitle: {
    ...theme.typography.h3,
    marginBottom: theme.spacing.md,
  },
  manualRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  manualItem: {
    flex: 1,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
  },
  manualLabel: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surfaceDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperValue: {
    ...theme.typography.h3,
  },
  sessionsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  sessionsTitle: { marginBottom: 0 },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.md,
  },
  addButtonText: { color: '#fff', fontSize: 28, lineHeight: 30, fontWeight: '700' },
  filterInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.background,
    ...theme.typography.body,
  },
  successText: {
    ...theme.typography.body,
    color: theme.colors.success,
    marginBottom: theme.spacing.sm,
  },
  activityItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  activityText: {
    ...theme.typography.body,
  },
  activityTime: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  loadingText: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.colors.danger,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  retryButton: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
  },
  retryButtonText: {
    ...theme.typography.button,
    color: '#fff',
  },
});
