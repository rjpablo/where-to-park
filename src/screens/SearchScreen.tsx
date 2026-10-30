import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { Sidebar } from '../components/Sidebar';
import { useUserLocation } from '../hooks/useUserLocation';
import {
  locationMessage,
  RECENTER_ZOOM,
  recenterAction,
  recenterButtonTop,
} from '../lib/userLocation';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  expandedHeight,
  peekHeight,
  sheetContainerHeight,
  sheetVisibleHeight,
} from '../lib/sheetLayout';
import { useSidebarStore } from '../stores/sidebarStore';
import { DistanceSlider } from '../components/DistanceSlider';
import { availableSlots, searchSummary } from '../lib/availability';
import { etaText } from '../lib/listingEta';
import {
  MAX_DISTANCE_KM,
  SEARCH_START_ZOOM,
  centerToCornerMeters,
  distanceAfterSearch,
  sliderMaxKm,
} from '../lib/distance';
import type { PlaceSuggestion } from '../lib/geocoding';
import { distanceMeters } from '../components/map/camera';
import { formatPeso, formatDistance, formatDuration } from '../utils/formatters';
import { theme } from '../lib/theme';
import { FilterDropdown } from '../components/FilterDropdown';
import { isRateType, RATE_FILTER_OPTIONS } from '../lib/rates';
import {
  defaultVehicleFilter,
  isVehicleType,
  SORT_LABELS,
  SORT_OPTIONS,
  VEHICLE_FILTER_OPTIONS,
} from '../lib/searchFilters';
import { formatListingRating } from '../lib/rating';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { loadMyMemberships } from '../lib/operatorAccess';

