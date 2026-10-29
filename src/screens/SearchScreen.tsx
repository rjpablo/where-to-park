import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useSearchStore } from '../stores/searchStore';
import { AvailabilityBadge } from '../components/AvailabilityBadge';
import { Map } from '../components/map';
import { LocationPin, MapRegion } from '../components/map/types';
import { formatPeso, formatDistance, formatDuration } from '../utils/formatters';
import { theme } from '../lib/theme';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';

export function SearchScreen() {
  const router = useRouter();
  const {
    results,
    loading,
    error,
    search,
    filters,
    sortBy,
    setFilters,
    setSortBy,
    sheetPosition,
    setSheetPosition,
  } = useSearchStore();
  const [location] = useState({ lat: 16.4023, lng: 120.596 }); // Baguio City center
  const authUser = useAuthStore((s) => s.user);
  const [etas, setEtas] = useState<Record<string, { duration_s: number; source: string }>>({});

  const region: MapRegion = useMemo(
    () => ({
      latitude: location.lat,
      longitude: location.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }),
    [location]
  );

  // Convert search results to map pins
  const pins: LocationPin[] = useMemo(
    () =>
      results.map((result) => ({
        id: result.id,
        coordinate: {
          latitude: result.latitude,
          longitude: result.longitude,
        },
        availableCount: result.available_count || 0,
        isStale:
          result.stale_after_min && result.availability_updated_at
            ? new Date().getTime() - new Date(result.availability_updated_at).getTime() >
              result.stale_after_min * 60 * 1000
            : false,
        title: result.name,
      })),
    [results]
  );

  const handlePinPress = (locationId: string) => {
    router.push(`/location/${locationId}`);
  };

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('vehicle_type')
          .eq('is_default', true)
          .maybeSingle();
        if (vehicle?.vehicle_type) {
          setFilters({ vehicleType: vehicle.vehicle_type });
        }
      }
    })();
    // Default vehicle filter is applied once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    search(location.lat, location.lng, 5000);
  }, [filters, sortBy, location.lat, location.lng, search]);

  useEffect(() => {
    if (!results.length) return;
    const ids = results.slice(0, 20).map((r) => r.id);
    supabase
      .rpc('get_etas', {
        p_lat: location.lat,
        p_lng: location.lng,
        p_location_ids: ids,
      })
      .then(({ data }) => {
        const next: Record<string, { duration_s: number; source: string }> = {};
        (data?.etas || []).forEach((e: any) => {
          next[e.location_id] = { duration_s: e.duration_s, source: e.source };
        });
        setEtas(next);
      });
  }, [results, location.lat, location.lng]);

  const renderListItem = ({ item }: { item: (typeof results)[0] }) => (
    <TouchableOpacity style={styles.listItem} onPress={() => router.push(`/location/${item.id}`)}>
      <View style={styles.listItemHeader}>
        <Text style={styles.listItemTitle}>{item.name}</Text>
        {item.verification_status === 'unverified' && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Unverified</Text>
          </View>
        )}
      </View>

      <View style={styles.listItemInfo}>
        <AvailabilityBadge
          trackingMode={item.tracking_mode}
          availableCount={item.available_count}
          capacity={item.capacity}
          openStatus={item.open_status}
          updatedAt={item.availability_updated_at}
          staleThresholdMin={item.stale_after_min}
        />

        <Text style={styles.listItemDetail} testID={`list-eta-${item.id}`}>
          {formatDistance(item.distance_m)}
          {etas[item.id]
            ? ` · ${formatDuration(etas[item.id].duration_s)}${etas[item.id].source === 'estimate' ? ' est.' : ''}`
            : ''}
          {' · '}
          {item.starting_rate ? formatPeso(item.starting_rate) + '/h' : 'See rates'}
        </Text>

        {item.has_monthly && (
          <View style={[styles.badge, { backgroundColor: theme.colors.secondary }]}>
            <Text style={styles.badgeText}>Monthly</Text>
          </View>
        )}
      </View>

      <Text style={styles.listItemAddress}>{item.address}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Map with location pins */}
      <Map
        region={region}
        pins={pins}
        onPinPress={handlePinPress}
        style={styles.map}
        showsUserLocation={false}
        clusterPins
      />

      {/* Bottom Sheet */}
      <View
        style={[styles.sheet, sheetPosition === 'expanded' && styles.sheetExpanded]}
        testID={loading ? 'search-loading' : error ? 'search-error' : 'search-ready'}
      >
        <TouchableOpacity
          testID="sheet-expand-toggle"
          accessibilityLabel="Toggle search sheet"
          onPress={() => setSheetPosition(sheetPosition === 'expanded' ? 'peek' : 'expanded')}
          style={styles.sheetHandleHit}
        >
          <View style={styles.sheetHandle} />
        </TouchableOpacity>

        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle}>Parking Locations</Text>
            <TouchableOpacity
              onPress={() => router.push(authUser ? '/profile' : '/auth')}
              testID="search-auth-link"
            >
              <Text style={styles.authLink}>{authUser ? 'Profile' : 'Sign in'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, filters.monthlyOnly && styles.filterChipActive]}
              onPress={() => setFilters({ monthlyOnly: !filters.monthlyOnly })}
              testID="filter-monthly"
            >
              <Text style={styles.filterChipText}>Monthly</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.filterChip, filters.hideFull && styles.filterChipActive]}
              onPress={() => setFilters({ hideFull: !filters.hideFull })}
            >
              <Text style={styles.filterChipText}>Hide Full</Text>
            </TouchableOpacity>
            {filters.vehicleType ? (
              <View
                style={[styles.filterChip, styles.filterChipActive]}
                testID="search-vehicle-filter"
              >
                <Text style={styles.filterChipText}>{filters.vehicleType}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort by:</Text>
          {['distance', 'price', 'availability', 'rating', 'eta'].map((sort) => (
            <TouchableOpacity
              key={sort}
              style={[styles.sortChip, sortBy === sort && styles.sortChipActive]}
              onPress={() => setSortBy(sort as any)}
            >
              <Text style={[styles.sortChipText, sortBy === sort && styles.sortChipTextActive]}>
                {sort}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={
            sortBy === 'eta'
              ? [...results].sort(
                  (a, b) => (etas[a.id]?.duration_s || 99999) - (etas[b.id]?.duration_s || 99999)
                )
              : results
          }
          renderItem={renderListItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {loading ? 'Searching...' : error ? `Error: ${error}` : 'No locations found'}
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  map: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    height: '40%',
    ...theme.shadows.lg,
  },
  sheetExpanded: {
    height: '85%',
  },
  sheetHandleHit: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing.md,
  },
  sheetHeader: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  sheetTitle: {
    ...theme.typography.h3,
  },
  authLink: {
    ...theme.typography.bodySmall,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  filterChipText: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.primary,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  sortLabel: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginRight: theme.spacing.xs,
  },
  sortChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  sortChipActive: {
    backgroundColor: theme.colors.surfaceDark,
  },
  sortChipText: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
  },
  sortChipTextActive: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: theme.spacing.lg,
  },
  listItem: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
    ...theme.shadows.sm,
  },
  listItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  listItemTitle: {
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
    fontWeight: '600',
  },
  listItemInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  listItemDetail: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
  },
  listItemAddress: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.tertiary,
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
