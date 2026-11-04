import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { refreshSidebarCounts } from '../../src/stores/sidebarStore';
import { Button } from '../../src/components/Button';
import { useAuthStore } from '../../src/stores/authStore';
import {
  availabilityLabel,
  loadManagedLocations,
  type ManagedLocation,
} from '../../src/lib/operatorAccess';
import { theme } from '../../src/lib/theme';
import { REVIEW_LABELS, reviewState } from '../../src/lib/listingReview';
import { useBottomInset } from '../../src/hooks/useBottomInset';

export default function ListingsDashboardScreen() {
  // Edge-to-edge: the content ends just above the navigation bar (one inset).
  const bottomInset = useBottomInset(0);
  const router = useRouter();
  const { user, initialize } = useAuthStore();
  const [locations, setLocations] = React.useState<ManagedLocation[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    if (!user) {
      setLocations([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      setLocations(await loadManagedLocations(user.id));
      // The badges on screen show the outcome: verified/rejected now count as seen.
      supabase.rpc('mark_listing_reviews_seen').then(() => refreshSidebarCounts());
    } catch (err: any) {
      setError(err.message || 'Could not load listings');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const [resubmittingId, setResubmittingId] = React.useState<string | null>(null);

  // Publishing a rejected listing again clears the rejection and puts it back in the queue.
  const resubmit = async (id: string) => {
    setResubmittingId(id);
    const { error: updateError } = await supabase
      .from('locations')
      .update({ published: true })
      .eq('id', id);
    if (updateError) setError(updateError.message);
    setResubmittingId(null);
    load();
  };

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (!user) {
    return (
      <View style={styles.container} testID="listings-guest">
        <View style={styles.header}>
          <Text style={styles.meta}>Sign in to manage your parking spaces.</Text>
          <Button title="Sign in" onPress={() => router.push('/auth')} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={bottomInset}
      testID="listings-ready"
    >
      <View style={styles.header}>
        <Text style={styles.meta}>
          Spaces you own or staff
          {user.display_name ? ` · ${user.display_name}` : ''}
        </Text>
        <Button
          title="+ Add a listing"
          onPress={() => router.push('/operator/onboarding')}
          testID="listings-add"
        />
      </View>

      {loading ? <Text style={[styles.meta, styles.padded]}>Loading...</Text> : null}
      {error ? (
        <Text style={styles.error} testID="listings-error">
          {error}
        </Text>
      ) : null}

      {locations.map((loc) => (
        <TouchableOpacity
          key={loc.id}
          style={styles.card}
          onPress={() => router.push({ pathname: '/operator/hub/[id]', params: { id: loc.id } })}
          testID={`listing-card-${loc.id}`}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{loc.name}</Text>
            <View
              style={[
                styles.badge,
                reviewState(loc) === 'verified'
                  ? styles.badgeVerified
                  : reviewState(loc) === 'rejected'
                    ? styles.badgeRejected
                    : styles.badgePending,
              ]}
              testID={`listing-review-${loc.id}`}
            >
              <Text style={styles.badgeText}>{REVIEW_LABELS[reviewState(loc)]}</Text>
            </View>
          </View>
          {reviewState(loc) === 'rejected' ? (
            <Text style={styles.rejection} testID={`listing-rejection-${loc.id}`}>
              Rejected by an admin{loc.rejection_reason ? `: ${loc.rejection_reason}` : ''}. Fix the
              listing, then resubmit it.
            </Text>
          ) : null}
          {reviewState(loc) === 'rejected' && loc.role !== 'staff' ? (
            <Button
              title="Resubmit for verification"
              size="small"
              variant="outline"
              loading={resubmittingId === loc.id}
              disabled={!!resubmittingId}
              onPress={() => resubmit(loc.id)}
              testID={`listing-resubmit-${loc.id}`}
            />
          ) : null}
          <Text style={styles.meta}>
            {loc.published ? 'Published' : 'Hidden'} · {availabilityLabel(loc)}
          </Text>
          <Text style={styles.role}>{loc.role === 'staff' ? 'Staff' : 'Owner/manager'}</Text>
        </TouchableOpacity>
      ))}

      {!loading && locations.length === 0 ? (
        <Text style={[styles.meta, styles.padded]} testID="listings-empty">
          No listings yet. Add a parking space to get started.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  padded: { paddingHorizontal: theme.spacing.lg },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  role: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    marginTop: theme.spacing.xs,
  },
  card: {
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  cardTitle: { ...theme.typography.body, fontWeight: '700', flex: 1 },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
  },
  badgeVerified: { backgroundColor: theme.colors.verified },
  badgePending: { backgroundColor: theme.colors.unverified },
  badgeRejected: { backgroundColor: theme.colors.danger },
  rejection: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginTop: theme.spacing.xs,
  },
  badgeText: { ...theme.typography.caption, color: '#fff', fontWeight: '700' },
  error: {
    ...theme.typography.body,
    color: theme.colors.danger,
    paddingHorizontal: theme.spacing.lg,
  },
});
