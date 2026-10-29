import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

export default function VerificationQueueScreen() {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*, operators(display_name)')
        .eq('verification_status', 'unverified')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('Load queue error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (locationId: string) => {
    try {
      const { error } = await supabase.rpc('verify_location', {
        p_location_id: locationId,
      });

      if (error) throw error;

      Alert.alert('Success', 'Location verified');
      loadQueue();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>PENDING</Text>
        </View>
      </View>

      <Text style={styles.cardAddress}>{item.address}</Text>
      <Text style={styles.cardOperator}>Operator: {item.operators?.display_name || 'Unknown'}</Text>
      <Text style={styles.cardTime}>Submitted {formatRelativeTime(new Date(item.created_at))}</Text>

      <View style={styles.cardActions}>
        <Button
          title="View Details"
          variant="outline"
          size="small"
          onPress={() => {
            /* Navigate to location detail */
          }}
        />
        <Button title="Verify" size="small" onPress={() => handleVerify(item.id)} />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Verification Queue</Text>
        <Text style={styles.subtitle}>{locations.length} pending</Text>
      </View>

      <FlatList
        data={locations}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadQueue}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No locations pending verification</Text>
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
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.md,
    ...theme.shadows.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  cardTitle: {
    ...theme.typography.h3,
    flex: 1,
  },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.warning,
    borderRadius: theme.borderRadius.sm,
    marginLeft: theme.spacing.sm,
  },
  badgeText: {
    ...theme.typography.caption,
    color: '#fff',
    fontWeight: '700',
  },
  cardAddress: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  cardOperator: {
    ...theme.typography.bodySmall,
    marginBottom: theme.spacing.xs,
  },
  cardTime: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    marginBottom: theme.spacing.md,
  },
  cardActions: {
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
