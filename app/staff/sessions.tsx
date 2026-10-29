import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { WorkspaceNav } from '../../src/components/WorkspaceNav';
import { supabase } from '../../src/lib/supabase';
import { firstParam } from '../../src/lib/params';
import { useAuthStore } from '../../src/stores/authStore';
import {
  canManageListings,
  loadMyMemberships,
  roleForLocation,
} from '../../src/lib/operatorAccess';
import { formatLocalDateTime, formatPeso, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';
import { DateTimeField } from '../../src/components/DateTimeField';
import { deliverReturnedPush } from '../../src/lib/push';

export default function SessionsScreen() {
  const locationId = firstParam(
    useLocalSearchParams<{ locationId?: string | string[] }>().locationId
  );
  const user = useAuthStore((s) => s.user);
  const [sessions, setSessions] = useState<any[]>([]);
  const [showWaiver, setShowWaiver] = useState(true);
  const [locationName, setLocationName] = useState('Listing');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [waiverNote, setWaiverNote] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSuccess, setCloseSuccess] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
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
    (async () => {
      if (!locationId || !user) return;
      const { data: loc } = await supabase
        .from('locations')
        .select('id, name, operator_id, operators(staff_can_waive)')
        .eq('id', locationId)
        .single();
      if (loc?.name) setLocationName(loc.name);
      const memberships = await loadMyMemberships(user.id);
      const role = loc ? roleForLocation(memberships, loc as any) : null;
      const staffCanWaive = !!(loc as any)?.operators?.staff_can_waive;
      setShowWaiver(canManageListings(role || undefined) || staffCanWaive);
    })();
  }, [locationId, user]);

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
            folio_charges(amount, type),
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

  const livePreview = (item: any) => previews[item.id] || null;

  const applyPreset = async (sessionId: string, preset: any) => {
    setApplyNotice(null);
    setCloseError(null);
    const { data, error: rpcError } = await supabase.rpc('apply_fee_preset', {
      p_session_id: sessionId,
      p_preset_id: preset.id,
    });
    if (rpcError || data?.error) {
      setCloseError(rpcError?.message || String(data?.error));
      return;
    }
    setApplyNotice(`Applied ${preset.name} ${formatPeso(data.amount)}`);
    await loadSessions();
  };

  const handleClose = async (sessionId: string) => {
    setClosing(true);
    setCloseError(null);
    setCloseSuccess(null);
    try {
      const cash = Number(cashAmount);
      const { data, error: rpcError } = await supabase.rpc('end_session', {
        p_session_id: sessionId,
        p_cash_amount: Number.isFinite(cash) ? cash : 0,
        p_waive_note: showWaiver ? waiverNote.trim() || null : null,
      });

      if (rpcError) throw rpcError;
      if (data?.error === 'waiver_note_required') {
        setCloseError(
          `Waiver required: ₱${Number(data.balance).toFixed(2)} still due after partial cash. Enter a waiver note.`
        );
        return;
      }
      if (data?.error === 'waiver_not_allowed') {
        setCloseError('Staff cannot waive at this operator (staff_can_waive is off).');
        return;
      }
      if (data?.error) {
        setCloseError(String(data.error));
        return;
      }

      setCloseSuccess('Session closed');
      setSelectedId(null);
      await deliverReturnedPush(data, 'Session ended', 'A walk-in session was closed');
      await loadSessions();
    } catch (err: any) {
      setCloseError(err.message || 'Close failed');
    } finally {
      setClosing(false);
    }
  };

  const renderSession = ({ item }: { item: any }) => {
    const preview = livePreview(item);
    const balance = Number(preview?.live_balance ?? 0);
    const parkingSoFar = Number(preview?.parking_so_far ?? 0);
    const extraFees = Number(preview?.extra_fees ?? 0);
    const isOverdue = item.status === 'overdue';
    const open = selectedId === item.id;
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
          title={open ? 'Cancel close' : 'End Session'}
          size="small"
          testID={`end-session-${item.plate}`}
          onPress={() => {
            setSelectedId(open ? null : item.id);
            setCloseError(null);
            setCloseSuccess(null);
          }}
        />

        {open && (
          <View style={styles.closeForm} testID="session-close-form">
            <Text style={styles.label}>Parking so far {formatPeso(parkingSoFar)}</Text>
            <Text style={styles.label}>Extra fees {formatPeso(extraFees)}</Text>
            <Text style={styles.sessionBalance}>Balance due {formatPeso(balance)}</Text>
            <Text style={styles.label}>Cash collected (₱)</Text>
            <TextInput
              style={styles.input}
              value={cashAmount}
              onChangeText={setCashAmount}
              keyboardType="numeric"
              testID="session-cash-amount"
            />
            {showWaiver ? (
              <>
                <Text style={styles.label}>Waiver note (required if balance remains)</Text>
                <TextInput
                  style={styles.input}
                  value={waiverNote}
                  onChangeText={setWaiverNote}
                  placeholder="Reason for waiver"
                  testID="session-waiver-note"
                />
              </>
            ) : (
              <Text style={styles.label} testID="session-waiver-disabled">
                Waivers are limited to owners and managers at this operator.
              </Text>
            )}
            {closeError ? (
              <Text style={styles.alertText} testID="waiver-alert">
                {closeError}
              </Text>
            ) : null}
            {Platform.OS === 'web' ? (
              <div
                data-testid="session-close-submit"
                onClick={() => handleClose(item.id)}
                style={{
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  textAlign: 'center',
                  padding: 12,
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Close with payment
              </div>
            ) : (
              <Button
                title="Close with payment"
                loading={closing}
                onPress={() => handleClose(item.id)}
                testID="session-close-submit"
              />
            )}
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container} testID="sessions-loading">
        <WorkspaceNav listingId={locationId} />
        <View style={styles.centered}>
          <Text>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container} testID="sessions-error">
        <WorkspaceNav listingId={locationId} />
        <View style={styles.centered}>
          <Text style={styles.alertText}>Error: {error}</Text>
          <Button title="Retry" onPress={loadSessions} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="sessions-ready">
      <WorkspaceNav listingId={locationId} />
      <View style={styles.header}>
        <Text style={styles.title}>Active Sessions</Text>
        <Text style={styles.subtitle}>
          {locationName} · {sessions.length} active
        </Text>
      </View>

      {closeSuccess ? (
        <Text style={styles.successBanner} testID="session-closed">
          {closeSuccess}
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
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadSessions}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No active sessions</Text>
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
  title: {
    ...theme.typography.h2,
    color: '#fff',
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
