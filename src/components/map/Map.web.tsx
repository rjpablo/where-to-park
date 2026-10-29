import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapProps, LocationPin } from './types';

export const Map: React.FC<MapProps> = ({
  region,
  pins = [],
  onPinPress,
  onRegionChange,
  style,
  showsUserLocation = true,
  clusterPins = true,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const initialCenter: [number, number] = region
      ? [region.longitude, region.latitude]
      : [120.5960, 16.4120];

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: initialCenter,
      zoom: 14,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    if (showsUserLocation) {
      map.current.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: {
            enableHighAccuracy: true,
          },
          trackUserLocation: true,
        }),
        'top-right'
      );
    }

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update pins
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const pinFeatures = pins.map((pin) => ({
      type: 'Feature' as const,
      id: pin.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [pin.coordinate.longitude, pin.coordinate.latitude],
      },
      properties: {
        id: pin.id,
        availableCount: pin.availableCount,
        isStale: pin.isStale,
        title: pin.title,
      },
    }));

    const geoJSON: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: pinFeatures,
    };

    const sourceId = 'location-pins';
    const source = map.current.getSource(sourceId);

    if (source) {
      (source as maplibregl.GeoJSONSource).setData(geoJSON);
    } else {
      map.current.addSource(sourceId, {
        type: 'geojson',
        data: geoJSON,
        cluster: clusterPins,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.current.addLayer({
        id: 'cluster-circle',
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#2563eb',
          'circle-radius': 20,
          'circle-opacity': 0.9,
        },
      });

      // Cluster count
      map.current.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count}',
          'text-font': ['Open Sans Bold'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      // Individual pins
      map.current.addLayer({
        id: 'pin-circle',
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'case',
            ['get', 'isStale'],
            '#f59e0b',
            '#10b981',
          ],
          'circle-radius': 16,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      // Pin count
      map.current.addLayer({
        id: 'pin-count',
        type: 'symbol',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['get', 'availableCount'],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      // Click handler
      map.current.on('click', 'pin-circle', (e) => {
        if (e.features && e.features[0] && onPinPress) {
          const feature = e.features[0];
          const locationId = feature.properties?.id;
          if (locationId) {
            onPinPress(locationId);
          }
        }
      });

      // Change cursor on hover
      map.current.on('mouseenter', 'pin-circle', () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = 'pointer';
        }
      });

      map.current.on('mouseleave', 'pin-circle', () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = '';
        }
      });
    }
  }, [pins, mapLoaded, clusterPins, onPinPress]);

  // Update region
  useEffect(() => {
    if (!map.current || !region) return;

    map.current.flyTo({
      center: [region.longitude, region.latitude],
      zoom: 14,
      duration: 1000,
    });
  }, [region]);

  return (
    <View style={[styles.container, style]}>
      <div ref={mapContainer} style={styles.map as any} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
});
