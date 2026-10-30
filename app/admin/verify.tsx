import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Alert, TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { WorkspaceNav } from '../../src/components/WorkspaceNav';
import { supabase } from '../../src/lib/supabase';
import { formatLocalDateTime, formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';
import { normalizeRejectReason } from '../../src/lib/listingReview';
import { useBottomInset } from '../../src/hooks/useBottomInset';

export default function VerificationQueueScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(theme.spacing.lg);
  const router = useRouter();
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  // Listing whose reject form is open, and its reason draft.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Reload whenever the queue regains focus (e.g. back from a listing's details).
  useFocusEffect(
    React.useCallback(() => {
      loadQueue({ silent: true });
      // loadQueue only touches state setters.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const loadQueue = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('locations')
        .select('*, operators(display_name)')
        .eq('verification_status', 'unverified')
        .is('rejected_at', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      setLocations(data || []);
    } catch (err: any) {
      console.error('Load queue error:', err);
      if (!silent) setError(err.message || 'Failed to load verification queue');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (locationId: string) => {
    if (verifyingId) return;
    setVerifyingId(locationId);
    try {
      const { data, error } = await supabase.rpc('verify_location', {
        p_location_id: locationId,
      });

      if (error) throw error;
      // The RPC reports permission problems in its JSON body instead of as an error.
      if (data?.error) throw new Error(String(data.error));

      // Drop the listing from the queue right away; the reload below confirms it.
      setLocations((prev) => prev.filter((loc) => loc.id !== locationId));
      Alert.alert('Success', 'Location verified');
      loadQueue({ silent: true });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleReject = async (locationId: string) => {
    if (verifyingId) return;
    setVerifyingId(locationId);
    try {
      const { data, error } = await supabase.rpc('reject_location', {
        p_location_id: locationId,
        p_reason: normalizeRejectReason(rejectReason),
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      setLocations((prev) => prev.filter((loc) => loc.id !== locationId));
      setRejectingId(null);
      setRejectReason('');
      Alert.alert('Rejected', 'Listing rejected and unpublished');
      loadQueue({ silent: true });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setVerifyingId(null);
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
      <Text style={styles.cardTime}>
        Submitted {formatLocalDateTime(item.created_at)} ({formatRelativeTime(item.created_at)})
      </Text>

      <View style={styles.cardActions}>
        <Button
          title="View Details"
          variant="outline"
          size="small"
          onPress={() => router.push(`/location/${item.id}`)}
          testID={`verify-open-${item.id}`}
        />
        <Button
          title="Verify"
          size="small"
          onPress={() => handleVerify(item.id)}
          loading={verifyingId === item.id}
          disabled={!!verifyingId}
          testID={`verify-listing-${item.id}`}
        />
        {rejectingId !== item.id ? (
          <Button
            title="Reject"
            variant="outline"
            size="small"
            onPress={() => {
              setRejectingId(item.id);
              setRejectReason('');
            }}
            disabled={!!verifyingId}
            testID={`reject-listing-${item.id}`}
          />
        ) : null}
      </View>
      {rejectingId === item.id ? (
        <View style={styles.rejectForm}>
          <TextInput
            style={styles.rejectInput}
            value={rejectReason}
            onChangeText={setRejectReason}
            placeholder="Reason (optional, shown to the operator)"
            maxLength={500}
            multiline
            testID={`reject-reason-${item.id}`}
          />
          <View style={styles.cardActions}>
            <Button
              title="Cancel"
              variant="outline"
              size="small"
              onPress={() => setRejectingId(null)}
              disabled={!!verifyingId}
            />
            <Button
              title="Confirm reject"
              variant="danger"
              size="small"
              onPress={() => handleReject(item.id)}
              loading={verifyingId === item.id}
              disabled={!!verifyingId}
              testID={`reject-confirm-${item.id}`}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  if (loading && locations.length === 0) {
    return (
      <View style={[styles.container, styles.emptyState]} testID="admin-loading">
        <WorkspaceNav />
        <Text>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.emptyState]} testID="admin-error">
        <WorkspaceNav />
        <Text style={styles.cardAddress}>Error: {error}</Text>
        <Button title="Retry" onPress={() => loadQueue()} />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="admin-ready">
      <WorkspaceNav />
      <View style={styles.header}>
        <Text style={styles.subtitle}>{locations.length} pending</Text>
      </View>

      <FlatList
        data={locations}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, bottomInset]}
        refreshing={loading}
        onRefresh={() => loadQueue()}
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
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  rejectForm: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  rejectInput: {
    ...theme.typography.body,
    minHeight: 64,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    textAlignVertical: 'top',
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
