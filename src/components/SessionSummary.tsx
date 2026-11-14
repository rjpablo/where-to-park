import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../lib/theme';
import { formatLocalDateTime, formatPeso, formatRelativeTime } from '../utils/formatters';
import { isNegativeBalance, isReservation, sessionWaived, startsIn } from '../lib/walkIn';

/**
 * The body of an active-session card: plate, vehicle, For Approval / Approved / OVERDUE / Waived badges,
 * start (or 'Starts … (in …)'), scheduled end, listing, parking so far, extra fees, balance
 * and the overdue note. Used by the Availability Sessions tab.
 */
export function SessionSummary({ item, preview }: { item: any; preview: any | null }) {
  const balance = Number(preview?.live_balance ?? 0);
  const parkingSoFar = Number(preview?.parking_so_far ?? 0);
  const extraFees = Number(preview?.extra_fees ?? 0);
  const isOverdue = item.status === 'overdue';
  const reservation = isReservation(item);
  const overdueMin = Number(
    item.overdue_minutes ||
      (item.scheduled_end_at
        ? Math.max(0, Math.floor((Date.now() - new Date(item.scheduled_end_at).getTime()) / 60000))
        : 0)
  );

  return (
    <>
      <View style={styles.sessionHeader}>
        <View>
          <Text style={styles.sessionPlate}>{item.plate || 'Unknown'}</Text>
          <Text style={styles.sessionType}>{item.vehicle_type || 'car'}</Text>
        </View>
        {reservation && item.approval_status === 'pending' ? (
          <View style={styles.approvalBadge} testID={`approval-badge-${item.plate}`}>
            <Text style={styles.approvalBadgeText}>For Approval</Text>
          </View>
        ) : reservation ? (
          <View style={styles.approvedBadge} testID={`approved-badge-${item.plate}`}>
            <Text style={styles.approvedBadgeText}>Approved</Text>
          </View>
        ) : null}
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
        <Text style={styles.sessionTime} testID={`session-start-${item.plate}`}>
          {reservation
            ? `Starts: ${formatLocalDateTime(item.started_at)} (${startsIn(item.started_at)})`
            : `Started: ${formatLocalDateTime(item.started_at)} (${formatRelativeTime(item.started_at)})`}
        </Text>
        {item.scheduled_end_at ? (
          <Text style={styles.sessionTime} testID={`scheduled-end-${item.plate}`}>
            Scheduled end: {formatLocalDateTime(item.scheduled_end_at)}
          </Text>
        ) : null}
        <Text style={styles.sessionLocation}>{item.locations?.name}</Text>
        <Text style={styles.sessionTime} testID={`parking-so-far-${item.plate}`}>
          {reservation ? 'Planned stay' : 'Parking so far'}: {formatPeso(parkingSoFar)}
        </Text>
        {extraFees ? (
          <Text style={styles.sessionTime} testID={`extra-fees-${item.plate}`}>
            Extra fees: {formatPeso(extraFees)}
          </Text>
        ) : null}
        <Text
          style={[styles.sessionBalance, isNegativeBalance(balance) && styles.negative]}
          testID={`session-balance-${item.plate}`}
        >
          Balance: {formatPeso(balance)}
        </Text>
        {isOverdue ? (
          <Text style={styles.overdueTime} testID={`overdue-time-${item.plate}`}>
            Overdue {Math.floor(overdueMin / 60)}h {overdueMin % 60}m, not billed unless end time or
            amount is edited
          </Text>
        ) : null}
      </View>
    </>
  );
}

/** Card frame shared by both lists (overdue cards get a red left edge). */
export const sessionCardStyles = StyleSheet.create({
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
});

const styles = StyleSheet.create({
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  sessionPlate: { ...theme.typography.h3 },
  sessionType: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
  },
  approvedBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  approvedBadgeText: { color: '#166534', fontWeight: '700', fontSize: 12 },
  approvalBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  approvalBadgeText: { ...theme.typography.caption, color: '#92400e', fontWeight: '700' },
  waivedBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: '#fef3c7',
    borderRadius: theme.borderRadius.sm,
  },
  waivedBadgeText: { ...theme.typography.caption, color: '#92400e', fontWeight: '700' },
  overdueBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.danger,
    borderRadius: theme.borderRadius.sm,
  },
  overdueBadgeText: { ...theme.typography.caption, color: '#fff', fontWeight: '700' },
  sessionDetails: { marginBottom: theme.spacing.md },
  sessionTime: { ...theme.typography.body, marginBottom: theme.spacing.xs },
  sessionLocation: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.xs,
  },
  negative: { color: theme.colors.danger },
  sessionBalance: { ...theme.typography.h3, color: theme.colors.primary },
  overdueTime: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginTop: theme.spacing.xs,
  },
});
