import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { formatLocalDateTime } from '../../src/utils/formatters';
import { firstParam } from '../../src/lib/params';
import { useBottomInset } from '../../src/hooks/useBottomInset';

export default function AvailabilityScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(0);
  const locationId = firstParam(
    useLocalSearchParams<{ locationId?: string | string[] }>().locationId
  );
  const [location, setLocation] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadLocationData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const loadLocationData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!locationId) {
        throw new Error('Pick a listing from My listings');
      }
      const { data: locations, error: locError } = await supabase
        .from('locations')
        .select('*')
        .eq('id', locationId)
        .single();

      if (locError) throw locError;

      if (locations) {
        setLocation(locations);

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
      const { data, error: rpcError } = await supabase.rpc('adjust_availability', {
        p_location_id: location.id,
        p_delta: delta,
      });

      if (rpcError) throw rpcError;

      if (data?.available_count !== undefined) {
        setLocation({ ...location, available_count: data.available_count });
      }

      await loadLocationData();
    } catch (err: any) {
      console.error('Adjust availability error:', err);
      setError(err.message || 'Adjust failed');
    } finally {
      setLoading(false);
    }
  };

  const setMode = async (mode: 'count' | 'open_full') => {
    if (!location) return;
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('set_tracking_mode', {
      p_location_id: location.id,
      p_mode: mode,
    });
    if (rpcError || data?.error) {
      setNotice(rpcError?.message || String(data?.error));
      return;
    }
    await loadLocationData();
  };

  const setOpen = async (open: boolean) => {
    if (!location) return;
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('set_open_status', {
      p_location_id: location.id,
      p_open: open,
    });
    if (rpcError || data?.error) {
      setNotice(rpcError?.message || String(data?.error));
      return;
    }
    setLocation({
      ...location,
      tracking_mode: 'open_full',
      open_status: data.open_status,
    });
  };

  const setManual = async (reserved: number, unavailable: number) => {
    if (!location) return;
    setNotice(null);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('set_manual_counts', {
      p_location_id: location.id,
      p_reserved: Math.max(0, reserved),
      p_unavailable: Math.max(0, unavailable),
    });
    if (rpcError || data?.error) {
      setNotice(rpcError?.message || String(data?.error));
      return;
    }
    setLocation({
      ...location,
      available_count: data.available_count,
      manual_reserved_count: data.manual_reserved_count,
      unavailable_count: data.unavailable_count,
    });
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

  const reserved = Number(location.manual_reserved_count || 0);
  const unavailable = Number(location.unavailable_count || 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="availability-ready"
    >
      <View style={styles.header}>
        <Text style={styles.subtitle}>{location.name}</Text>
      </View>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeChip, location.tracking_mode !== 'open_full' && styles.modeChipOn]}
          onPress={() => setMode('count')}
          testID="mode-count"
        >
          <Text
            style={[
              styles.modeChipText,
              location.tracking_mode !== 'open_full' && styles.modeChipTextOn,
            ]}
          >
            Count
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeChip, location.tracking_mode === 'open_full' && styles.modeChipOn]}
          onPress={() => setMode('open_full')}
          testID="mode-open-full"
        >
          <Text
            style={[
              styles.modeChipText,
              location.tracking_mode === 'open_full' && styles.modeChipTextOn,
            ]}
          >
            Open/Full
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.countDisplay}>
        <Text style={styles.countLabel}>
          {location.tracking_mode === 'open_full' ? 'Lot status' : 'Available Spaces'}
        </Text>
        <Text style={styles.countNumber} testID="availability-status">
          {location.tracking_mode === 'open_full'
            ? location.open_status
              ? 'Open'
              : 'Full'
            : `${location.available_count} / ${location.capacity}`}
        </Text>
        <Text style={styles.countUpdated}>
          Updated {formatLocalDateTime(location.availability_updated_at)}
        </Text>
      </View>

      {location.tracking_mode === 'open_full' ? (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.adjustButton, styles.incrementButton]}
            onPress={() => setOpen(true)}
            testID="toggle-open"
          >
            <Text style={styles.adjustButtonText}>Open</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.adjustButton, styles.decrementButton]}
            onPress={() => setOpen(false)}
            testID="toggle-full"
          >
            <Text style={styles.adjustButtonText}>Full</Text>
          </TouchableOpacity>
        </View>
      ) : (
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
      )}

      {location.tracking_mode !== 'open_full' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Manual Adjustments</Text>

          <View style={styles.manualRow}>
            <View style={styles.manualItem}>
              <Text style={styles.manualLabel}>Reserved</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setManual(reserved - 1, unavailable)}
                  disabled={reserved <= 0}
                  testID="reserved-minus"
                >
                  <Text>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue} testID="reserved-value">
                  {reserved}
                </Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setManual(reserved + 1, unavailable)}
                  testID="reserved-plus"
                >
                  <Text>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.manualItem}>
              <Text style={styles.manualLabel}>Unavailable</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setManual(reserved, unavailable - 1)}
                  disabled={unavailable <= 0}
                  testID="unavailable-minus"
                >
                  <Text>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue} testID="unavailable-value">
                  {unavailable}
                </Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => setManual(reserved, unavailable + 1)}
                  testID="unavailable-plus"
                >
                  <Text>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          {notice ? (
            <Text style={styles.errorText} testID="manual-notice">
              {notice}
            </Text>
          ) : null}
        </View>
      ) : notice ? (
        <Text style={styles.errorText} testID="manual-notice">
          {notice}
        </Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {recentActivity.length > 0 ? (
          recentActivity.map((activity) => (
            <View key={activity.id} style={styles.activityItem}>
              <Text style={styles.activityText}>
                {activity.status === 'active' || activity.status === 'overdue'
                  ? 'Check-in'
                  : 'Check-out'}
                : {activity.plate}
              </Text>
              <Text style={styles.activityTime}>{formatLocalDateTime(activity.created_at)}</Text>
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
