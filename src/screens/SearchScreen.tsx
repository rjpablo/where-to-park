import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSearchStore } from '../stores/searchStore';
import { AvailabilityBadge } from '../components/AvailabilityBadge';
import { Map } from '../components/map';
import { LocationPin, MapRegion } from '../components/map/types';
import { formatPeso, formatDistance } from '../utils/formatters';
import { theme } from '../lib/theme';

export function SearchScreen() {
  const router = useRouter();
  const {
    results,
    loading,
    search,
    filters,
    sortBy,
    setFilters,
    setSortBy,
    sheetPosition,
    setSheetPosition,
  } = useSearchStore();
  const [location, setLocation] = useState({ lat: 16.412, lng: 120.596 }); // Default: Baguio City center

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
    // Initial search
    search(location.lat, location.lng);
  }, []);

  const handleSearch = () => {
    search(location.lat, location.lng);
  };

  const renderListItem = ({ item }: { item: (typeof results)[0] }) => (
    <TouchableOpacity
      style={styles.listItem}
      onPress={() => router.push(`/location/${item.id}`)}
    >
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

        <Text style={styles.listItemDetail}>
          {formatDistance(item.distance_m)} •{' '}
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
        showsUserLocation
        clusterPins
      />

      {/* Bottom Sheet */}
      <View style={[styles.sheet, sheetPosition === 'expanded' && styles.sheetExpanded]}>
        <View style={styles.sheetHandle} />

        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Parking Locations</Text>

          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, filters.monthlyOnly && styles.filterChipActive]}
              onPress={() => setFilters({ monthlyOnly: !filters.monthlyOnly })}
            >
              <Text style={styles.filterChipText}>Monthly</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.filterChip, filters.hideFull && styles.filterChipActive]}
              onPress={() => setFilters({ hideFull: !filters.hideFull })}
            >
              <Text style={styles.filterChipText}>Hide Full</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort by:</Text>
          {['distance', 'price', 'availability', 'rating'].map((sort) => (
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
          data={results}
          renderItem={renderListItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {loading ? 'Searching...' : 'No locations found'}
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
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  sheetHeader: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sheetTitle: {
    ...theme.typography.h3,
    marginBottom: theme.spacing.sm,
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
