import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { MapHandle, MapProps } from './types';
import { DEFAULT_MAP_ZOOM, MAP_LABEL_FONT, MAP_STYLE_URL, mapCenter } from './style';
import { cameraForPlace, cameraForPoints, NO_INSETS, type LngLat } from './camera';
import {
  CLUSTER_LABEL_EXPRESSION,
  CLUSTER_PROPERTIES,
  PIN_IMAGE_EXPRESSION,
  PIN_LABEL_OFFSET,
  PIN_LABEL_SIZE,
  USER_PUCK,
} from './pins';

const PIN_IMAGES = {
  'pin-open': require('../../../assets/map/pin-open.png'),
  'pin-full': require('../../../assets/map/pin-full.png'),
  'pin-stale': require('../../../assets/map/pin-stale.png'),
  'pin-place': require('../../../assets/map/pin-place.png'),
};

MapLibreGL.setAccessToken(null);

export const Map = forwardRef<MapHandle, MapProps>(function Map(
  {
    region,
    initialZoom = DEFAULT_MAP_ZOOM,
    pins = [],
    onPinPress,
    onMapPress,
    style,
    showsUserLocation = true,
    clusterPins = true,
    overlayInsets = NO_INSETS,
    onViewportChange,
    focusMarker,
    userLocation,
  },
  ref
) {
  const centerCoordinate = useMemo(() => mapCenter(region), [region]);
  const mapViewRef = useRef<React.ElementRef<typeof MapLibreGL.MapView>>(null);
  const cameraRef = useRef<React.ElementRef<typeof MapLibreGL.Camera>>(null);
  const sourceRef = useRef<React.ElementRef<typeof MapLibreGL.ShapeSource>>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const insetsRef = useRef(overlayInsets);
  insetsRef.current = overlayInsets;
  const firstRegion = useRef(true);

  // Re-centre when the caller changes `region` (the camera is otherwise
  // uncontrolled so user pans and cluster zooms are not snapped back).
  useEffect(() => {
    if (firstRegion.current) {
      firstRegion.current = false;
      return;
    }
    cameraRef.current?.setCamera({
      centerCoordinate,
      zoomLevel: initialZoom,
      animationDuration: 1000,
      animationMode: 'flyTo',
    });
  }, [centerCoordinate, initialZoom]);

  useImperativeHandle(ref, () => ({
    focus: (target) => {
      const camera = cameraForPlace(target, sizeRef.current, insetsRef.current);
      if (!camera) return;
      cameraRef.current?.setCamera({
        centerCoordinate: camera.center,
        zoomLevel: camera.zoom,
        animationDuration: 1200,
        animationMode: 'flyTo',
      });
    },
  }));

  const focusShape = useMemo(
    () =>
      focusMarker
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Point' as const,
              coordinates: [focusMarker.longitude, focusMarker.latitude],
            },
          }
        : null,
    [focusMarker]
  );

  const userShape = useMemo(
    () =>
      userLocation
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Point' as const,
              coordinates: [userLocation.coordinate.longitude, userLocation.coordinate.latitude],
            },
          }
        : null,
    [userLocation]
  );

  const expandCluster = async (feature: GeoJSON.Feature) => {
    const source = sourceRef.current;
    if (!source) return;
    try {
      const count = Number(feature.properties?.point_count) || 100;
      const [leaves, expansionZoom] = await Promise.all([
        source.getClusterLeaves(feature, count, 0),
        source.getClusterExpansionZoom(feature).catch(() => DEFAULT_MAP_ZOOM + 2),
      ]);
      const points = (leaves?.features || [])
        .map((f: any) => f?.geometry?.coordinates as LngLat | undefined)
        .filter((c): c is LngLat => Array.isArray(c));
      const camera = cameraForPoints(points, sizeRef.current, {
        insets: insetsRef.current,
        fallbackZoom: Math.max(expansionZoom, 16),
      });
      if (!camera) return;
      cameraRef.current?.setCamera({
        centerCoordinate: camera.center,
        zoomLevel: camera.zoom,
        animationDuration: 600,
        animationMode: 'easeTo',
      });
    } catch (err) {
      console.warn('Cluster expansion failed', err);
    }
  };

  const pinFeatures = useMemo(
    () =>
      pins.map((pin) => ({
        type: 'Feature' as const,
        id: pin.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [pin.coordinate.longitude, pin.coordinate.latitude],
        },
        properties: {
          id: pin.id,
          availableCount: pin.availableCount,
          availableSlots: pin.availableSlots ?? Math.max(0, pin.availableCount || 0),
          pinLabel: pin.pinLabel || String(pin.availableCount),
          isStale: pin.isStale,
          isFull: pin.isFull,
          title: pin.title,
        },
      })),
    [pins]
  );

  const pinGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: pinFeatures,
    }),
    [pinFeatures]
  );

  return (
    <View
      style={[styles.map, style]}
      onLayout={(e: LayoutChangeEvent) => {
        sizeRef.current = {
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        };
      }}
    >
      <MapLibreGL.MapView
        ref={mapViewRef}
        style={styles.map}
        onDidFinishLoadingMap={async () => {
          // Report the first viewport so callers know the visible area at start.
          const view = mapViewRef.current;
          if (!view || !onViewportChange) return;
          try {
            const [[neLng, neLat], [swLng, swLat]] = await view.getVisibleBounds();
            const [lng, lat] = await view.getCenter();
            const zoom = await view.getZoom();
            onViewportChange({
              center: { latitude: lat, longitude: lng },
              zoom,
              bounds: {
                ne: { latitude: neLat, longitude: neLng },
                sw: { latitude: swLat, longitude: swLng },
              },
              isUserInteraction: false,
            });
          } catch (err) {
            console.warn('Initial viewport unavailable', err);
          }
        }}
        mapStyle={MAP_STYLE_URL}
        compassEnabled
        logoEnabled={false}
        attributionEnabled={false}
        onRegionDidChange={(feature: any) => {
          if (!onViewportChange) return;
          const props = feature?.properties || {};
          const [lng, lat] = feature?.geometry?.coordinates || [];
          const [ne, sw] = props.visibleBounds || [];
          if (lng == null || !ne || !sw) return;
          onViewportChange({
            center: { latitude: lat, longitude: lng },
            zoom: props.zoomLevel,
            bounds: {
              ne: { latitude: ne[1], longitude: ne[0] },
              sw: { latitude: sw[1], longitude: sw[0] },
            },
            isUserInteraction: !!props.isUserInteraction,
          });
        }}
        onPress={(feature) => {
          const geometry = feature.geometry;
          if (!geometry || geometry.type !== 'Point' || !onMapPress) return;
          onMapPress({
            longitude: geometry.coordinates[0],
            latitude: geometry.coordinates[1],
          });
        }}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate,
            zoomLevel: initialZoom,
          }}
        />

        <MapLibreGL.Images images={PIN_IMAGES} />

        {showsUserLocation && !userShape && <MapLibreGL.UserLocation visible />}

        {userShape && (
          <MapLibreGL.ShapeSource id="user-location" shape={userShape}>
            <MapLibreGL.CircleLayer
              id="user-location-halo"
              style={{ circleRadius: 18, circleColor: USER_PUCK.halo, circleOpacity: 0.18 }}
            />
            <MapLibreGL.CircleLayer
              id="user-location-dot"
              style={{
                circleRadius: 7,
                circleColor: USER_PUCK.dot,
                circleStrokeColor: USER_PUCK.ring,
                circleStrokeWidth: 3,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {pinGeoJSON.features.length > 0 && (
          <MapLibreGL.ShapeSource
            ref={sourceRef}
            id="location-pins"
            shape={pinGeoJSON}
            cluster={clusterPins}
            clusterProperties={CLUSTER_PROPERTIES as any}
            clusterRadius={50}
            clusterMaxZoomLevel={14}
            hitbox={{ width: 44, height: 72 }}
            onPress={(event) => {
              const feature = event.features?.[0];
              if (feature?.properties?.cluster || feature?.properties?.point_count) {
                expandCluster(feature);
                return;
              }
              const locationId = feature?.properties?.id;
              if (locationId) onPinPress?.(String(locationId));
            }}
          >
            <MapLibreGL.CircleLayer
              id="cluster-circle"
              filter={['has', 'point_count']}
              style={{
                circleColor: '#2563eb',
                circleRadius: 20,
                circleOpacity: 0.9,
              }}
            />

            <MapLibreGL.SymbolLayer
              id="cluster-count"
              filter={['has', 'point_count']}
              style={{
                textField: CLUSTER_LABEL_EXPRESSION as any,
                textSize: 12,
                textColor: '#ffffff',
                textFont: MAP_LABEL_FONT,
                textAllowOverlap: true,
              }}
            />

            {/* Single listings: teardrop pin whose tip marks the exact entrance. */}
            <MapLibreGL.SymbolLayer
              id="pin-marker"
              filter={['!', ['has', 'point_count']]}
              style={{
                iconImage: PIN_IMAGE_EXPRESSION as any,
                iconAnchor: 'bottom',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                textField: ['get', 'pinLabel'],
                textSize: PIN_LABEL_SIZE,
                textColor: '#ffffff',
                textFont: MAP_LABEL_FONT,
                textOffset: PIN_LABEL_OFFSET,
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}
        {focusShape && (
          <MapLibreGL.ShapeSource id="focus-place" shape={focusShape}>
            <MapLibreGL.SymbolLayer
              id="focus-place-marker"
              style={{
                iconImage: 'pin-place',
                iconAnchor: 'bottom',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}
      </MapLibreGL.MapView>
    </View>
  );
});

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
