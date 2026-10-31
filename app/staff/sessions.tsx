import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { formatLocalDateTime, formatPeso, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';
import { DateTimeField } from '../../src/components/DateTimeField';
import { deliverReturnedPush } from '../../src/lib/push';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { sessionWaived } from '../../src/lib/walkIn';

export default function SessionsScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const sp = useLocalSearchParams<{
    locationId?: string | string[];
    checkedIn?: string | string[];
    ended?: string | string[];
  }>();
  const locationId = firstParam(sp.locationId);
  const checkedIn = firstParam(sp.checkedIn);
  const ended = firstParam(sp.ended);
  const [sessions, setSessions] = useState<any[]>([]);
  const [showEnded, setShowEnded] = useState(false);
  const [endedSessions, setEndedSessions] = useState<any[]>([]);
  const [locationName, setLocationName] = useState('Listing');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [driverReviews, setDriverReviews] = useState<Record<string, any[]>>({});
  const [driverRating, setDriverRating] = useState(5);
  const [driverComment, setDriverComment] = useState('On time, clear plate');
  const [driverNotice, setDriverNotice] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, any>>({});
  const [overrideReason, setOverrideReason] = useState('Arrived early');
  const [overrideStart, setOverrideStart] = useState('');
  const [overrideEnd, setOverrideEnd] = useState('');
  const [amountDue, setAmountDue] = useState('');
  const [overrideNotice, setOverrideNotice] = useState<string | null>(null);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [extendHours, setExtendHours] = useState('1');

  // Reload when coming back from a session page (edits, payments, end).
  const firstFocus = React.useRef(true);
  useFocusEffect(
    React.useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      loadSessions();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  useEffect(() => {
    loadSessions();
    supabase
      .from('fee_presets')
      .select('*')
      .eq('active', true)
      .then(({ data }) => setPresets(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    supabase
      .from('locations')
      .select('name')
      .eq('id', locationId)
      .single()
      .then(({ data }) => {
        if (data?.name) setLocationName(data.name);
      });
  }, [locationId]);

  const loadSessions = async () => {
    try {
      setError(null);
      await supabase.rpc('refresh_overdue');
      let query = supabase
        .from('parking_sessions')
        .select(
          `
          *,
          locations(name),
          folios(
            id,
            status,
            folio_charges(amount, type, voided_at),
            payments(amount)
          )
        `
        )
        .in('status', ['active', 'overdue'])
        .order('started_at', { ascending: false });
      if (locationId) query = query.eq('location_id', locationId);
      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setSessions(data || []);
      const next: Record<string, any> = {};
      await Promise.all(
        (data || []).map(async (s: any) => {
          const { data: preview } = await supabase.rpc('session_balance_preview', {
            p_session_id: s.id,
          });
          if (preview?.success) next[s.id] = preview;
        })
      );
      setPreviews(next);
      const driverIds = [...new Set((data || []).map((s: any) => s.driver_id).filter(Boolean))];
      if (driverIds.length) {
        const { data: reviews } = await supabase
          .from('driver_reviews')
          .select('id, driver_id, rating, comment, author_id')
          .in('driver_id', driverIds);
        const grouped: Record<string, any[]> = {};
        (reviews || []).forEach((r) => {
          grouped[r.driver_id] = grouped[r.driver_id] || [];
          grouped[r.driver_id].push(r);
        });
        setDriverReviews(grouped);
      }
    } catch (err: any) {
      console.error('Load sessions error:', err);
      setError(err.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  // Ended in the last 7 days (with any waived amount), shown under the active list.
  const loadEnded = async () => {
    let query = supabase
      .from('parking_sessions')
      .select(
        'id, plate, vehicle_type, started_at, ended_at, location_id, folios(folio_charges(amount, type, voided_at))'
      )
      .eq('status', 'ended')
      .gte('ended_at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
      .order('ended_at', { ascending: false })
      .limit(50);
    if (locationId) query = query.eq('location_id', locationId);
    const { data } = await query;
    setEndedSessions(data || []);
  };

  React.useEffect(() => {
    if (showEnded) loadEnded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEnded, sessions]);

  const livePreview = (item: any) => previews[item.id] || null;

  const applyPreset = async (sessionId: string, preset: any) => {
    setApplyNotice(null);
    const { data, error: rpcError } = await supabase.rpc('apply_fee_preset', {
      p_session_id: sessionId,
      p_preset_id: preset.id,
    });
    if (rpcError || data?.error) {
      setOverrideNotice(rpcError?.message || String(data?.error));
      return;
    }
    setApplyNotice(`Applied ${preset.name} ${formatPeso(data.amount)}`);
    await loadSessions();
  };

  const renderSession = ({ item }: { item: any }) => {
    const preview = livePreview(item);
    const balance = Number(preview?.live_balance ?? 0);
    const parkingSoFar = Number(preview?.parking_so_far ?? 0);
    const extraFees = Number(preview?.extra_fees ?? 0);
    const isOverdue = item.status === 'overdue';
    const overdueMin = Number(
      item.overdue_minutes ||
        (item.scheduled_end_at
          ? Math.max(
              0,
              Math.floor((Date.now() - new Date(item.scheduled_end_at).getTime()) / 60000)
            )
          : 0)
    );

    return (
      <View
        style={[styles.sessionCard, isOverdue && styles.sessionCardOverdue]}
        testID={`session-row-${item.plate}`}
      >
        <View style={styles.sessionHeader}>
          <View>
            <Text style={styles.sessionPlate}>{item.plate || 'Unknown'}</Text>
            <Text style={styles.sessionType}>{item.vehicle_type || 'car'}</Text>
          </View>
          {isOverdue && (
            <View style={styles.overdueBadge} testID={`overdue-badge-${item.plate}`}>
              <Text style={styles.overdueBadgeText}>OVERDUE</Text>
            </View>
          )}
          {sessionWaived(item) > 0 ? (
            <View style={styles.waivedBadge} testID={`waived-${item.plate}`}>
              <Text style={styles.waivedBadgeText}>Waived {formatPeso(sessionWaived(item))}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sessionDetails}>
          <Text style={styles.sessionTime}>
            Started: {formatLocalDateTime(item.started_at)} ({formatRelativeTime(item.started_at)})
          </Text>
          {item.scheduled_end_at ? (
            <Text style={styles.sessionTime} testID={`scheduled-end-${item.plate}`}>
              Scheduled end: {formatLocalDateTime(item.scheduled_end_at)}
            </Text>
          ) : null}
          <Text style={styles.sessionLocation}>{item.locations?.name}</Text>
          <Text style={styles.sessionTime} testID={`parking-so-far-${item.plate}`}>
            Parking so far: {formatPeso(parkingSoFar)}
          </Text>
          {extraFees ? (
            <Text style={styles.sessionTime} testID={`extra-fees-${item.plate}`}>
              Extra fees: {formatPeso(extraFees)}
            </Text>
          ) : null}
          <Text style={styles.sessionBalance} testID={`session-balance-${item.plate}`}>
            Balance: {formatPeso(balance)}
          </Text>
          {isOverdue ? (
            <Text style={styles.overdueTime} testID={`overdue-time-${item.plate}`}>
              Overdue {Math.floor(overdueMin / 60)}h {overdueMin % 60}m, not billed unless end time
              or amount is edited
            </Text>
          ) : null}
        </View>

        <Button
          title="Open"
          size="small"
          testID={`session-open-${item.plate}`}
          onPress={() =>
            router.push({
              pathname: '/staff/session',
              params: { id: item.id, locationId: item.location_id },
            })
          }
          style={{ marginBottom: theme.spacing.sm }}
        />

        <Button
          title={adjustId === item.id ? 'Hide adjustments' : 'Adjust times / amount'}
          size="small"
          variant="outline"
          testID={`session-adjust-toggle-${item.plate}`}
          onPress={() => setAdjustId(adjustId === item.id ? null : item.id)}
          style={{ marginBottom: theme.spacing.sm }}
        />

        {adjustId === item.id ? (
          <View style={styles.adjustBox} testID={`session-adjust-${item.plate}`}>
            <Text style={styles.label}>Adjust times / amount (reason required)</Text>
            <TextInput
              style={styles.input}
              value={overrideReason}
              onChangeText={setOverrideReason}
              placeholder="Reason"
              testID={`override-reason-${item.plate}`}
            />
            <Text style={styles.label}>Start time</Text>
            <DateTimeField
              valueUtc={overrideStart || item.started_at}
              onChangeUtc={setOverrideStart}
              testID={`override-start-${item.plate}`}
            />
            <Button
              title="Save start time"
              size="small"
              testID={`override-start-save-${item.plate}`}
              onPress={async () => {
                setOverrideNotice(null);
                const { data, error: rpcError } = await supabase.rpc('override_session_start', {
                  p_session_id: item.id,
                  p_started_at: overrideStart || item.started_at,
                  p_reason: overrideReason.trim(),
                });
                if (rpcError || data?.error) {
                  setOverrideNotice(rpcError?.message || String(data?.error));
                  return;
                }
                setOverrideNotice('Start time saved');
                await loadSessions();
              }}
            />
            <Text style={styles.label}>Billed end time</Text>
            <DateTimeField
              valueUtc={overrideEnd || item.scheduled_end_at}
              onChangeUtc={setOverrideEnd}
              testID={`override-end-${item.plate}`}
            />
            <Button
              title="Save billed end"
              size="small"
              testID={`override-end-save-${item.plate}`}
              onPress={async () => {
                setOverrideNotice(null);
                const { data, error: rpcError } = await supabase.rpc('override_session_end', {
                  p_session_id: item.id,
                  p_ended_at: overrideEnd || item.scheduled_end_at,
                  p_reason: overrideReason.trim(),
                });
                if (rpcError || data?.error) {
                  setOverrideNotice(rpcError?.message || String(data?.error));
                  return;
                }
                setOverrideNotice('Billed end saved');
                await loadSessions();
              }}
            />
            <Text style={styles.label}>Amount due (₱)</Text>
            <TextInput
              style={styles.input}
              value={amountDue}
              onChangeText={setAmountDue}
              keyboardType="numeric"
              testID={`amount-due-${item.plate}`}
            />
            <Button
              title="Save amount due"
              size="small"
              testID={`amount-due-save-${item.plate}`}
              onPress={async () => {
                setOverrideNotice(null);
                const { data, error: rpcError } = await supabase.rpc('edit_amount_due', {
                  p_session_id: item.id,
                  p_amount: Number(amountDue),
                  p_reason: overrideReason.trim(),
                });
                if (rpcError || data?.error) {
                  setOverrideNotice(rpcError?.message || String(data?.error));
                  return;
                }
                setOverrideNotice(`Amount due ${formatPeso(data.amount_due)}`);
                await loadSessions();
              }}
            />
          </View>
        ) : null}

        {item.driver_id ? (
          <View style={styles.driverReviewBox} testID={`driver-review-${item.plate}`}>
            <Text style={styles.label}>Review driver</Text>
            {(driverReviews[item.driver_id] || []).map((r) => (
              <Text key={r.id} style={styles.sessionTime}>
                {'⭐'.repeat(r.rating)} {r.comment}
              </Text>
            ))}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Button
                  key={n}
                  title={`${n}`}
                  size="small"
                  variant={driverRating === n ? 'primary' : 'outline'}
                  onPress={() => setDriverRating(n)}
                />
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={driverComment}
              onChangeText={setDriverComment}
              testID="driver-review-comment"
            />
            <Button
              title="Save driver review"
              size="small"
              testID="driver-review-submit"
              onPress={async () => {
                setDriverNotice(null);
                const { data, error: rpcError } = await supabase.rpc('submit_driver_review', {
                  p_session_id: item.id,
                  p_rating: driverRating,
                  p_comment: driverComment.trim() || null,
                });
                if (rpcError || data?.error) {
                  setDriverNotice(rpcError?.message || String(data?.error));
                  return;
                }
                setDriverNotice('Driver review saved');
                await loadSessions();
              }}
            />
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: theme.spacing.sm }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={extendHours}
            onChangeText={setExtendHours}
            keyboardType="numeric"
            testID={`extend-hours-${item.plate}`}
          />
          <Button
            title="Extend"
            size="small"
            testID={`extend-session-${item.plate}`}
            onPress={async () => {
              setOverrideNotice(null);
              const { data, error: rpcError } = await supabase.rpc('extend_session', {
                p_session_id: item.id,
                p_hours: Number(extendHours) || 1,
                p_reason: overrideReason.trim() || 'Extended',
              });
              if (rpcError || data?.error) {
                setOverrideNotice(rpcError?.message || String(data?.error));
                return;
              }
              setOverrideNotice('Session extended');
              await deliverReturnedPush(
                data,
                'Session extended',
                `${item.plate} extended by ${extendHours}h`
              );
              await loadSessions();
            }}
          />
        </View>

        {presets.map((preset) => (
          <Button
            key={preset.id}
            title={`Apply ${preset.name}`}
            size="small"
            variant="outline"
            onPress={() => applyPreset(item.id, preset)}
            testID={`session-apply-${preset.name}`}
            style={{ marginBottom: theme.spacing.sm }}
          />
        ))}

        <Button
          title="End Session"
          size="small"
          testID={`end-session-${item.plate}`}
          onPress={() =>
            router.push({
              pathname: '/staff/session',
              params: { id: item.id, locationId: item.location_id },
            })
          }
        />
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container} testID="sessions-loading">
        <View style={styles.centered}>
          <Text>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container} testID="sessions-error">
        <View style={styles.centered}>
          <Text style={styles.alertText}>Error: {error}</Text>
          <Button title="Retry" onPress={loadSessions} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="sessions-ready">
      <View style={styles.header}>
        <Text style={styles.subtitle}>
          {locationName} · {sessions.length} active
        </Text>
      </View>

      {checkedIn ? (
        <Text style={styles.successBanner} testID="checkin-success">
          Checked in {checkedIn}
        </Text>
      ) : null}
      {ended ? (
        <Text style={styles.successBanner} testID="session-closed">
          Session ended: {ended}
        </Text>
      ) : null}
      {applyNotice ? (
        <Text style={styles.successBanner} testID="fee-applied">
          {applyNotice}
        </Text>
      ) : null}
      {driverNotice ? (
        <Text style={styles.successBanner} testID="driver-review-saved">
          {driverNotice}
        </Text>
      ) : null}
      {overrideNotice ? (
        <Text style={styles.successBanner} testID="override-saved">
          {overrideNotice}
        </Text>
      ) : null}

      <FlatList
        data={sessions}
        renderItem={renderSession}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, bottomInset]}
        refreshing={loading}
        onRefresh={loadSessions}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No active sessions</Text>
          </View>
        }
        ListFooterComponent={
          <View style={{ marginTop: theme.spacing.md }}>
            <Button
              title={showEnded ? 'Hide ended sessions' : 'Show ended sessions (last 7 days)'}
              size="small"
              variant="outline"
              onPress={() => setShowEnded(!showEnded)}
              testID="ended-toggle"
            />
            {showEnded ? (
              endedSessions.length ? (
                endedSessions.map((e) => (
                  <View key={e.id} style={styles.sessionCard} testID={`ended-row-${e.plate}`}>
                    <View style={styles.sessionHeader}>
                      <View>
                        <Text style={styles.sessionPlate}>{e.plate}</Text>
                        <Text style={styles.sessionType}>
                          Ended {formatLocalDateTime(e.ended_at)}
                        </Text>
                      </View>
                      {sessionWaived(e) > 0 ? (
                        <View style={styles.waivedBadge} testID={`waived-${e.plate}`}>
                          <Text style={styles.waivedBadgeText}>
                            Waived {formatPeso(sessionWaived(e))}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Button
                      title="Open"
                      size="small"
                      variant="outline"
                      testID={`ended-open-${e.plate}`}
                      onPress={() =>
                        router.push({
                          pathname: '/staff/session',
                          params: { id: e.id, locationId: e.location_id },
                        })
                      }
                    />
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No sessions ended in the last 7 days</Text>
              )
            ) : null}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
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
  list: {
    padding: theme.spacing.lg,
  },
  sessionCard: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.md,
    ...theme.shadows.md,
  },
  sessionCardOverdue: {
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.danger,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  sessionPlate: {
    ...theme.typography.h3,
  },
  sessionType: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
  },
  waivedBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: '#fef3c7',
    borderRadius: theme.borderRadius.sm,
  },
  waivedBadgeText: {
    ...theme.typography.caption,
    color: '#92400e',
    fontWeight: '700',
  },
  overdueBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.danger,
    borderRadius: theme.borderRadius.sm,
  },
  overdueBadgeText: {
    ...theme.typography.caption,
    color: '#fff',
    fontWeight: '700',
  },
  sessionDetails: {
    marginBottom: theme.spacing.md,
  },
  sessionTime: {
    ...theme.typography.body,
    marginBottom: theme.spacing.xs,
  },
  sessionLocation: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  sessionBalance: {
    ...theme.typography.h3,
    color: theme.colors.primary,
  },
  closeForm: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  label: {
    ...theme.typography.bodySmall,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
  alertText: {
    ...theme.typography.body,
    color: theme.colors.danger,
    marginVertical: theme.spacing.sm,
  },
  successBanner: {
    ...theme.typography.body,
    color: theme.colors.success,
    padding: theme.spacing.md,
  },
  emptyState: {
    padding: theme.spacing.xxl,
    alignItems: 'center',
  },
  emptyText: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
  },
  driverReviewBox: {
    marginBottom: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  overdueTime: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginTop: theme.spacing.xs,
  },
  adjustBox: {
    marginBottom: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
});
