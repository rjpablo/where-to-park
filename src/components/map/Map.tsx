import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { MapProps } from './types';
import { DEFAULT_MAP_ZOOM, MAP_LABEL_FONT, MAP_STYLE_URL, mapCenter } from './style';

MapLibreGL.setAccessToken(null);

export const Map: React.FC<MapProps> = ({
  region,
  pins = [],
  onPinPress,
  onMapPress,
  style,
  showsUserLocation = true,
  clusterPins = true,
}) => {
  const centerCoordinate = useMemo(() => mapCenter(region), [region]);

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

  return (
    <MapLibreGL.MapView
      style={[styles.map, style]}
      mapStyle={MAP_STYLE_URL}
      compassEnabled
      logoEnabled={false}
      attributionEnabled={false}
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
        defaultSettings={{
          centerCoordinate,
          zoomLevel: DEFAULT_MAP_ZOOM,
        }}
        centerCoordinate={centerCoordinate}
        zoomLevel={DEFAULT_MAP_ZOOM}
        animationMode="flyTo"
        animationDuration={1000}
      />

      {showsUserLocation && <MapLibreGL.UserLocation visible />}

      {pinGeoJSON.features.length > 0 && (
        <MapLibreGL.ShapeSource
          id="location-pins"
          shape={pinGeoJSON}
          cluster={clusterPins}
          clusterRadius={50}
          clusterMaxZoomLevel={14}
          hitbox={{ width: 44, height: 44 }}
          onPress={(event) => {
            const feature = event.features?.[0];
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
              textField: ['get', 'point_count'],
              textSize: 12,
              textColor: '#ffffff',
              textFont: MAP_LABEL_FONT,
              textAllowOverlap: true,
            }}
          />

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

          <MapLibreGL.SymbolLayer
            id="pin-count"
            filter={['!', ['has', 'point_count']]}
            style={{
              textField: ['get', 'pinLabel'],
              textSize: 11,
              textColor: '#ffffff',
              textFont: MAP_LABEL_FONT,
              textAllowOverlap: true,
            }}
          />
        </MapLibreGL.ShapeSource>
      )}
    </MapLibreGL.MapView>
  );
};

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