// Results sheet: collapsed it fits its top part (title, summary, distance slider);
// expanded it takes 85% of the screen and shows filters, sort and the list too.
const SHEET_EXPANDED = 0.85;
/** Collapsed height until the top part has been measured, and its limits. */
const SHEET_PEEK_DEFAULT = 170;
const SHEET_PEEK_MIN = 120;
const SHEET_PEEK_MAX_FRACTION = 0.5;
/** Expanded, the sheet's top stays below the place search box (72 px) plus a gap. */
const SHEET_KEEP_CLEAR_TOP = 88;
const SHEET_EXPANDED_MIN = 240;
const RECENTER_SIZE = 46;
const RECENTER_GAP = 16;
/** Below the place search box (72 px) plus room for the location message. */
const RECENTER_MIN_TOP = 140;

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
  // Identifies the current search (centre + 'Search this area' nonce) so the
  // effect can tell a new search from a filter/sort re-run.
  const lastSearchKey = useRef<string | null>(null);
  const latestViewport = useRef<MapViewport | null>(null);
  const [placeMarker, setPlaceMarker] = useState<Coordinate | null>(null);
  // After jumping to a searched place, offer "Search this area" there too.
  const offerSearchAfterMove = useRef(false);
  const authUser = useAuthStore((s) => s.user);
  const [etas, setEtas] = useState<Record<string, { duration_s: number; source: string }>>({});
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Collapsed height = measured top part of the sheet (see onLayout below).
  const [peekContentHeight, setPeekContentHeight] = useState<number | null>(null);
  const peekPx = peekContentHeight
    ? peekHeight(
        peekContentHeight,
        insets.bottom,
        SHEET_PEEK_MIN,
        SHEET_PEEK_MAX_FRACTION,
        windowHeight
      )
    : SHEET_PEEK_DEFAULT;
  const [screenH, setScreenH] = useState(windowHeight);
  const expandedPx = Math.max(
    peekPx + 1,
    expandedHeight(screenH, SHEET_EXPANDED, SHEET_KEEP_CLEAR_TOP, SHEET_EXPANDED_MIN)
  );
  const snapPoints = useMemo(() => [peekPx, expandedPx], [peekPx, expandedPx]);
  // Filters, sort chips and the list only render while the sheet is fully open.
  const [showAll, setShowAll] = useState(sheetPosition === 'expanded');
  // Keep cluster zooms clear of the bottom sheet (collapsed or expanded height).
  const overlayInsets = useMemo(
    () => ({
      top: 72, // place search box
      right: 0,
      left: 0,
      bottom: sheetPosition === 'expanded' ? expandedPx : peekPx,
    }),
    [sheetPosition, peekPx, expandedPx]
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

  // Current-location puck + recenter button.
  const { permission, location: userLocation, request: requestLocation } = useUserLocation();
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const pendingRecenter = useRef(false);
  const recenter = useCallback((coordinate: { latitude: number; longitude: number }) => {
    offerSearchAfterMove.current = true;
    mapRef.current?.focus({ coordinate, zoom: RECENTER_ZOOM });
  }, []);
  const handleRecenter = async () => {
    const action = recenterAction(permission, !!userLocation);
    if (action === 'center' && userLocation) return recenter(userLocation.coordinate);
    if (action === 'wait') {
      pendingRecenter.current = true;
      setLocationNotice('Finding your location…');
      return;
    }
    if (action === 'request') {
      const next = await requestLocation();
      if (next === 'granted') {
        pendingRecenter.current = true;
        return;
      }
      setLocationNotice(locationMessage(next));
      return;
    }
    setLocationNotice(locationMessage(permission));
  };
  // The ◎ button rides just above the sheet (and moves while it's dragged); it
  // hides when the sheet leaves no room below the search box, so it never
  // covers the results list.
  // Sheet top in this screen's px. The sheet's own container can be taller than
  // this screen (on web it is the whole window), but both end at the bottom, so
  // use the sheet's height: its container height (position / (1 - fraction))
  // minus its top (position).
  const sheetIndex = useSharedValue(0);
  const sheetTopPx = useSharedValue(0);
  const screenHeight = useSharedValue(windowHeight);
  const peekShared = useSharedValue(peekPx);
  const expandedShared = useSharedValue(expandedPx);
  const containerHeight = useSharedValue(0);
  useEffect(() => {
    peekShared.value = peekPx;
    expandedShared.value = expandedPx;
  }, [peekPx, expandedPx, peekShared, expandedShared]);
  // The sheet's container height, re-derived each time it rests on a snap point.
  useAnimatedReaction(
    () => [sheetIndex.value, sheetTopPx.value, peekShared.value, expandedShared.value] as const,
    ([index, position, peek, expanded]) => {
      containerHeight.value = sheetContainerHeight(
        index,
        position,
        peek,
        expanded,
        containerHeight.value
      );
    }
  );
  const recenterStyle = useAnimatedStyle(() => {
    const sheetHeight = containerHeight.value
      ? sheetVisibleHeight(containerHeight.value, sheetTopPx.value)
      : peekShared.value;
    const sheetTop = screenHeight.value - sheetHeight;
    const top = recenterButtonTop(sheetTop, RECENTER_SIZE, RECENTER_GAP, RECENTER_MIN_TOP);
    return top === null ? { opacity: 0, top: RECENTER_MIN_TOP } : { opacity: 1, top };
  });
  // Center as soon as the first fix arrives after a recenter tap.
  useEffect(() => {
    if (pendingRecenter.current && userLocation) {
      pendingRecenter.current = false;
      setLocationNotice(null);
      recenter(userLocation.coordinate);
    }
  }, [userLocation, recenter]);
  // A denial at launch gets one short message; it fades after a few seconds.
  useEffect(() => {
    const msg = locationMessage(permission);
    if (msg) setLocationNotice(msg);
  }, [permission]);
  useEffect(() => {
    if (!locationNotice) return;
    const timer = setTimeout(() => setLocationNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [locationNotice]);

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

  // Sidebar counts drive the toggle's red badge: refresh on focus, sign-in/out,
  // and every 60 s while the map is on screen.
  const refreshSidebar = useSidebarStore((s) => s.refresh);
  useFocusEffect(
    useCallback(() => {
      refreshSidebar();
      const timer = setInterval(refreshSidebar, 60_000);
      return () => clearInterval(timer);
    }, [refreshSidebar])
  );
  const authUserId = authUser?.id;
  useEffect(() => {
    refreshSidebar();
  }, [authUserId, refreshSidebar]);

  // Vehicle filter starts at the signed-in user's default vehicle type (All for
  // guests or without a default vehicle); re-applied when the account changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let type: string | null = null;
      if (authUserId) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('vehicle_type')
          .eq('driver_id', authUserId)
          .eq('is_default', true)
          .maybeSingle();
        type = vehicle?.vehicle_type ?? null;
      }
      if (!cancelled) setFilters({ vehicleType: defaultVehicleFilter(!!authUserId, type) });
    })();
    return () => {
      cancelled = true;
    };
  }, [authUserId, setFilters]);

  useEffect(() => {
    // Each search recomputes the slider max from the visible map. A new search
    // (first load, 'Search this area') sets the distance to that max; a re-run
    // for a filter/sort change keeps the user's value, clamped under the max.
    const searchKey = `${location.lat},${location.lng},${searchNonce}`;
    const isNewSearch = lastSearchKey.current !== searchKey;
    lastSearchKey.current = searchKey;
    const origin: [number, number] = [location.lng, location.lat];
    const viewport = latestViewport.current;
    const farthest = viewport
      ? Math.max(
          ...[
            [viewport.bounds.ne.longitude, viewport.bounds.ne.latitude],
            [viewport.bounds.sw.longitude, viewport.bounds.sw.latitude],
            [viewport.bounds.ne.longitude, viewport.bounds.sw.latitude],
            [viewport.bounds.sw.longitude, viewport.bounds.ne.latitude],
          ].map((corner) => distanceMeters(origin, corner as [number, number]))
        )
      : // Before the map reports its first viewport: estimate from the opening zoom.
        centerToCornerMeters(windowWidth, windowHeight, SEARCH_START_ZOOM, location.lat);
    const maxKm = sliderMaxKm(farthest);
    setDistanceMaxKm(maxKm);
    const next = distanceAfterSearch(isNewSearch, filters.distanceKm, maxKm);
    if (next !== filters.distanceKm) {
      setFilters({ distanceKm: next }); // re-runs this effect (same search) with the new value
      return;
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
          {etas[item.id] ? ` · ${etaText(etas[item.id], formatDuration)}` : ''}
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

      <Text
        style={[styles.listItemRating, !item.review_count && styles.listItemNotRated]}
        numberOfLines={1}
        testID={`list-rating-${item.id}`}
      >
        {formatListingRating(item.avg_rating, item.review_count)}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        screenHeight.value = e.nativeEvent.layout.height;
        setScreenH(e.nativeEvent.layout.height);
      }}
    >
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
        userLocation={userLocation}
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

      <Animated.View style={[styles.recenterWrap, recenterStyle]}>
        {/* Hidden over the expanded sheet: never intercept taps on the list. */}
        <View
          style={styles.recenterInner}
          pointerEvents={sheetPosition === 'expanded' ? 'none' : 'box-none'}
        >
          {locationNotice ? (
            <View style={styles.locationNotice} testID="location-notice">
              <Text style={styles.locationNoticeText}>{locationNotice}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.recenterButton}
            onPress={handleRecenter}
            accessibilityRole="button"
            accessibilityLabel="Center the map on my location"
            testID="recenter-button"
          >
            <View
              style={[
                styles.recenterIcon,
                permission === 'granted' && userLocation ? styles.recenterIconActive : null,
              ]}
            >
              <View style={styles.recenterDot} />
            </View>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Bottom sheet: swipe up/down anywhere on it (header or list) to expand/restore. */}
      <BottomSheet
        ref={sheetRef}
        animatedIndex={sheetIndex}
        animatedPosition={sheetTopPx}
        index={sheetPosition === 'expanded' ? 1 : 0}
        snapPoints={snapPoints}
        onChange={(index) => {
          setShowAll(index >= 1);
          setSheetPosition(index >= 1 ? 'expanded' : 'peek');
        }}
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
          {/* Top part: always shown; its height (with filters hidden) is the collapsed height. */}
          <View
            testID="sheet-top"
            onLayout={(e) => {
              if (!showAll) setPeekContentHeight(e.nativeEvent.layout.height);
            }}
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
                  <Text style={styles.sheetTitle} testID="sheet-title">
                    Search Result
                  </Text>
                  <Text
                    style={styles.sheetSummary}
                    numberOfLines={1}
                    testID="search-summary"
                    accessibilityLiveRegion="polite"
                  >
                    {loading ? 'Searching…' : error ? 'Search failed' : searchSummary(results)}
                  </Text>
                </View>
              </View>

              {/* Vehicle, Rate, Show Full; wraps onto a second line on narrow screens. Only when expanded. */}
              {showAll ? (
                <View style={styles.filterRow} testID="filter-row">
                  <FilterDropdown
                    label="Vehicle"
                    showLabel={false}
                    value={isVehicleType(filters.vehicleType) ? filters.vehicleType : null}
                    options={VEHICLE_FILTER_OPTIONS}
                    onChange={(vehicleType) => setFilters({ vehicleType })}
                    testID="search-vehicle-filter"
                  />
                  <FilterDropdown
                    label="Rate type"
                    showLabel={false}
                    value={isRateType(filters.rateType) ? filters.rateType : null}
                    options={RATE_FILTER_OPTIONS}
                    onChange={(rateType) => setFilters({ rateType })}
                    testID="filter-rate-type"
                  />
                  <TouchableOpacity
                    style={[styles.filterChip, filters.showFull && styles.filterChipActive]}
                    onPress={() => setFilters({ showFull: !filters.showFull })}
                    accessibilityState={{ selected: filters.showFull }}
                    testID="filter-show-full"
                  >
                    <Text style={styles.filterChipText}>Show Full</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <DistanceSlider
                valueKm={filters.distanceKm}
                maxKm={distanceMaxKm}
                onChangeKm={(km) => {
                  setFilters({ distanceKm: km });
                }}
                testID="filter-distance"
              />
            </View>
          </View>

          {showAll ? (
            <>
              <View style={styles.sortRow}>
                <Text style={styles.sortLabel}>Sort by:</Text>
                {SORT_OPTIONS.map((sort) => (
                  <TouchableOpacity
                    key={sort}
                    style={[styles.sortChip, sortBy === sort && styles.sortChipActive]}
                    onPress={() => setSortBy(sort)}
                    testID={`sort-${sort}`}
                  >
                    <Text
                      style={[styles.sortChipText, sortBy === sort && styles.sortChipTextActive]}
                    >
                      {SORT_LABELS[sort]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <BottomSheetFlatList
                data={
                  sortBy === 'eta'
                    ? [...results].sort(
                        (a, b) =>
                          (etas[a.id]?.duration_s || 99999) - (etas[b.id]?.duration_s || 99999)
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
            </>
          ) : null}
        </View>
      </BottomSheet>

      <Sidebar hasWorkspace={hasWorkspace} />
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
  recenterWrap: {
    position: 'absolute',
    right: theme.spacing.md,
    left: theme.spacing.md,
    zIndex: 5,
  },
  recenterInner: { alignItems: 'flex-end' },
  recenterButton: {
    width: RECENTER_SIZE,
    height: RECENTER_SIZE,
    borderRadius: RECENTER_SIZE / 2,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.md,
  },
  recenterIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.text.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recenterIconActive: { borderColor: theme.colors.primary },
  recenterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  locationNotice: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: RECENTER_SIZE + theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(17,24,39,0.88)',
  },
  locationNoticeText: { ...theme.typography.bodySmall, color: '#fff' },
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
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
  listItemRating: {
    ...theme.typography.caption,
    color: theme.colors.warning,
    fontWeight: '600',
    marginTop: theme.spacing.xs,
  },
  listItemNotRated: { color: theme.colors.text.tertiary, fontWeight: '400' },
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
