import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
// MapLibre React Native v11 (New Architecture only; MapLibre GL JS-style API).
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map as MapLibreMap,
  UserLocation,
  type CameraRef,
  type GeoJSONSourceRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { MapHandle, MapProps, MapViewport } from './types';
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

/** v11 bounds are [west, south, east, north]. */
function viewportFrom(
  center: [number, number] | number[],
  zoom: number,
  bounds: [number, number, number, number] | number[],
  isUserInteraction: boolean
): MapViewport {
  const [lng, lat] = center;
  const [west, south, east, north] = bounds;
  return {
    center: { latitude: lat, longitude: lng },
    zoom,
    bounds: {
      ne: { latitude: north, longitude: east },
      sw: { latitude: south, longitude: west },
    },
    isUserInteraction,
  };
}

const PIN_IMAGES = {
  'pin-open': require('../../../assets/map/pin-open.png'),
  'pin-full': require('../../../assets/map/pin-full.png'),
  'pin-stale': require('../../../assets/map/pin-stale.png'),
  'pin-place': require('../../../assets/map/pin-place.png'),
};

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
  const mapViewRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const sourceRef = useRef<GeoJSONSourceRef>(null);
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
    cameraRef.current?.flyTo({ center: centerCoordinate, zoom: initialZoom, duration: 1000 });
  }, [centerCoordinate, initialZoom]);

  useImperativeHandle(ref, () => ({
    focus: (target) => {
      const camera = cameraForPlace(target, sizeRef.current, insetsRef.current);
      if (!camera) return;
      cameraRef.current?.flyTo({ center: camera.center, zoom: camera.zoom, duration: 1200 });
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
      // v11 cluster methods take the cluster_id, not the feature.
      const clusterId = Number(feature.properties?.cluster_id);
      if (!Number.isFinite(clusterId)) return;
      const [leaves, expansionZoom] = await Promise.all([
        source.getClusterLeaves(clusterId, count, 0),
        source.getClusterExpansionZoom(clusterId).catch(() => DEFAULT_MAP_ZOOM + 2),
      ]);
      const points = (leaves || [])
        .map((f: any) => f?.geometry?.coordinates as LngLat | undefined)
        .filter((c): c is LngLat => Array.isArray(c));
      const camera = cameraForPoints(points, sizeRef.current, {
        insets: insetsRef.current,
        fallbackZoom: Math.max(expansionZoom, 16),
      });
      if (!camera) return;
      cameraRef.current?.easeTo({ center: camera.center, zoom: camera.zoom, duration: 600 });
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
      <MapLibreMap
        ref={mapViewRef}
        style={styles.map}
        mapStyle={MAP_STYLE_URL}
        compass
        logo={false}
        attribution={false}
        onDidFinishLoadingMap={async () => {
          // Report the first viewport so callers know the visible area at start.
          const view = mapViewRef.current;
          if (!view || !onViewportChange) return;
          try {
            const [bounds, center, zoom] = await Promise.all([
              view.getBounds(),
              view.getCenter(),
              view.getZoom(),
            ]);
            onViewportChange(viewportFrom(center, zoom, bounds, false));
          } catch (err) {
            console.warn('Initial viewport unavailable', err);
          }
        }}
        onRegionDidChange={(event) => {
          if (!onViewportChange) return;
          const { center, zoom, bounds, userInteraction } = event.nativeEvent;
          if (!center || !bounds) return;
          onViewportChange(viewportFrom(center, zoom, bounds, !!userInteraction));
        }}
        onPress={(event) => {
          const [longitude, latitude] = event.nativeEvent.lngLat || [];
          if (longitude == null || latitude == null || !onMapPress) return;
          onMapPress({ longitude, latitude });
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: centerCoordinate, zoom: initialZoom }}
        />

        <Images images={PIN_IMAGES} />

        {showsUserLocation && !userShape && <UserLocation />}

        {userShape && (
          <GeoJSONSource id="user-location" data={userShape}>
            <Layer
              type="circle"
              id="user-location-halo"
              paint={{
                'circle-radius': 18,
                'circle-color': USER_PUCK.halo,
                'circle-opacity': 0.18,
              }}
            />
            <Layer
              type="circle"
              id="user-location-dot"
              paint={{
                'circle-radius': 7,
                'circle-color': USER_PUCK.dot,
                'circle-stroke-color': USER_PUCK.ring,
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        )}

        {pinGeoJSON.features.length > 0 && (
          <GeoJSONSource
            ref={sourceRef}
            id="location-pins"
            data={pinGeoJSON}
            cluster={clusterPins}
            clusterProperties={CLUSTER_PROPERTIES as any}
            clusterRadius={50}
            clusterMaxZoom={14}
            // Was { width: 44, height: 72 } (centred) in v10; v11 takes padding.
            hitbox={{ top: 36, right: 22, bottom: 36, left: 22 }}
            onPress={(event) => {
              // v11 bubbles source presses up to the Map's onPress: a pin tap must
              // not also count as a tap on the map.
              event.stopPropagation();
              const feature = event.nativeEvent.features?.[0];
              if (!feature) return;
              if (feature.properties?.cluster || feature.properties?.point_count) {
                expandCluster(feature);
                return;
              }
              const locationId = feature.properties?.id;
              if (locationId) onPinPress?.(String(locationId));
            }}
          >
            <Layer
              type="circle"
              id="cluster-circle"
              filter={['has', 'point_count']}
              paint={{
                'circle-color': '#2563eb',
                'circle-radius': 20,
                'circle-opacity': 0.9,
              }}
            />

            <Layer
              type="symbol"
              id="cluster-count"
              filter={['has', 'point_count']}
              layout={{
                'text-field': CLUSTER_LABEL_EXPRESSION as any,
                'text-size': 12,
                'text-font': MAP_LABEL_FONT,
                'text-allow-overlap': true,
              }}
              paint={{ 'text-color': '#ffffff' }}
            />

            {/* Single listings: teardrop pin whose tip marks the exact entrance. */}
            <Layer
              type="symbol"
              id="pin-marker"
              filter={['!', ['has', 'point_count']]}
              layout={{
                'icon-image': PIN_IMAGE_EXPRESSION as any,
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'text-field': ['get', 'pinLabel'],
                'text-size': PIN_LABEL_SIZE,
                'text-font': MAP_LABEL_FONT,
                'text-offset': PIN_LABEL_OFFSET,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
              }}
              paint={{ 'text-color': '#ffffff' }}
            />
          </GeoJSONSource>
        )}
        {focusShape && (
          <GeoJSONSource id="focus-place" data={focusShape}>
            <Layer
              type="symbol"
              id="focus-place-marker"
              layout={{
                'icon-image': 'pin-place',
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>
    </View>
  );
});

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
