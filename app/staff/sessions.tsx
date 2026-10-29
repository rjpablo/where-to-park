import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { formatPeso, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('parking_sessions')
        .select(
          `
          *,
          vehicles(plate, vehicle_type),
          locations(name),
          folios(
            balance,
            folio_charges(amount, charge_type),
            payments(amount)
          )
        `
        )
        .in('status', ['active', 'overdue'])
        .order('started_at', { ascending: false });

      if (error) throw error;
      setSessions(data || []);
    } catch (error) {
      console.error('Load sessions error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEndSession = async (sessionId: string, totalDue: number) => {
    Alert.alert('End Session', `Total due: ${formatPeso(totalDue)}. Collect payment?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Collect Cash',
        onPress: async () => {
          try {
            const { error } = await supabase.rpc('end_session', {
              p_session_id: sessionId,
              p_cash_collected: totalDue,
              p_note: null,
            });

            if (error) throw error;

            Alert.alert('Success', 'Session ended and payment recorded');
            loadSessions();
          } catch (error: any) {
            Alert.alert('Error', error.message);
          }
        },
      },
      {
        text: 'Waive',
        style: 'destructive',
        onPress: async () => {
          Alert.prompt('Waive Balance', 'Enter reason for waiver', async (reason) => {
            if (!reason?.trim()) {
              Alert.alert('Error', 'Reason is required for waivers');
              return;
            }

            try {
              const { error } = await supabase.rpc('end_session', {
                p_session_id: sessionId,
                p_cash_collected: 0,
                p_note: `Waived: ${reason}`,
              });

              if (error) throw error;

              Alert.alert('Success', 'Balance waived and session ended');
              loadSessions();
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          });
        },
      },
    ]);
  };

  const renderSession = ({ item }: { item: any }) => {
    const folio = item.folios?.[0];
    const balance = folio?.balance || 0;
    const isOverdue = item.status === 'overdue';

    return (
      <View style={[styles.sessionCard, isOverdue && styles.sessionCardOverdue]}>
        <View style={styles.sessionHeader}>
          <View>
            <Text style={styles.sessionPlate}>{item.vehicles?.plate || 'Unknown'}</Text>
            <Text style={styles.sessionType}>{item.vehicles?.vehicle_type || 'car'}</Text>
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
          <Text style={styles.sessionBalance}>Balance: {formatPeso(balance)}</Text>
        </View>

        <View style={styles.sessionActions}>
          <Button
            title="Add Fee"
            variant="outline"
            size="small"
            onPress={() => {
              /* Open add fee dialog */
            }}
          />
          <Button
            title="End Session"
            size="small"
            onPress={() => handleEndSession(item.id, balance)}
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Active Sessions</Text>
        <Text style={styles.subtitle}>{sessions.length} active</Text>
      </View>

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
  sessionBalance: {
    ...theme.typography.h3,
    color: theme.colors.primary,
  },
  sessionActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
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
