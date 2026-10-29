import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';

export default function AvailabilityScreen() {
  const [location, setLocation] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLocationData();
  }, []);

  const loadLocationData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get first location for operator (would use auth context in real app)
      const { data: locations, error: locError } = await supabase
        .from('locations')
        .select('*')
        .eq('id', '30000000-0000-0000-0000-000000000001')
        .single();
      
      if (locError) throw locError;
      
      if (locations) {
        setLocation(locations);
        
        // Load recent sessions as activity
        const { data: sessions, error: sessError } = await supabase
          .from('parking_sessions')
          .select('*, created_at')
          .eq('location_id', locations.id)
          .order('created_at', { ascending: false })
          .limit(5);
        
        if (sessError) throw sessError;
        setRecentActivity(sessions || []);
      }
    } catch (err: any) {
      console.error('Load error:', err);
      setError(err.message || 'Failed to load location data');
    } finally {
      setLoading(false);
    }
  };

  const adjustAvailability = async (delta: number) => {
    if (!location) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('adjust_availability', {
        p_location_id: location.id,
        p_delta: delta,
      });

      if (error) throw error;

      if (data?.available_count !== undefined) {
        setLocation({ ...location, available_count: data.available_count });
      }
      
      await loadLocationData(); // Refresh
    } catch (error: any) {
      console.error('Adjust availability error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]} testID="availability-loading">
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (error) {
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

  return (
    <ScrollView style={styles.container} testID="availability-ready">
      <View style={styles.header}>
        <Text style={styles.title}>Current Availability</Text>
        <Text style={styles.subtitle}>{location.name}</Text>
      </View>

      <View style={styles.countDisplay}>
        <Text style={styles.countLabel}>Available Spaces</Text>
        <Text style={styles.countNumber}>
          {location.available_count} / {location.capacity}
        </Text>
        <Text style={styles.countUpdated}>
          Updated {new Date(location.availability_updated_at).toLocaleTimeString()}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.adjustButton, styles.decrementButton]}
          onPress={() => adjustAvailability(-1)}
          disabled={loading || location.available_count === 0}
        >
          <Text style={styles.adjustButtonText}>-1</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.adjustButton, styles.incrementButton]}
          onPress={() => adjustAvailability(1)}
          disabled={loading || location.available_count >= location.capacity}
        >
          <Text style={styles.adjustButtonText}>+1</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Manual Adjustments</Text>

        <View style={styles.manualRow}>
          <View style={styles.manualItem}>
            <Text style={styles.manualLabel}>Reserved</Text>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepperButton}>
                <Text>-</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>0</Text>
              <TouchableOpacity style={styles.stepperButton}>
                <Text>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.manualItem}>
            <Text style={styles.manualLabel}>Unavailable</Text>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepperButton}>
                <Text>-</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>0</Text>
              <TouchableOpacity style={styles.stepperButton}>
                <Text>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {recentActivity.length > 0 ? (
          recentActivity.map((activity) => (
            <View key={activity.id} style={styles.activityItem}>
              <Text style={styles.activityText}>
                {activity.status === 'active' ? '🚗 Check-in' : '✓ Check-out'}: {activity.plate}
              </Text>
              <Text style={styles.activityTime}>
                {new Date(activity.created_at).toLocaleTimeString()}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.activityText}>No recent activity</Text>
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
