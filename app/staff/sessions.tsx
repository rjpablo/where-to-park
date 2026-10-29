import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Platform } from 'react-native';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { formatPeso, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [waiverNote, setWaiverNote] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSuccess, setCloseSuccess] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      setError(null);
      const { data, error: fetchError } = await supabase
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

      if (fetchError) throw fetchError;
      setSessions(data || []);
    } catch (err: any) {
      console.error('Load sessions error:', err);
      setError(err.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const folioBalance = (item: any) => {
    const folio = Array.isArray(item.folios) ? item.folios[0] : item.folios;
    if (!folio) return 0;
    const charges = (folio.folio_charges || []).reduce(
      (sum: number, c: any) => sum + Number(c.amount || 0),
      0
    );
    const paid = (folio.payments || []).reduce(
      (sum: number, p: any) => sum + Number(p.amount || 0),
      0
    );
    return charges - paid;
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
        p_waive_note: waiverNote.trim() || null,
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
      await loadSessions();
    } catch (err: any) {
      setCloseError(err.message || 'Close failed');
    } finally {
      setClosing(false);
    }
  };

  const renderSession = ({ item }: { item: any }) => {
    const balance = folioBalance(item);
    const isOverdue = item.status === 'overdue';
    const open = selectedId === item.id;

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
            <View style={styles.overdueBadge}>
              <Text style={styles.overdueBadgeText}>OVERDUE</Text>
            </View>
          )}
        </View>

        <View style={styles.sessionDetails}>
          <Text style={styles.sessionTime}>
            Started: {formatRelativeTime(new Date(item.started_at))}
          </Text>
          <Text style={styles.sessionLocation}>{item.locations?.name}</Text>
          <Text style={styles.sessionBalance}>Balance: {formatPeso(balance)}</Text>
        </View>

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
            <Text style={styles.label}>Cash collected (₱)</Text>
            <TextInput
              style={styles.input}
              value={cashAmount}
              onChangeText={setCashAmount}
              keyboardType="numeric"
              testID="session-cash-amount"
            />
            <Text style={styles.label}>Waiver note (required if balance remains)</Text>
            <TextInput
              style={styles.input}
              value={waiverNote}
              onChangeText={setWaiverNote}
              placeholder="Reason for waiver"
              testID="session-waiver-note"
            />
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
      <View style={[styles.container, styles.centered]} testID="sessions-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered]} testID="sessions-error">
        <Text style={styles.alertText}>Error: {error}</Text>
        <Button title="Retry" onPress={loadSessions} />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="sessions-ready">
      <View style={styles.header}>
        <Text style={styles.title}>Active Sessions</Text>
        <Text style={styles.subtitle}>{sessions.length} active</Text>
      </View>

      {closeSuccess ? (
        <Text style={styles.successBanner} testID="session-closed">
          {closeSuccess}
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
});
