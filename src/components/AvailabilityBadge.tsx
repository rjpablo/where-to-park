import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../lib/theme';
import { formatRelativeTime, isStale } from '../utils/formatters';

interface AvailabilityBadgeProps {
  trackingMode: 'count' | 'open_full' | 'slots';
  availableCount: number;
  capacity?: number;
  openStatus?: boolean | null;
  updatedAt: string;
  staleThresholdMin: number;
}

export function AvailabilityBadge({
  trackingMode,
  availableCount,
  capacity,
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
      const text = capacity ? `${availableCount}/${capacity}` : `${availableCount}`;
      const color = availableCount > 0 ? theme.colors.available : theme.colors.full;
      return { text, color };
    }

    return { text: 'Unknown', color: theme.colors.text.secondary };
  };

  const { text, color } = getStatusInfo();

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: stale ? theme.colors.warning : color }]}>
        <Text style={styles.badgeText}>{text}</Text>
      </View>
      <Text
        style={[styles.timestamp, stale && styles.staleTimestamp]}
        testID={stale ? 'availability-stale' : 'availability-fresh'}
      >
        {stale ? `Stale · ${formatRelativeTime(updatedAt)}` : formatRelativeTime(updatedAt)}
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
