import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../../src/components/Button';
import { WorkspaceNav } from '../../../src/components/WorkspaceNav';
import { useAuthStore } from '../../../src/stores/authStore';
import { supabase } from '../../../src/lib/supabase';
import { firstParam } from '../../../src/lib/params';
import {
  availabilityLabel,
  canManageListings,
  loadMyMemberships,
  roleForLocation,
  type OperatorRole,
} from '../../../src/lib/operatorAccess';
import { theme } from '../../../src/lib/theme';

export default function ListingHubScreen() {
  const router = useRouter();
  const id = firstParam(useLocalSearchParams<{ id: string | string[] }>().id);
  const { user, initialize } = useAuthStore();
  const [location, setLocation] = React.useState<any>(null);
  const [role, setRole] = React.useState<OperatorRole | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    (async () => {
      if (!id || !user) {
        setLoading(false);
        return;
      }
      setError(null);
      try {
        const [{ data, error: locError }, memberships] = await Promise.all([
          supabase
            .from('locations')
            .select(
              'id, name, verification_status, published, tracking_mode, available_count, capacity, open_status, operator_id, availability_updated_at'
            )
            .eq('id', id)
            .single(),
          loadMyMemberships(user.id),
        ]);
        if (locError) throw locError;
        setLocation(data);
        setRole(data ? roleForLocation(memberships, data) : null);
      } catch (err: any) {
        setError(err.message || 'Could not load listing');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, user]);

  const manage = canManageListings(role || undefined);

  if (!user) {
    return (
      <View style={styles.container} testID="hub-guest">
        <WorkspaceNav />
        <Text style={styles.title}>Sign in to manage this listing</Text>
        <Button title="Sign in" onPress={() => router.push('/auth')} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container} testID="hub-loading">
        <WorkspaceNav listingId={id} />
        <Text style={styles.meta}>Loading...</Text>
      </View>
    );
  }

  if (error || !location || !role) {
    return (
      <View style={styles.container} testID="hub-error">
        <WorkspaceNav />
        <Text style={styles.title}>Listing not found</Text>
        <Text style={styles.meta}>{error || 'You do not staff this location.'}</Text>
        <Button title="My listings" onPress={() => router.replace('/operator/listings')} />
      </View>
    );
  }

  const go = (pathname: string, params?: Record<string, string>) => {
    router.push({ pathname: pathname as any, params });
  };

  return (
    <ScrollView style={styles.scroll} testID="hub-ready">
      <WorkspaceNav listingId={location.id} />
      <View style={styles.header}>
        <Text style={styles.title} testID="hub-name">
          {location.name}
        </Text>
        <Text style={styles.meta} testID="hub-status">
          {location.verification_status === 'verified' ? 'Verified' : 'Unverified'} ·{' '}
          {location.published ? 'Published' : 'Hidden'} · {availabilityLabel(location)}
        </Text>
        <Text style={styles.meta}>
          {role === 'staff' ? 'Staff access' : 'Owner/manager access'}
        </Text>
      </View>

      <View style={styles.actions}>
        {manage ? (
          <>
            <Button
              title="Edit details and photos"
              onPress={() => go('/operator/edit/[id]', { id: location.id })}
              testID="hub-edit"
            />
            <Button
              title="Areas and rates"
              variant="outline"
              onPress={() => go('/operator/rates', { locationId: location.id })}
              testID="hub-rates"
            />
            <Button
              title="Fee presets"
              variant="outline"
              onPress={() =>
                go('/operator/fees', {
                  locationId: location.id,
                  operatorId: location.operator_id,
                })
              }
              testID="hub-fees"
            />
            <Button
              title="Staff"
              variant="outline"
              onPress={() =>
                go('/operator/staff', {
                  operatorId: location.operator_id,
                  locationId: location.id,
                })
              }
              testID="hub-staff"
            />
          </>
        ) : null}
        <Button
          title="Availability"
          variant={manage ? 'outline' : 'primary'}
          onPress={() => go('/operator/availability', { locationId: location.id })}
          testID="hub-availability"
        />
        <Button
          title="Session board"
          variant="outline"
          onPress={() => go('/staff/sessions', { locationId: location.id })}
          testID="hub-sessions"
        />
        <Button
          title="Walk-in check-in"
          variant="outline"
          onPress={() => go('/staff/checkin', { locationId: location.id })}
          testID="hub-checkin"
        />
        <Button
          title="Messages"
          variant="outline"
          onPress={() => go('/operator/inbox', { locationId: location.id })}
          testID="hub-messages"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingBottom: theme.spacing.lg,
  },
  scroll: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md },
  title: { ...theme.typography.h2 },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xs,
  },
  actions: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
});
