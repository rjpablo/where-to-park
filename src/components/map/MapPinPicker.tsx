import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { theme } from '../../lib/theme';
import { pickerMapHeight, remainingTouches, showRestorePin } from '../../lib/pinRestore';
import { RECENTER_ZOOM } from '../../lib/userLocation';
import type { PlaceSuggestion } from '../../lib/geocoding';
import { useLocateMe } from '../../hooks/useLocateMe';
import { PlaceSearchBox } from '../PlaceSearchBox';
import { LocateButton, LocationNotice } from './LocateButton';
import { Map } from './Map';
import { BAGUIO } from './style';
import { MapHandle, MapPinPickerProps, Coordinate, MapRegion } from './types';

/** The search box covers the top of the map; keep camera framing below it. */
const OVERLAY_INSETS = { top: 64, right: 0, bottom: 0, left: 0 };

// Tapping the map moves the pin and reports it (the form saves it); no confirm
// button and no coordinates text. Like Parking Search, a place search box (pick a result:
// the map moves there and the pin goes there) and the ◎ button (map and pin go to the
// device location). With savedCoordinate (edit listing), a small 'Restore saved pin'
// button shows while the pin is away from the saved spot.
export const MapPinPicker: React.FC<MapPinPickerProps> = ({
  initialCoordinate,
  onCoordinateSelect,
  savedCoordinate,
  onMapGestureChange,
  style,
}) => {
  const mapRef = useRef<MapHandle>(null);
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = pickerMapHeight(windowHeight);
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate>(
    initialCoordinate || BAGUIO
  );
  const [region, setRegion] = useState<MapRegion>({
    latitude: initialCoordinate?.latitude || BAGUIO.latitude,
    longitude: initialCoordinate?.longitude || BAGUIO.longitude,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const movePin = useCallback(
    (coordinate: Coordinate) => {
      setSelectedCoordinate(coordinate);
      onCoordinateSelect(coordinate);
    },
    [onCoordinateSelect]
  );

  // Put the pin back on the saved spot and recentre the map there.
  const handleRestore = useCallback(() => {
    if (!savedCoordinate) return;
    movePin(savedCoordinate);
    mapRef.current?.focus({ coordinate: savedCoordinate, zoom: RECENTER_ZOOM });
  }, [savedCoordinate, movePin]);

  const handlePlaceSelect = useCallback(
    (place: PlaceSuggestion) => {
      movePin(place.coordinate);
      mapRef.current?.focus(place);
    },
    [movePin]
  );

  const handleLocate = useCallback(
    (coordinate: Coordinate) => {
      movePin(coordinate);
      mapRef.current?.focus({ coordinate, zoom: RECENTER_ZOOM });
    },
    [movePin]
  );
  const { permission, location: userLocation, notice, locate } = useLocateMe(handleLocate);

  // Bug fix (rj): dragging the map scrolled the whole form. While any finger is on the map
  // the screen's ScrollView stops scrolling (scrollEnabled=false is set at touch start,
  // before the ScrollView claims the drag), so pans and pinches go to the map. Counting
  // touches keeps it off until the last finger lifts; unmount always turns it back on.
  const touches = useRef(0);
  const gestureRef = useRef(onMapGestureChange);
  gestureRef.current = onMapGestureChange;
  const touchStart = useCallback((e: any) => {
    if (touches.current === 0) gestureRef.current?.(true);
    touches.current = Math.max(1, remainingTouches(e?.nativeEvent, false));
  }, []);
  const touchEnd = useCallback((e: any) => {
    touches.current = remainingTouches(e?.nativeEvent, true);
    if (touches.current === 0) gestureRef.current?.(false);
  }, []);
  useEffect(
    () => () => {
      if (touches.current > 0) gestureRef.current?.(false);
    },
    []
  );

  return (
    <View style={[styles.container, style]} testID="map-pin-picker">
      <View
        style={[styles.mapWrap, { height: mapHeight }]}
        onTouchStart={touchStart}
        onTouchEnd={touchEnd}
        onTouchCancel={touchEnd}
        testID="pin-map-area"
      >
        <Map
          ref={mapRef}
          region={region}
          onRegionChange={setRegion}
          onMapPress={movePin}
          pins={[
            {
              id: 'selected',
              coordinate: selectedCoordinate,
              availableCount: 1,
              isStale: false,
              title: 'Selected pin',
            },
          ]}
          showsUserLocation={false}
          userLocation={userLocation}
          clusterPins={false}
          overlayInsets={OVERLAY_INSETS}
          style={{ ...styles.map, height: mapHeight }}
        />
        <View
          style={[styles.searchLayer, suggestionsOpen && styles.searchLayerOpen]}
          pointerEvents="box-none"
          testID="pin-search-layer"
        >
          <PlaceSearchBox
            near={selectedCoordinate}
            onSelect={handlePlaceSelect}
            onSuggestionsVisibleChange={setSuggestionsOpen}
          />
        </View>
        {showRestorePin(selectedCoordinate, savedCoordinate) ? (
          <TouchableOpacity
            onPress={handleRestore}
            style={styles.restore}
            accessibilityRole="button"
            accessibilityLabel="Restore saved pin"
            testID="pin-restore"
          >
            <Text style={styles.restoreIcon}>↺</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.locateLayer} pointerEvents="box-none">
          <LocationNotice text={notice} />
          <LocateButton
            active={permission === 'granted' && !!userLocation}
            onPress={locate}
            accessibilityLabel="Move the pin to my location"
            testID="pin-locate"
          />
        </View>
      </View>

      <Text style={styles.hint}>Search a place, tap ◎, or tap the map to drop the pin</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 300,
  },
  // Sized parent (height from the window): the web map is flex: 1.
  mapWrap: {
    width: '100%',
  },
  map: {
    width: '100%',
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  searchLayer: {
    position: 'absolute',
    top: theme.spacing.sm,
    left: theme.spacing.sm,
    right: theme.spacing.sm,
    zIndex: 20,
    elevation: 12,
  },
  // Suggestions may hang over the buttons: lift them above everything.
  searchLayerOpen: { zIndex: 40, elevation: 20 },
  restore: {
    position: 'absolute',
    bottom: theme.spacing.md,
    left: theme.spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  restoreIcon: {
    fontSize: 22,
    lineHeight: 26,
    color: theme.colors.primary,
    fontWeight: '700',
  },
  locateLayer: {
    position: 'absolute',
    right: theme.spacing.sm,
    bottom: theme.spacing.md,
    alignItems: 'flex-end',
    zIndex: 10,
    elevation: 6,
  },
  hint: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    paddingTop: theme.spacing.sm,
  },
});
