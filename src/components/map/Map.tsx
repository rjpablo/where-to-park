import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { MapProps } from './types';
import { DEFAULT_MAP_ZOOM, MAP_LABEL_FONT, MAP_STYLE_URL, mapCenter } from './style';
import { PIN_IMAGE_EXPRESSION, PIN_LABEL_OFFSET, PIN_LABEL_SIZE } from './pins';

const PIN_IMAGES = {
  'pin-open': require('../../../assets/map/pin-open.png'),
  'pin-full': require('../../../assets/map/pin-full.png'),
  'pin-stale': require('../../../assets/map/pin-stale.png'),
  'pin-place': require('../../../assets/map/pin-place.png'),
};

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

      <MapLibreGL.Images images={PIN_IMAGES} />

      {showsUserLocation && <MapLibreGL.UserLocation visible />}

      {pinGeoJSON.features.length > 0 && (
        <MapLibreGL.ShapeSource
          id="location-pins"
          shape={pinGeoJSON}
          cluster={clusterPins}
          clusterRadius={50}
          clusterMaxZoomLevel={14}
          hitbox={{ width: 44, height: 72 }}
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
    </MapLibreGL.MapView>
  );
};

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
