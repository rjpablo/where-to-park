import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../lib/theme';
import { formatRelativeTime, isStale } from '../utils/formatters';
import { listingAvailability } from '../lib/areas';

interface AvailabilityBadgeProps {
  trackingMode: 'count' | 'open_full' | 'slots';
  /** Free spaces over the monitored areas; null when no area is monitored (0067). */
  availableCount: number | null;
  openStatus?: boolean | null;
  updatedAt: string;
  staleThresholdMin: number;
}

export function AvailabilityBadge({
  trackingMode,
  availableCount,
  openStatus,
  updatedAt,
  staleThresholdMin,
}: AvailabilityBadgeProps) {
  const stale = isStale(updatedAt, staleThresholdMin);

  const getStatusInfo = () => {
    if (trackingMode === 'open_full') {
      const status = openStatus ? 'Open' : 'Full';
      const color = openStatus ? theme.colors.available : theme.colors.full;
      return { text: status, color };
    }

    if (trackingMode === 'count' || trackingMode === 'slots') {
      // Free count only ('n spots'; rj): capacity is no longer shown here. 0067 (areas):
      // 'Available' when no area is monitored or only an unmonitored one is open; 'Full'
      // / '0 spots' only when every area is full.
      const a = listingAvailability(availableCount, openStatus ?? (availableCount ?? 0) > 0);
      return { text: a.text, color: a.full ? theme.colors.full : theme.colors.available };
    }

    return { text: 'Unknown', color: theme.colors.text.secondary };
  };

  const { text, color } = getStatusInfo();

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: stale ? theme.colors.warning : color }]}>
        <Text style={styles.badgeText} testID="availability-badge-text">
          {text}
        </Text>
      </View>
      <Text
        style={[styles.timestamp, stale && styles.staleTimestamp]}
        testID={stale ? 'availability-stale' : 'availability-fresh'}
      >
        {formatRelativeTime(updatedAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  timestamp: {
    fontSize: 11,
    color: theme.colors.text.secondary,
  },
  staleTimestamp: {
    color: theme.colors.warning,
    fontWeight: '500',
  },
});
