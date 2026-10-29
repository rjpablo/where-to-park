import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { MapProps } from './types';

// Configure MapLibre
MapLibreGL.setAccessToken(null);

export const Map: React.FC<MapProps> = ({
  region,
  pins = [],
  onPinPress: _onPinPress,
  style,
  showsUserLocation = true,
  clusterPins = true,
}) => {
  const centerCoordinate = useMemo(
    () => (region ? [region.longitude, region.latitude] : [120.596, 16.412]),
    [region]
  );

  // Convert pins to GeoJSON
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

  const NativeMapView = MapLibreGL.MapView as unknown as React.ComponentType<{
    style?: object;
    styleURL?: string;
    compassEnabled?: boolean;
    logoEnabled?: boolean;
    attributionEnabled?: boolean;
    children?: React.ReactNode;
  }>;

  return (
    <NativeMapView
      style={[styles.map, style]}
      styleURL="https://tiles.openfreemap.org/styles/liberty"
      compassEnabled
      logoEnabled={false}
      attributionEnabled={false}
    >
      <MapLibreGL.Camera
        zoomLevel={14}
        centerCoordinate={centerCoordinate}
        animationMode="flyTo"
        animationDuration={1000}
      />

      {showsUserLocation && <MapLibreGL.UserLocation visible />}

      {/* Location pins */}
      {pinGeoJSON.features.length > 0 && (
        <MapLibreGL.ShapeSource
          id="location-pins"
          shape={pinGeoJSON}
          cluster={clusterPins}
          clusterRadius={50}
          clusterMaxZoomLevel={14}
        >
          {/* Cluster circles */}
          <MapLibreGL.CircleLayer
            id="cluster-circle"
            filter={['has', 'point_count']}
            style={{
              circleColor: '#2563eb',
              circleRadius: 20,
              circleOpacity: 0.9,
            }}
          />

          {/* Cluster count text */}
          <MapLibreGL.SymbolLayer
            id="cluster-count"
            filter={['has', 'point_count']}
            style={{
              textField: ['get', 'point_count'],
              textSize: 12,
              textColor: '#ffffff',
              textFont: ['Open Sans Bold'],
            }}
          />

          {/* Individual pins */}
          <MapLibreGL.CircleLayer
            id="pin-circle"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: [
                'case',
                ['get', 'isStale'],
                '#f59e0b',
                ['get', 'isFull'],
                '#ef4444',
                '#10b981',
              ],
              circleRadius: 16,
              circleStrokeColor: '#ffffff',
              circleStrokeWidth: 2,
            }}
          />

          {/* Pin available count */}
          <MapLibreGL.SymbolLayer
            id="pin-count"
            filter={['!', ['has', 'point_count']]}
            style={{
              textField: ['get', 'pinLabel'],
              textSize: 11,
              textColor: '#ffffff',
              textFont: ['Open Sans Bold'],
            }}
          />
        </MapLibreGL.ShapeSource>
      )}
    </NativeMapView>
  );
};

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
