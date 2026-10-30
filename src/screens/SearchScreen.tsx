import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useSearchStore } from '../stores/searchStore';
import { AvailabilityBadge } from '../components/AvailabilityBadge';
import { Map } from '../components/map';
import {
  Coordinate,
  LocationPin,
  MapHandle,
  MapRegion,
  MapViewport,
} from '../components/map/types';
import { PlaceSearchBox } from '../components/PlaceSearchBox';
import { DistanceSlider } from '../components/DistanceSlider';
import { availableSlots, searchSummary } from '../lib/availability';
import {
  DEFAULT_DISTANCE_KM,
  MAX_DISTANCE_KM,
  SEARCH_START_ZOOM,
  fitDistanceToMax,
  sliderMaxKm,
} from '../lib/distance';
import type { PlaceSuggestion } from '../lib/geocoding';
import { distanceMeters } from '../components/map/camera';
import { formatPeso, formatDistance, formatDuration } from '../utils/formatters';
import { theme } from '../lib/theme';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { loadMyMemberships } from '../lib/operatorAccess';

// Peek and expanded heights of the results sheet.
const SHEET_SNAP_POINTS = ['40%', '85%'];

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
  // Search origin: Baguio City centre until the user searches another area.
  const [location, setLocation] = useState({ lat: 16.4023, lng: 120.596 });
  const [searchNonce, setSearchNonce] = useState(0);
  const [movedViewport, setMovedViewport] = useState<MapViewport | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const [mapCenter, setMapCenter] = useState<Coordinate>({ latitude: 16.4023, longitude: 120.596 });
  // Slider max = distance from the search centre to the farthest visible corner.
  const [distanceMaxKm, setDistanceMaxKm] = useState(MAX_DISTANCE_KM);
  // The distance the user chose (or the 3 km default); clamped to the max per search.
  const preferredKmRef = useRef(DEFAULT_DISTANCE_KM);
  const latestViewport = useRef<MapViewport | null>(null);
  const [placeMarker, setPlaceMarker] = useState<Coordinate | null>(null);
  // After jumping to a searched place, offer "Search this area" there too.
  const offerSearchAfterMove = useRef(false);
  const authUser = useAuthStore((s) => s.user);
  const [etas, setEtas] = useState<Record<string, { duration_s: number; source: string }>>({});
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  // Keep cluster zooms clear of the bottom sheet (40% / 85% of the screen).
  const overlayInsets = useMemo(
    () => ({
      top: 72, // place search box
      right: 0,
      left: 0,
      bottom: Math.round(windowHeight * (sheetPosition === 'expanded' ? 0.85 : 0.4)),
    }),
    [windowHeight, sheetPosition]
  );

  // Initial camera only; later moves come from the user, clusters or place search.
  const region: MapRegion = useMemo(
    () => ({
      latitude: 16.4023,
      longitude: 120.596,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }),
    []
  );

  const handleViewportChange = useCallback((viewport: MapViewport) => {
    const first = latestViewport.current == null;
    latestViewport.current = viewport;
    setMapCenter(viewport.center);
    // First visible area known: re-run so the slider max matches it.
    if (first) setSearchNonce((n) => n + 1);
    // Offer "Search this area" only after the user's own pan or zoom (or a place jump).
    if (viewport.isUserInteraction || offerSearchAfterMove.current) {
      offerSearchAfterMove.current = false;
      setMovedViewport(viewport);
    }
  }, []);

  const handlePlaceSelect = useCallback((place: PlaceSuggestion) => {
    setPlaceMarker(place.coordinate);
    offerSearchAfterMove.current = true;
    mapRef.current?.focus(place);
  }, []);

  const searchThisArea = () => {
    if (!movedViewport) return;
    const { center } = movedViewport;
    latestViewport.current = movedViewport;
    // The search effect recomputes the slider max for this centre and viewport.
    setLocation({ lat: center.latitude, lng: center.longitude });
    setMovedViewport(null);
    setSearchNonce((n) => n + 1);
  };

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
        availableSlots: availableSlots(result),
        pinLabel:
          result.tracking_mode === 'open_full'
            ? result.open_status
              ? 'Open'
              : 'Full'
            : String(result.available_count ?? 0),
        isStale:
          result.stale_after_min && result.availability_updated_at
            ? new Date().getTime() - new Date(result.availability_updated_at).getTime() >
              result.stale_after_min * 60 * 1000
            : false,
        isFull:
          result.tracking_mode === 'open_full'
            ? !result.open_status
            : (result.available_count || 0) <= 0,
        title: result.name,
      })),
    [results]
  );

  const handlePinPress = (locationId: string) => {
    router.push(`/location/${locationId}`);
  };

  useEffect(() => {
    if (!authUser) {
      setHasWorkspace(false);
      return;
    }
    if (authUser.is_admin || authUser.account_type === 'operator') {
      setHasWorkspace(true);
    }
    loadMyMemberships(authUser.id)
      .then((rows) => {
        setHasWorkspace(
          !!authUser.is_admin || authUser.account_type === 'operator' || rows.length > 0
        );
      })
      .catch(() => {
        setHasWorkspace(!!authUser.is_admin || authUser.account_type === 'operator');
      });
  }, [authUser]);

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
    // Each search recomputes the slider max from the visible map, then clamps the
    // distance: the preferred value (default 3 km) if it fits, otherwise the max.
    const viewport = latestViewport.current;
    if (viewport) {
      const origin: [number, number] = [location.lng, location.lat];
      const { ne, sw } = viewport.bounds;
      const farthest = Math.max(
        ...[
          [ne.longitude, ne.latitude],
          [sw.longitude, sw.latitude],
          [ne.longitude, sw.latitude],
          [sw.longitude, ne.latitude],
        ].map((corner) => distanceMeters(origin, corner as [number, number]))
      );
      const maxKm = sliderMaxKm(farthest);
      setDistanceMaxKm(maxKm);
      const fitted = fitDistanceToMax(preferredKmRef.current, maxKm);
      if (fitted !== filters.distanceKm) {
        setFilters({ distanceKm: fitted }); // re-runs this effect with the fitted value
        return;
      }
    }
    search(location.lat, location.lng, Math.round(filters.distanceKm * 1000));
    // searchNonce forces a re-run (e.g. Search this area on the same centre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, location.lat, location.lng, searchNonce, search]);

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
        <Text style={styles.listItemTitle} numberOfLines={2}>
          {item.name}
        </Text>
        {item.verification_status === 'unverified' && (
          <View style={styles.badge} testID={`unverified-badge-${item.name}`}>
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

        <Text
          style={styles.listItemDetail}
          numberOfLines={1}
          ellipsizeMode="tail"
          testID={`list-eta-${item.id}`}
        >
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

      <Text style={styles.listItemAddress} numberOfLines={2} ellipsizeMode="tail">
        {item.address}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Map with location pins */}
      <Map
        ref={mapRef}
        region={region}
        initialZoom={SEARCH_START_ZOOM}
        focusMarker={placeMarker}
        pins={pins}
        onPinPress={handlePinPress}
        style={styles.map}
        showsUserLocation={false}
        clusterPins
        overlayInsets={overlayInsets}
        onViewportChange={handleViewportChange}
      />

      <View style={styles.topOverlay} pointerEvents="box-none">
        <PlaceSearchBox
          near={mapCenter}
          onSelect={handlePlaceSelect}
          onClear={() => setPlaceMarker(null)}
        />
        {movedViewport ? (
          <TouchableOpacity
            style={styles.searchAreaButton}
            onPress={searchThisArea}
            accessibilityRole="button"
            testID="search-this-area"
          >
            <Text style={styles.searchAreaText}>Search this area</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Bottom sheet: swipe up/down anywhere on it (header or list) to expand/restore. */}
      <BottomSheet
        ref={sheetRef}
        index={sheetPosition === 'expanded' ? 1 : 0}
        snapPoints={SHEET_SNAP_POINTS}
        onChange={(index) => setSheetPosition(index >= 1 ? 'expanded' : 'peek')}
        handleComponent={null}
        enablePanDownToClose={false}
        // Horizontal drags (distance slider, chips) must not move the sheet.
        activeOffsetY={[-8, 8]}
        failOffsetX={[-8, 8]}
        backgroundStyle={styles.sheetBackground}
        style={styles.sheet}
      >
        <View
          style={styles.sheetBody}
          testID={loading ? 'search-loading' : error ? 'search-error' : 'search-ready'}
        >
          <TouchableOpacity
            testID="sheet-expand-toggle"
            accessibilityLabel="Toggle search sheet"
            onPress={() => sheetRef.current?.snapToIndex(sheetPosition === 'expanded' ? 0 : 1)}
            style={styles.sheetHandleHit}
          >
            <View style={styles.sheetHandle} />
          </TouchableOpacity>

          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <View style={styles.sheetTitleBlock}>
                <Text style={styles.sheetTitle}>Parking Locations</Text>
                <Text
                  style={styles.sheetSummary}
                  numberOfLines={1}
                  testID="search-summary"
                  accessibilityLiveRegion="polite"
                >
                  {loading ? 'Searching…' : error ? 'Search failed' : searchSummary(results)}
                </Text>
              </View>
              <View style={styles.headerLinks}>
                {hasWorkspace ? (
                  <TouchableOpacity
                    onPress={() => router.push('/operator/listings')}
                    testID="search-listings-link"
                  >
                    <Text style={styles.authLink}>My listings</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={() => router.push(authUser ? '/profile' : '/auth')}
                  testID="search-auth-link"
                >
                  <Text style={styles.authLink}>{authUser ? 'Profile' : 'Sign in'}</Text>
                </TouchableOpacity>
              </View>
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

            <DistanceSlider
              valueKm={filters.distanceKm}
              maxKm={distanceMaxKm}
              onChangeKm={(km) => {
                preferredKmRef.current = km;
                setFilters({ distanceKm: km });
              }}
              testID="filter-distance"
            />
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

          <BottomSheetFlatList
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
      </BottomSheet>
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
  topOverlay: {
    position: 'absolute',
    top: theme.spacing.md,
    left: theme.spacing.md,
    right: theme.spacing.md,
    alignItems: 'center',
    zIndex: 10,
    elevation: 12,
    gap: theme.spacing.sm,
  },
  searchAreaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface,
    ...theme.shadows.md,
  },
  searchAreaText: {
    ...theme.typography.bodySmall,
    color: theme.colors.primary,
    fontWeight: '700',
  },
  sheet: {
    ...theme.shadows.lg,
  },
  sheetBackground: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
  },
  sheetBody: {
    flex: 1,
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
  sheetTitleBlock: {
    flex: 1,
    flexShrink: 1,
    marginRight: theme.spacing.sm,
  },
  sheetSummary: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    fontWeight: '600',
    marginTop: 2,
  },
  headerLinks: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
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
    flexShrink: 1,
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
  // Wraps onto a second line on narrow screens instead of running past the card;
  // the details text shrinks and ellipsizes if it still does not fit.
  listItemInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: theme.spacing.md,
    rowGap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  listItemDetail: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
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
