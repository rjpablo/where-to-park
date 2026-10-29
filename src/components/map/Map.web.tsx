import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapProps } from './types';
import { BAGUIO, DEFAULT_MAP_ZOOM, MAP_LABEL_FONT, MAP_STYLE_URL } from './style';

export const Map: React.FC<MapProps> = ({
  region,
  pins = [],
  onPinPress,
  onMapPress,
  style,
  clusterPins = true,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const onMapPressRef = useRef(onMapPress);
  const [mapLoaded, setMapLoaded] = useState(false);

  onMapPressRef.current = onMapPress;

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const initialCenter: [number, number] = region
      ? [region.longitude, region.latitude]
      : [BAGUIO.longitude, BAGUIO.latitude];

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE_URL,
      center: initialCenter,
      zoom: DEFAULT_MAP_ZOOM,
    });

    if (typeof window !== 'undefined') {
      (window as any).__WTP_MAP = map.current;
    }

    try {
      map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    } catch (err) {
      console.warn('NavigationControl failed', err);
    }

    map.current.on('load', () => {
      setMapLoaded(true);
    });
    map.current.on('click', (e) => {
      onMapPressRef.current?.({
        latitude: e.lngLat.lat,
        longitude: e.lngLat.lng,
      });
    });
    const fallback = setTimeout(() => setMapLoaded(true), 2500);

    map.current.on('idle', () => {
      if (typeof window !== 'undefined') {
        (window as any).__WTP_MAP_IDLE = true;
      }
      if (mapContainer.current) {
        mapContainer.current.setAttribute('data-map-idle', 'true');
      }
    });

    return () => {
      clearTimeout(fallback);
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
    // Map instance is created once; region updates fly in a later effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        pinLabel: pin.pinLabel || String(pin.availableCount),
        isStale: pin.isStale ? 1 : 0,
        isFull: pin.isFull ? 1 : 0,
        title: pin.title,
      },
    }));

    const geoJSON: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: pinFeatures,
    };

    const sourceId = 'location-pins';
    const source = map.current.getSource(sourceId);

    if (typeof window !== 'undefined') {
      (window as any).__WTP_MAP_IDLE = false;
      (window as any).__WTP_PIN_COUNT = pins.length;
    }
    if (mapContainer.current) {
      mapContainer.current.setAttribute('data-map-idle', 'false');
      mapContainer.current.setAttribute('data-pin-count', String(pins.length));
    }

    try {
      if (source) {
        (source as maplibregl.GeoJSONSource).setData(geoJSON);
      } else {
        map.current.addSource(sourceId, {
          type: 'geojson',
          data: geoJSON,
          cluster: clusterPins,
          clusterMaxZoom: 16,
          clusterRadius: 80,
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
            'text-font': MAP_LABEL_FONT,
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
              ['==', ['get', 'isStale'], 1],
              '#f59e0b',
              ['==', ['get', 'isFull'], 1],
              '#ef4444',
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
            'text-field': ['get', 'pinLabel'],
            'text-font': MAP_LABEL_FONT,
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

        map.current.on('click', 'cluster-circle', (e) => {
          const feature = e.features && e.features[0];
          const clusterId = feature?.properties?.cluster_id;
          const coords = (feature?.geometry as GeoJSON.Point | undefined)?.coordinates;
          const src = map.current?.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
          if (clusterId == null || !src || !coords) return;
          src.getClusterExpansionZoom(clusterId).then((zoom) => {
            if (zoom == null || !map.current) return;
            map.current.easeTo({ center: coords as [number, number], zoom });
          });
        });
      }
    } catch (err) {
      console.warn('GeoJSON pin layers failed', err);
    }

    markers.current.forEach((m) => m.remove());
    markers.current = [];
    if (mapContainer.current) {
      mapContainer.current.setAttribute('data-cluster', clusterPins ? 'true' : 'false');
    }
  }, [pins, mapLoaded, clusterPins, onPinPress]);

  // Update region
  useEffect(() => {
    if (!map.current || !region) return;

    map.current.flyTo({
      center: [region.longitude, region.latitude],
      zoom: DEFAULT_MAP_ZOOM,
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
