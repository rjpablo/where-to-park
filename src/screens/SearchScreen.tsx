import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
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
import { useLocateMe } from '../hooks/useLocateMe';
import { RECENTER_ZOOM } from '../lib/userLocation';
import { LocateButton, LocationNotice } from '../components/map/LocateButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  maximizedHeight,
  nextSheetMode,
  normalHeight,
  peekHeight,
  sheetModeAt,
  sheetModeIndex,
} from '../lib/sheetLayout';
import { useSidebarStore } from '../stores/sidebarStore';
import { DistanceSlider } from '../components/DistanceSlider';
import { availableSlots, searchSummary } from '../lib/availability';
import { etaText } from '../lib/listingEta';
import { listingPoint } from '../lib/geog';
import { navigateLabel, preferredNavApp } from '../lib/navigation';
import { openNavigation } from '../lib/openNavigation';
import {
  MAX_DISTANCE_KM,
  SEARCH_START_ZOOM,
  centerToCornerMeters,
  distanceAfterSearch,
  sliderMaxKm,
} from '../lib/distance';
import { getGeocoder, type PlaceSuggestion } from '../lib/geocoding';
import { firstParam } from '../lib/params';
import {
  parseSearchLink,
  sameSearchCenter,
  searchCenterKey,
  searchDocumentDescription,
  searchDocumentTitle,
  searchLinkParams,
  type SearchCenter,
} from '../lib/searchLink';
import { distanceMeters } from '../components/map/camera';
import { formatPeso, formatDistance, formatDuration } from '../utils/formatters';
import { theme } from '../lib/theme';
import { FilterDropdown } from '../components/FilterDropdown';
import { cardRateText, isRateType, RATE_FILTER_OPTIONS } from '../lib/rates';
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
import { useBottomInset } from '../hooks/useBottomInset';
import { listingAvailability, listingPinLabel, visibleResults } from '../lib/areas';
import { useAvailabilityChanges } from '../hooks/useAvailabilityChanges';
import { changeAffectsSearch, LIVE_REFRESH_DEBOUNCE_MS } from '../lib/liveAvailability';

// Results sheet, three modes (snap points, drag the handle between them):
// - Minimized: fits its top part (title, summary, one row of filters, distance slider);
// - Normal: 65% of the search screen (the area below the header); every new search
//   opens the sheet in Normal;
// - Maximized: its top sits SHEET_MAX_GAP px below the header, so that much map shows.
// The sort chips and the list are always rendered below the top part (clipped when
// Minimized), so changing mode needs no re-render. The sheet is drawn above every map
// element (search box, 'Search this area', pins, location dot and the ◎ button, which
// share one overlay layer under the sheet).
const SHEET_NORMAL_FRACTION = 0.65;
const SHEET_MAX_GAP = 10;
/** Minimized height until the top part has been measured, and its limits. */
const SHEET_PEEK_DEFAULT = 170;
const SHEET_PEEK_MIN = 120;
const SHEET_PEEK_MAX_FRACTION = 0.5;
/** Above the map overlay layer (search box, 'Search this area', ◎: zIndex 10 / elevation 12). */
const SHEET_LAYER = 30;
// Gap between the ◎ button and the top of the Minimized sheet.
const RECENTER_GAP = 16;
/** Screen size of the centre cursor (the Search this area spot). */
const CENTRE_CURSOR = 28;
/** Default search origin until the driver searches or opens a link with coordinates. */
const BAGUIO_CENTRE: SearchCenter = { lat: 16.4023, lng: 120.596 };

export function SearchScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{
    lat?: string | string[];
    lng?: string | string[];
    place?: string | string[];
  }>();
  // First paint only: a link already in the URL, so the map and the first search
  // start there. Later links are applied in the effect below.
  const openingLink = useRef(parseSearchLink(routeParams)).current;
  const openingCenter = openingLink
    ? { lat: openingLink.lat, lng: openingLink.lng }
    : BAGUIO_CENTRE;
  const {
    results,
    loading,
    error,
    search,
    refresh,
    lastSearch,
    filters,
    sortBy,
    setFilters,
    setSortBy,
    sheetPosition,
    setSheetPosition,
  } = useSearchStore();
  // Search origin: Baguio, unless the URL already names a centre.
  const [location, setLocation] = useState(openingCenter);
  const locationRef = useRef(openingCenter);
  locationRef.current = location;
  const [placeLabel, setPlaceLabel] = useState<string | null>(openingLink?.place ?? null);
  const placeLabelRef = useRef(placeLabel);
  placeLabelRef.current = placeLabel;
  const [searchNonce, setSearchNonce] = useState(0);
  const [movedViewport, setMovedViewport] = useState<MapViewport | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const [mapCenter, setMapCenter] = useState<Coordinate>({
    latitude: openingCenter.lat,
    longitude: openingCenter.lng,
  });
  // Slider max = distance from the search centre to the farthest visible corner.
  const [distanceMaxKm, setDistanceMaxKm] = useState(MAX_DISTANCE_KM);
  // Identifies the current search (centre + 'Search this area' nonce) so the
  // effect can tell a new search from a filter/sort re-run.
  const lastSearchKey = useRef<string | null>(null);
  const latestViewport = useRef<MapViewport | null>(null);
  // After jumping to a searched place, offer "Search this area" there too.
  const offerSearchAfterMove = useRef(false);
  // Name from the search box, kept until the driver pans, recenters, or clears it.
  const pickedName = useRef<string | null>(null);
  // Centre we last wrote into the URL, so that write does not search again.
  const localPublish = useRef<string | null>(null);
  // Coordinates we already reverse-geocoded (or that arrived with a name).
  const reversedFor = useRef<string | null>(
    openingLink?.place ? searchCenterKey(openingCenter) : null
  );
  const linkSeq = useRef(0);
  const authUser = useAuthStore((s) => s.user);
  // Row Navigate buttons use the same map app as the details page (phone default for guests).
  const navApp = preferredNavApp(authUser?.preferred_nav_app);
  const [etas, setEtas] = useState<Record<string, { duration_s: number; source: string }>>({});
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Expanded, the sheet reaches the screen bottom (behind the nav bar): end the list above it.
  const listBottom = useBottomInset(theme.spacing.lg);
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
  // screenH is this screen's height, which starts right under the header.
  const normalPx = normalHeight(screenH, SHEET_NORMAL_FRACTION, peekPx);
  const maxPx = maximizedHeight(screenH, SHEET_MAX_GAP, normalPx);
  const snapPoints = useMemo(() => [peekPx, normalPx, maxPx], [peekPx, normalPx, maxPx]);
  const currentSheetPx = snapPoints[sheetModeIndex(sheetPosition)];
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // Keep cluster zooms clear of the bottom sheet (collapsed or expanded height).
  const overlayInsets = useMemo(
    () => ({
      top: 72, // place search box
      right: 0,
      left: 0,
      bottom: currentSheetPx,
    }),
    [currentSheetPx]
  );

  // Initial camera only; later moves come from the user, clusters, place search, or a link.
  const region = useRef<MapRegion>({
    latitude: openingCenter.lat,
    longitude: openingCenter.lng,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  }).current;

  const handleViewportChange = useCallback((viewport: MapViewport) => {
    const user = viewport.isUserInteraction;
    const first = latestViewport.current == null;
    latestViewport.current = viewport;
    // A place pick or the current-location button asked for the button, even
    // when that jump is not a finger on the map.
    if (offerSearchAfterMove.current) {
      offerSearchAfterMove.current = false;
      setMapCenter(viewport.center);
      setMovedViewport(viewport);
      return;
    }
    setMapCenter(viewport.center);
    // Opening the map is not a reason to offer another search.
    if (first) {
      setSearchNonce((n) => n + 1);
      return;
    }
    // Hidden by a parking search. A pan or zoom of the map brings it back.
    if (user) {
      pickedName.current = null;
      setMovedViewport(viewport);
    }
  }, []);

  // Current-location puck + recenter button.
  const recenter = useCallback((coordinate: { latitude: number; longitude: number }) => {
    pickedName.current = null;
    offerSearchAfterMove.current = true;
    // The centre cursor marks the map centre, so the puck is placed there.
    mapRef.current?.focus({ coordinate, zoom: RECENTER_ZOOM }, { atCenter: true });
  }, []);
  const {
    permission,
    location: userLocation,
    notice: locationNotice,
    locate: handleRecenter,
  } = useLocateMe(recenter);

  const handlePlaceSelect = useCallback((place: PlaceSuggestion) => {
    pickedName.current = place.name;
    offerSearchAfterMove.current = true;
    mapRef.current?.focus(place, { atCenter: true });
  }, []);

  // Writes lat/lng/place on the web and keeps the document title in step.
  // A picked name is used as-is. Otherwise one reverse lookup fills it in;
  // the parking search does not wait for that lookup.
  const publishSearchLink = useCallback(
    async (center: SearchCenter, knownName: string | null) => {
      const seq = ++linkSeq.current;
      const key = searchCenterKey(center);
      localPublish.current = key;
      reversedFor.current = key;
      const nameNow = knownName?.trim() || null;
      placeLabelRef.current = nameNow;
      setPlaceLabel(nameNow);
      if (Platform.OS === 'web') {
        router.setParams({
          ...searchLinkParams({ ...center, place: nameNow }),
          // Drop a previous name while a new one is still being looked up.
          place: nameNow ?? '',
        });
      }
      if (nameNow) return;
      let resolved: string | null = null;
      try {
        resolved = await getGeocoder().reverse({
          latitude: center.lat,
          longitude: center.lng,
        });
      } catch {
        resolved = null;
      }
      if (seq !== linkSeq.current) return;
      if (!sameSearchCenter(center, locationRef.current)) return;
      const name = resolved?.trim() || null;
      if (!name) return;
      placeLabelRef.current = name;
      setPlaceLabel(name);
      if (Platform.OS === 'web') router.setParams({ place: name });
    },
    [router]
  );

  const latParam = firstParam(routeParams.lat);
  const lngParam = firstParam(routeParams.lng);
  const placeParam = firstParam(routeParams.place);
  // A URL with coordinates (including one that arrives while this screen is open)
  // becomes the search. Our own address update is ignored.
  useEffect(() => {
    const linked = parseSearchLink({ lat: latParam, lng: lngParam, place: placeParam });
    if (!linked) return;
    const center: SearchCenter = { lat: linked.lat, lng: linked.lng };
    const key = searchCenterKey(center);
    const same = sameSearchCenter(center, locationRef.current);
    if (same && localPublish.current === key) {
      if (linked.place && linked.place !== placeLabelRef.current) {
        placeLabelRef.current = linked.place;
        setPlaceLabel(linked.place);
      }
      return;
    }
    if (!same) {
      localPublish.current = null;
      pickedName.current = null;
      locationRef.current = center;
      placeLabelRef.current = linked.place;
      setLocation(center);
      setPlaceLabel(linked.place);
      setMovedViewport(null);
      setSearchNonce((n) => n + 1);
      mapRef.current?.focus(
        {
          coordinate: { latitude: center.lat, longitude: center.lng },
          zoom: SEARCH_START_ZOOM,
        },
        { atCenter: true }
      );
    } else if (linked.place && linked.place !== placeLabelRef.current) {
      placeLabelRef.current = linked.place;
      setPlaceLabel(linked.place);
    }
    if (!linked.place && reversedFor.current !== key) {
      void publishSearchLink(center, null);
    }
  }, [latParam, lngParam, placeParam, publishSearchLink]);

  const searchThisArea = () => {
    if (!movedViewport) return;
    // Inertia from the pan that revealed the button must not bring it back.
    mapRef.current?.settle();
    // The live camera, not the viewport from when the button appeared.
    const view = mapRef.current?.readViewport() ?? latestViewport.current;
    if (!view) return;
    latestViewport.current = view;
    // The cursor sits on the map centre, so that centre is the search point.
    const next: SearchCenter = { lat: view.center.latitude, lng: view.center.longitude };
    locationRef.current = next;
    // The search effect recomputes the slider max for this centre and viewport.
    setLocation(next);
    setMovedViewport(null);
    setSearchNonce((n) => n + 1);
    const known = pickedName.current;
    pickedName.current = null;
    void publishSearchLink(next, known);
  };

  // rj t140u: Full listings are only shown (grey pin / row) while 'Show Full' is on.
  const shown = useMemo(
    () => visibleResults(results, filters.showFull),
    [results, filters.showFull]
  );

  // Convert search results to map pins
  const pins: LocationPin[] = useMemo(
    () =>
      shown.map((result) => ({
        id: result.id,
        coordinate: {
          latitude: result.latitude,
          longitude: result.longitude,
        },
        availableCount: result.available_count || 0,
        availableSlots: availableSlots(result),
        // The monitored free total; empty green pin when available with no number;
        // grey '0' when Full (rj t140u).
        pinLabel: listingPinLabel(result.available_count, result.open_status),
        isStale:
          result.stale_after_min && result.availability_updated_at
            ? new Date().getTime() - new Date(result.availability_updated_at).getTime() >
              result.stale_after_min * 60 * 1000
            : false,
        isFull: listingAvailability(result.available_count, result.open_status).full,
        title: result.name,
      })),
    [shown]
  );

  const handlePinPress = (locationId: string) => {
    router.push(`/location/${locationId}`);
  };

  useEffect(() => {
    if (!authUser) {
      setHasWorkspace(false);
      return;
    }
    // Account switch: don't keep the previous account's workspace while loading.
    setHasWorkspace(!!authUser.is_admin || authUser.account_type === 'operator');
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
    // Every new search (first load, 'Search this area') opens the sheet in Normal.
    if (isNewSearch) {
      setSheetPosition('normal');
      sheetRef.current?.snapToIndex(sheetModeIndex('normal'));
    }
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

  // Live availability (rj t143u): a change to a listing in the results, or one inside the
  // searched circle that could now enter them, quietly re-runs the same search
  // (debounced, batched) so pins, cluster counts, the Show Full filtering and the sheet
  // rows all come from search_nearby / free_spaces again. The camera and sheet stay put.
  const resultIds = useMemo(() => new Set(results.map((r) => r.id)), [results]);
  useAvailabilityChanges(
    (change) => changeAffectsSearch(change, resultIds, lastSearch),
    () => {
      refresh();
    },
    LIVE_REFRESH_DEBOUNCE_MS
  );

  // ETAs follow the result ids only, so a live availability refresh does not re-fetch them.
  const etaIdsKey = useMemo(
    () =>
      results
        .slice(0, 20)
        .map((r) => r.id)
        .join(','),
    [results]
  );
  useEffect(() => {
    if (!etaIdsKey) return;
    const ids = etaIdsKey.split(',');
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
  }, [etaIdsKey, location.lat, location.lng]);

  // Stable list props: expanding or collapsing the sheet re-renders this screen, but
  // the rows only re-render when the results, ETAs or nav app change.
  const listData = useMemo(
    () =>
      sortBy === 'eta'
        ? [...shown].sort(
            (a, b) => (etas[a.id]?.duration_s || 99999) - (etas[b.id]?.duration_s || 99999)
          )
        : shown,
    [sortBy, shown, etas]
  );
  const renderListItem = useCallback(
    ({ item }: { item: (typeof results)[0] }) => (
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
            {cardRateText(item, formatPeso)}
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

        <View style={styles.listItemFooter}>
          <Text
            style={[styles.listItemRating, !item.review_count && styles.listItemNotRated]}
            numberOfLines={1}
            testID={`list-rating-${item.id}`}
          >
            {formatListingRating(item.avg_rating, item.review_count)}
          </Text>
          {/* Its own touchable: a tap here opens the map app, not the details page. */}
          <TouchableOpacity
            style={styles.listNavButton}
            onPress={(e) => {
              e?.stopPropagation?.();
              const point = listingPoint(item);
              if (point) openNavigation(navApp, { ...point, name: item.name });
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`${navigateLabel(navApp)}: ${item.name}`}
            testID={`list-navigate-${item.id}`}
          >
            <Text style={styles.listNavText} numberOfLines={1}>
              ➤ Navigate
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    ),
    [etas, navApp, router]
  );

  return (
    <View style={styles.container} onLayout={(e) => setScreenH(e.nativeEvent.layout.height)}>
      {Platform.OS === 'web' ? (
        <Head>
          <title>{searchDocumentTitle(placeLabel)}</title>
          <meta name="description" content={searchDocumentDescription(placeLabel)} />
        </Head>
      ) : null}
      {/* Map with location pins */}
      <Map
        ref={mapRef}
        region={region}
        initialZoom={SEARCH_START_ZOOM}
        pins={pins}
        onPinPress={handlePinPress}
        style={styles.map}
        showsUserLocation={false}
        userLocation={userLocation}
        clusterPins
        overlayInsets={overlayInsets}
        onViewportChange={handleViewportChange}
      />

      <View
        pointerEvents="none"
        style={styles.centreCursor}
        testID="map-centre-cursor"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <View style={styles.centreCursorRing} />
        <View style={styles.centreCursorDot} />
      </View>

      <View
        style={[styles.topOverlay, suggestionsOpen && styles.topOverlayRaised]}
        pointerEvents="box-none"
      >
        <PlaceSearchBox
          near={mapCenter}
          label={placeLabel}
          onSuggestionsVisibleChange={setSuggestionsOpen}
          onSelect={handlePlaceSelect}
          onClear={() => {
            pickedName.current = null;
          }}
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

      {/* ◎ button: fixed on the map overlay layer (under the sheet), at the right, RECENTER_GAP
          above the Minimized sheet. It follows the measured Minimized height, not the live
          sheet position, so Normal and Maximized simply cover it. Hidden while place
          suggestions are open (that layer is then lifted above the sheet). */}
      {!suggestionsOpen ? (
        <View
          style={[styles.recenterWrap, { bottom: peekPx + RECENTER_GAP }]}
          pointerEvents="box-none"
          testID="recenter-layer"
        >
          <LocationNotice text={locationNotice} />
          <LocateButton
            active={permission === 'granted' && !!userLocation}
            onPress={handleRecenter}
          />
        </View>
      ) : null}

      {/* Bottom sheet: swipe up/down anywhere on it (header or list) to expand/restore. */}
      <BottomSheet
        ref={sheetRef}
        index={sheetModeIndex(sheetPosition)}
        snapPoints={snapPoints}
        onChange={(index) => {
          if (index >= 0) setSheetPosition(sheetModeAt(index));
        }}
        handleComponent={null}
        // bottom-sheet v5 adds a content-sized snap point by default; ours are measured px.
        enableDynamicSizing={false}
        enablePanDownToClose={false}
        // Horizontal drags (distance slider, chips) must not move the sheet.
        activeOffsetY={[-8, 8]}
        failOffsetX={[-8, 8]}
        backgroundStyle={styles.sheetBackground}
        style={styles.sheet}
        // Draw the sheet above all map overlays; on Android sibling order follows
        // elevation, so it needs a higher elevation than the search box (12).
        containerStyle={styles.sheetLayer}
      >
        <View
          style={styles.sheetBody}
          testID={loading ? 'search-loading' : error ? 'search-error' : 'search-ready'}
        >
          {/* Top part: always shown; its measured height is the collapsed height. */}
          <View
            testID="sheet-top"
            onLayout={(e) => setPeekContentHeight(e.nativeEvent.layout.height)}
          >
            <TouchableOpacity
              testID="sheet-expand-toggle"
              accessibilityLabel="Toggle search sheet"
              onPress={() =>
                sheetRef.current?.snapToIndex(sheetModeIndex(nextSheetMode(sheetPosition)))
              }
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
                    {loading ? 'Searching…' : error ? 'Search failed' : searchSummary(shown)}
                  </Text>
                </View>
              </View>

              {/* Vehicle, Rate, Show Full in one row that scrolls sideways on narrow screens.
                  Gesture-handler ScrollView so it cooperates with the sheet's pan gesture
                  (the sheet only takes vertical drags: activeOffsetY / failOffsetX). */}
              <GestureScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterScroll}
                contentContainerStyle={styles.filterRow}
                keyboardShouldPersistTaps="handled"
                testID="filter-row"
              >
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
              </GestureScrollView>

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

          {/* Always mounted: collapsed, this sits below the visible part of the sheet. */}
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Sort by:</Text>
            {SORT_OPTIONS.map((sort) => (
              <TouchableOpacity
                key={sort}
                style={[styles.sortChip, sortBy === sort && styles.sortChipActive]}
                onPress={() => setSortBy(sort)}
                testID={`sort-${sort}`}
              >
                <Text style={[styles.sortChipText, sortBy === sort && styles.sortChipTextActive]}>
                  {SORT_LABELS[sort]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <BottomSheetFlatList
            data={listData}
            renderItem={renderListItem}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={[styles.listContent, listBottom]}
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
  // Fixed at the centre of the map. The results sheet does not move it.
  centreCursor: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: CENTRE_CURSOR,
    height: CENTRE_CURSOR,
    marginLeft: -CENTRE_CURSOR / 2,
    marginTop: -CENTRE_CURSOR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 12,
  },
  centreCursorRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.45,
    shadowRadius: 2,
  },
  centreCursorDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  // Right side, RECENTER_GAP above the Minimized sheet; below the sheet's layer.
  recenterWrap: {
    position: 'absolute',
    right: theme.spacing.md,
    alignItems: 'flex-end',
    zIndex: 10,
    elevation: 12,
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
  sheetLayer: {
    zIndex: SHEET_LAYER,
    elevation: SHEET_LAYER,
  },
  // While place suggestions are open they must show over the sheet.
  topOverlayRaised: {
    zIndex: SHEET_LAYER + 1,
    elevation: SHEET_LAYER + 1,
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
  filterScroll: {
    flexGrow: 0,
    // Bleed to the sheet edges so chips scroll under the side padding.
    marginHorizontal: -theme.spacing.lg,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
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
  listItemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  listItemRating: {
    ...theme.typography.caption,
    color: theme.colors.warning,
    fontWeight: '600',
    flexShrink: 1,
  },
  listNavButton: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  listNavText: { ...theme.typography.caption, color: theme.colors.primary, fontWeight: '600' },
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
